"""
STT (Speech-to-Text) Mixin
Multi-model support: NeMo, faster-whisper, Amazon Transcribe
"""

import os
import re
import time
import asyncio
import tempfile
from typing import Tuple, List

import numpy as np

from config.settings import Config
from utils.logger import DebugLogger

# Optional imports
try:
    import soundfile as sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False

try:
    from amazon_transcribe.client import TranscribeStreamingClient
    from amazon_transcribe.handlers import TranscriptResultStreamHandler
    from amazon_transcribe.model import TranscriptEvent
    AMAZON_TRANSCRIBE_AVAILABLE = True
except ImportError:
    AMAZON_TRANSCRIBE_AVAILABLE = False


class STTMixin:
    """STT 관련 메서드를 제공하는 Mixin 클래스"""

    def _is_audio_artifact(self, text: str) -> bool:
        """
        Check if the transcribed text is a non-speech audio artifact or hallucination.

        NOTE: We do NOT filter based on text content like "감사합니다" because
        users might actually say those words. Only filter clear artifacts and
        repetitive hallucination patterns.
        """
        if not text:
            return False

        text_lower = text.lower().strip()

        # Only filter if the entire text is an artifact pattern
        if text_lower in Config.AUDIO_ARTIFACT_PATTERNS:
            return True

        # =====================================================
        # Repetitive Pattern Detection (Hallucination Filter)
        # =====================================================
        words = text_lower.split()

        # 1. Single word repeated many times (e.g., "음 음 음 음 음")
        if len(words) >= 5:
            if len(set(words)) == 1:
                return True

        # 2. Two-word pattern repeated (e.g., "릴리 릴리 릴리 릴리")
        if len(words) >= 4:
            # Check if all words are the same
            unique_words = set(words)
            if len(unique_words) <= 2 and len(words) >= 6:
                return True

        # 3. Detect "X.. X.. X.." pattern (e.g., "잘.. 잘.. 잘..")
        # Pattern: same word followed by dots, repeated
        dot_pattern = re.findall(r'(\S+)\.\.+', text_lower)
        if len(dot_pattern) >= 3:
            if len(set(dot_pattern)) == 1:
                return True

        # 4. Detect repeated character sequences (e.g., "강강강강강강")
        # If more than 60% of text is the same character repeated
        if len(text_lower) >= 10:
            char_counts = {}
            for char in text_lower:
                if char not in ' .':
                    char_counts[char] = char_counts.get(char, 0) + 1
            if char_counts:
                max_count = max(char_counts.values())
                total_chars = sum(char_counts.values())
                if total_chars > 0 and max_count / total_chars > 0.6:
                    return True

        # 5. Very long text with very few unique characters (hallucination)
        if len(text_lower) >= 50:
            unique_chars = set(text_lower.replace(' ', '').replace('.', ''))
            if len(unique_chars) <= 3:
                return True

        return False

    def _is_likely_hallucination(self, text: str, audio_rms: float, no_speech_prob: float) -> bool:
        """
        Check if transcription is likely a hallucination based on audio characteristics.

        Uses audio energy (RMS) and Whisper's no_speech_prob to detect hallucinations.
        """
        if not text:
            return False

        # If audio is very quiet but we got text, it's likely hallucination
        if audio_rms < Config.HALLUCINATION_RMS_THRESHOLD and len(text) > 3:
            return True

        # High no_speech probability with text is suspicious
        if no_speech_prob > 0.7 and len(text) > 5:
            return True

        return False

    async def _transcribe_streaming(self, audio_bytes: bytes, language_code: str) -> Tuple[str, float]:
        """
        Amazon Transcribe Streaming을 사용한 음성 전사

        Args:
            audio_bytes: int16 PCM audio bytes
            language_code: Amazon Transcribe 언어 코드 (예: "ko-KR", "en-US")

        Returns:
            (text, confidence)
        """
        if not AMAZON_TRANSCRIBE_AVAILABLE:
            DebugLogger.log("STT_ERROR", "Amazon Transcribe not available")
            return "", 0.0

        client = TranscribeStreamingClient(region=self.transcribe_region)

        class ResultHandler(TranscriptResultStreamHandler):
            def __init__(self, stream):
                super().__init__(stream)
                self.transcripts: List[Tuple[str, float]] = []

            async def handle_transcript_event(self, event: TranscriptEvent):
                results = event.transcript.results
                for result in results:
                    if not result.is_partial:
                        for alt in result.alternatives:
                            text = alt.transcript.strip()
                            conf = alt.confidence if hasattr(alt, 'confidence') and alt.confidence else 0.95
                            if text:
                                self.transcripts.append((text, conf))
                                DebugLogger.log("TRANSCRIBE", f"Segment: {text[:50]}", {"conf": f"{conf:.2f}"})

        try:
            stream = await client.start_stream_transcription(
                language_code=language_code,
                media_sample_rate_hz=Config.SAMPLE_RATE,
                media_encoding="pcm",
            )

            handler = ResultHandler(stream.output_stream)

            chunk_size = 8192
            async def send_audio():
                for i in range(0, len(audio_bytes), chunk_size):
                    chunk = audio_bytes[i:i + chunk_size]
                    await stream.input_stream.send_audio_event(audio_chunk=chunk)
                await stream.input_stream.end_stream()

            await asyncio.gather(send_audio(), handler.handle_events())

            if handler.transcripts:
                texts = [t[0] for t in handler.transcripts]
                confidences = [t[1] for t in handler.transcripts]
                full_text = " ".join(texts)
                avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
                return full_text, avg_confidence
            else:
                return "", 0.0

        except Exception as e:
            DebugLogger.log("TRANSCRIBE_ERROR", f"Amazon Transcribe failed: {e}")
            return "", 0.0

    def _transcribe_nemo(self, audio_data: np.ndarray, model, language: str) -> Tuple[str, float]:
        """
        Transcribe using NVIDIA NeMo model (e.g., Canary)

        Args:
            audio_data: float32 normalized audio array [-1, 1]
            model: NeMo ASR model
            language: Language code

        Returns:
            (text, confidence)
        """
        if not SOUNDFILE_AVAILABLE:
            DebugLogger.log("STT_ERROR", "soundfile not available for NeMo")
            return "", 0.0

        try:
            # NeMo requires audio file input
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                temp_path = f.name
                audio_int16 = (audio_data * 32767).clip(-32768, 32767).astype(np.int16)
                sf.write(temp_path, audio_int16, Config.SAMPLE_RATE)

            transcriptions = model.transcribe([temp_path])
            os.unlink(temp_path)

            if transcriptions and len(transcriptions) > 0:
                if isinstance(transcriptions[0], str):
                    result_text = transcriptions[0].strip()
                else:
                    result_text = str(transcriptions[0]).strip()

                if self._is_audio_artifact(result_text):
                    return "", 0.0

                return result_text, 0.95

            return "", 0.0

        except Exception as e:
            DebugLogger.log("STT_ERROR", f"NeMo transcription failed: {e}")
            return "", 0.0

    def _transcribe_whisper(self, audio_data: np.ndarray, model, language: str, audio_rms: float) -> Tuple[str, float]:
        """
        Transcribe using faster-whisper model

        Args:
            audio_data: float32 normalized audio array [-1, 1]
            model: WhisperModel instance
            language: Language code
            audio_rms: Pre-computed RMS for hallucination detection

        Returns:
            (text, confidence)
        """
        whisper_lang = Config.WHISPER_LANG_CODES.get(language, "en")

        segments, info = model.transcribe(
            audio_data,
            language=whisper_lang,
            beam_size=Config.WHISPER_BEAM_SIZE,
            best_of=Config.WHISPER_BEST_OF,
            temperature=Config.WHISPER_TEMPERATURE,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=200,
                speech_pad_ms=100,
            ),
            condition_on_previous_text=False,
            without_timestamps=True,
            suppress_blank=True,
            suppress_tokens=[-1],
            no_speech_threshold=0.6,
            log_prob_threshold=-0.8,
            compression_ratio_threshold=2.0,
        )

        texts = []
        max_no_speech_prob = 0.0

        for segment in segments:
            segment_text = segment.text.strip()
            max_no_speech_prob = max(max_no_speech_prob, segment.no_speech_prob)

            if segment.no_speech_prob > 0.6:
                continue

            if self._is_audio_artifact(segment_text):
                continue

            if segment_text:
                texts.append(segment_text)

        result_text = " ".join(texts).strip()
        confidence = info.language_probability if info.language_probability else 0.95

        # Hallucination detection
        if self._is_likely_hallucination(result_text, audio_rms, max_no_speech_prob):
            return "", 0.0

        if result_text and self._is_audio_artifact(result_text):
            return "", 0.0

        return result_text, confidence

    def transcribe(self, audio_data: np.ndarray, language: str) -> Tuple[str, float]:
        """
        Speech to Text - Routes to appropriate model based on language and backend

        Args:
            audio_data: float32 normalized audio array [-1, 1]
            language: Language code (ko, en, ja, zh, etc.)

        Returns:
            (text, confidence)
        """
        start_time = time.time()

        DebugLogger.stt_start(len(audio_data) * 4, language)

        # Audio validation
        audio_rms = np.sqrt(np.mean(audio_data ** 2))
        audio_duration = len(audio_data) / Config.SAMPLE_RATE

        DebugLogger.log("STT_AUDIO", f"Audio analysis", {
            "samples": len(audio_data),
            "duration_sec": f"{audio_duration:.2f}",
            "rms": f"{audio_rms:.4f}",
            "max": f"{np.max(np.abs(audio_data)):.4f}",
            "language": language,
            "backend": Config.STT_BACKEND
        })

        # Skip if audio is too quiet
        if audio_rms < 0.001:
            DebugLogger.log("STT_SKIP", "Silence detected", {"rms": f"{audio_rms:.6f}"})
            return "", 0.0

        # Skip if audio is too short
        if audio_duration < Config.MIN_AUDIO_DURATION:
            DebugLogger.log("STT_SKIP", "Audio too short", {"duration": f"{audio_duration:.2f}"})
            return "", 0.0

        try:
            result_text = ""
            confidence = 0.0

            # ===== Multi-Model Backend (Language-Specific) =====
            if Config.STT_BACKEND == "multi":
                if language in self.nemo_models:
                    model = self.nemo_models[language]
                    DebugLogger.log("STT_ROUTE", f"Using NeMo model for {language}")
                    result_text, confidence = self._transcribe_nemo(audio_data, model, language)

                elif language in self.whisper_models:
                    model = self.whisper_models[language]
                    DebugLogger.log("STT_ROUTE", f"Using Whisper model for {language}: {Config.MULTI_MODEL_STT[language]['model']}")
                    result_text, confidence = self._transcribe_whisper(audio_data, model, language, audio_rms)

                elif "fallback" in self.whisper_models:
                    model = self.whisper_models["fallback"]
                    DebugLogger.log("STT_ROUTE", f"Using fallback model for {language}")
                    result_text, confidence = self._transcribe_whisper(audio_data, model, language, audio_rms)

                else:
                    DebugLogger.log("STT_ERROR", f"No model available for language: {language}")
                    return "", 0.0

            # ===== Amazon Transcribe Backend =====
            elif Config.STT_BACKEND == "transcribe" and AMAZON_TRANSCRIBE_AVAILABLE:
                transcribe_lang = Config.TRANSCRIBE_LANG_CODES.get(language, "en-US")
                DebugLogger.log("STT_LANG", f"Using Amazon Transcribe: {transcribe_lang}")

                audio_int16 = (audio_data * 32768).clip(-32768, 32767).astype(np.int16)
                audio_bytes = audio_int16.tobytes()

                result_text, confidence = self.async_manager.run_async(
                    self._transcribe_streaming(audio_bytes, transcribe_lang),
                    timeout=Config.STT_TIMEOUT
                )

            # ===== faster-whisper Backend (Single Model) =====
            elif self.whisper_model:
                whisper_lang = Config.WHISPER_LANG_CODES.get(language, "en")
                DebugLogger.log("STT_LANG", f"Using faster-whisper: {whisper_lang}")
                result_text, confidence = self._transcribe_whisper(audio_data, self.whisper_model, language, audio_rms)

            else:
                DebugLogger.log("STT_ERROR", "No STT backend available")
                return "", 0.0

            latency_ms = (time.time() - start_time) * 1000

            if result_text:
                DebugLogger.stt_result(result_text, confidence, latency_ms)
            else:
                DebugLogger.log("STT_EMPTY", f"No valid text detected", {"latency_ms": f"{latency_ms:.0f}"})

            return result_text, confidence

        except TimeoutError as e:
            DebugLogger.log("STT_TIMEOUT", f"STT timed out: {e}")
            return "", 0.0
        except Exception as e:
            import traceback
            DebugLogger.log("STT_ERROR", f"Transcription failed: {e}", {
                "traceback": traceback.format_exc()
            })
            return "", 0.0
