"""
Python gRPC AI Server - v10 (Real-time Optimized)

Changes from v9:
- Replaced Amazon Transcribe with faster-whisper (6x faster)
- Added comprehensive debugging with timestamps
- Added latency tracking and performance metrics
- Optimized buffering strategy

Features:
- faster-whisper (local GPU STT) - ~100-300ms latency
- AWS Translate / Qwen3-8B Translation
- Amazon Polly TTS
- VAD-based Sentence Detection
- Detailed debugging logs
"""

import sys
import os
import asyncio
import uuid
import time
import threading
from concurrent import futures
from datetime import datetime
from typing import Dict, List, Set, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import json

import grpc
import numpy as np
import torch
import boto3
import webrtcvad

# faster-whisper for STT (replaces Amazon Transcribe)
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    print("[WARNING] faster-whisper not installed. Install with: pip install faster-whisper")

# Qwen3 Translation Model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generated import conversation_pb2
from generated import conversation_pb2_grpc


# =============================================================================
# Debug Logger - Detailed Timing & Flow Tracking
# =============================================================================

class DebugLogger:
    """상세 디버깅을 위한 로거 클래스"""

    ENABLED = True  # 디버깅 활성화/비활성화
    VERBOSE = True  # 상세 로그 (오디오 바이트 등)

    @staticmethod
    def timestamp():
        return datetime.now().strftime('%H:%M:%S.%f')[:-3]

    @staticmethod
    def log(category: str, message: str, data: dict = None):
        if not DebugLogger.ENABLED:
            return

        ts = DebugLogger.timestamp()

        if data and DebugLogger.VERBOSE:
            data_str = json.dumps(data, ensure_ascii=False, default=str)
            print(f"[{ts}] [{category}] {message} | {data_str}")
        else:
            print(f"[{ts}] [{category}] {message}")

    @staticmethod
    def audio_received(session_id: str, chunk_bytes: int, duration_sec: float):
        DebugLogger.log("AUDIO_IN", f"Received audio chunk", {
            "session": session_id[:8],
            "bytes": chunk_bytes,
            "duration_sec": f"{duration_sec:.3f}",
            "bytes_per_sec": int(chunk_bytes / duration_sec) if duration_sec > 0 else 0
        })

    @staticmethod
    def vad_result(has_speech: bool, is_sentence_end: bool, buffer_duration: float):
        DebugLogger.log("VAD", f"Speech={has_speech}, SentenceEnd={is_sentence_end}", {
            "buffer_sec": f"{buffer_duration:.2f}"
        })

    @staticmethod
    def stt_start(audio_bytes: int, language: str):
        DebugLogger.log("STT_START", f"Starting transcription", {
            "bytes": audio_bytes,
            "lang": language
        })

    @staticmethod
    def stt_result(text: str, confidence: float, latency_ms: float):
        DebugLogger.log("STT_DONE", f"Transcription complete", {
            "text_len": len(text),
            "text_preview": text[:50] + "..." if len(text) > 50 else text,
            "confidence": f"{confidence:.2f}",
            "latency_ms": f"{latency_ms:.0f}"
        })

    @staticmethod
    def translation_start(text: str, source: str, target: str):
        DebugLogger.log("TRANS_START", f"Translating {source}→{target}", {
            "text_len": len(text)
        })

    @staticmethod
    def translation_result(result: str, source: str, target: str, latency_ms: float):
        DebugLogger.log("TRANS_DONE", f"Translation {source}→{target} complete", {
            "result_len": len(result),
            "result_preview": result[:50] + "..." if len(result) > 50 else result,
            "latency_ms": f"{latency_ms:.0f}"
        })

    @staticmethod
    def tts_start(text: str, language: str):
        DebugLogger.log("TTS_START", f"Synthesizing speech", {
            "text_len": len(text),
            "lang": language
        })

    @staticmethod
    def tts_result(audio_bytes: int, duration_ms: int, latency_ms: float):
        DebugLogger.log("TTS_DONE", f"TTS complete", {
            "audio_bytes": audio_bytes,
            "duration_ms": duration_ms,
            "latency_ms": f"{latency_ms:.0f}"
        })

    @staticmethod
    def pipeline_complete(total_latency_ms: float, breakdown: dict):
        DebugLogger.log("PIPELINE", f"Complete pipeline", {
            "total_latency_ms": f"{total_latency_ms:.0f}",
            **breakdown
        })


# =============================================================================
# Configuration
# =============================================================================

class Config:
    # Audio settings
    SAMPLE_RATE = 16000
    BYTES_PER_SAMPLE = 2  # 16-bit
    BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000

    # Buffering strategies
    CHUNK_DURATION_MS = 1500  # 1.5초 청크
    CHUNK_BYTES = int(BYTES_PER_SECOND * CHUNK_DURATION_MS / 1000)  # 48000 bytes

    # 실시간 번역: 문장 완성도 vs 속도 밸런스
    SENTENCE_MAX_DURATION_MS = 2500  # 문장 최대 대기 시간 (2.5초)
    SENTENCE_MAX_BYTES = int(BYTES_PER_SECOND * SENTENCE_MAX_DURATION_MS / 1000)

    # VAD settings
    SILENCE_THRESHOLD_RMS = 30
    SILENCE_DURATION_MS = 350  # 문장 끝 감지용 침묵 지속 시간
    SILENCE_FRAMES = int(SILENCE_DURATION_MS / 100)

    # STT Backend: "whisper" (local, fast) or "transcribe" (AWS, slow)
    STT_BACKEND = os.getenv("STT_BACKEND", "whisper")  # Default to whisper

    # faster-whisper model settings
    WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")  # Options: tiny, base, small, medium, large-v3, large-v3-turbo
    WHISPER_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    WHISPER_COMPUTE_TYPE = "float16" if torch.cuda.is_available() else "int8"

    # Translation backend: "aws" (fast) or "qwen" (local LLM)
    TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND", "aws")

    # Language code mappings
    WHISPER_LANG_CODES = {
        "ko": "ko",    # Korean
        "en": "en",    # English
        "ja": "ja",    # Japanese
        "zh": "zh",    # Chinese
        "es": "es",    # Spanish
        "fr": "fr",    # French
        "de": "de",    # German
        "pt": "pt",    # Portuguese
        "ru": "ru",    # Russian
        "ar": "ar",    # Arabic
        "hi": "hi",    # Hindi
        "tr": "tr",    # Turkish
    }

    # AWS Translate Language Codes (ISO 639-1)
    AWS_TRANSLATE_LANG_CODES = {
        "ko": "ko", "en": "en", "ja": "ja", "zh": "zh",
        "es": "es", "fr": "fr", "de": "de", "pt": "pt",
        "ru": "ru", "ar": "ar", "hi": "hi", "tr": "tr",
    }

    # Qwen3 Translation Model (Alibaba)
    QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen3-8B")
    GPU_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    LANGUAGE_NAMES = {
        "ko": "Korean", "en": "English", "ja": "Japanese", "zh": "Chinese",
        "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese",
        "ru": "Russian", "ar": "Arabic", "hi": "Hindi", "tr": "Turkish",
    }

    # AWS Polly
    AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")

    # gRPC
    GRPC_PORT = int(os.getenv("GRPC_PORT", 50051))
    MAX_WORKERS = int(os.getenv("MAX_WORKERS", 32))

    # Timeouts (seconds)
    STT_TIMEOUT = 10  # Whisper is fast, reduce timeout
    TRANSLATION_TIMEOUT = 10
    TTS_TIMEOUT = 8

    # Filler words to skip TTS
    FILLER_WORDS = {
        "네", "예", "응", "음", "어", "아", "으", "흠", "뭐", "그", "저",
        "아아", "어어", "음음", "네네", "예예", "그래", "응응",
        "uh", "um", "ah", "oh", "hmm", "yeah", "yes", "no", "ok", "okay",
        "well", "so", "like", "you know", "i mean",
        "あ", "え", "う", "ん", "はい", "うん", "ええ", "まあ",
        "嗯", "啊", "哦", "呃", "好", "是",
    }

    # Whisper hallucination patterns to filter out
    # These appear when audio is silent, too short, or unclear
    HALLUCINATION_PATTERNS = {
        # Korean hallucinations
        "감사합니다",
        "시청해 주셔서 감사합니다",
        "한글자막 by",
        "자막 by",
        "자막 제공",
        "구독과 좋아요",
        "mbc 뉴스",
        "kbs 뉴스",
        "sbs 뉴스",
        "이덕영입니다",
        "끝",
        # English hallucinations
        "thank you",
        "thanks for watching",
        "thanks for listening",
        "subscribe",
        "please subscribe",
        "like and subscribe",
        "see you next time",
        "bye",
        "goodbye",
        "the end",
        "subtitles by",
        "captions by",
        "translated by",
        # Japanese hallucinations
        "ありがとうございました",
        "ご視聴ありがとう",
        "字幕",
        # Chinese hallucinations
        "谢谢",
        "谢谢观看",
        "感谢收看",
        "字幕",
        # Common noise patterns
        "...",
        "…",
        "♪",
        "♫",
        "[音楽]",
        "[music]",
        "[applause]",
        "[laughter]",
    }

    # Minimum audio duration to process (seconds) - skip very short audio
    MIN_AUDIO_DURATION = 0.3  # 300ms minimum

    MIN_TTS_TEXT_LENGTH = 2


# =============================================================================
# Language Topology - 언어 어순 기반 버퍼링 전략
# =============================================================================

class BufferingStrategy(Enum):
    CHUNK_BASED = "chunk"
    SENTENCE_BASED = "sentence"


class LanguageTopology:
    SOV_LANGUAGES = {"ko", "ja", "tr", "hi", "bn"}
    SVO_LANGUAGES = {"en", "zh", "es", "fr", "de", "pt", "ru", "it"}
    VSO_LANGUAGES = {"ar", "he"}

    WORD_ORDER_GROUPS = {
        **{lang: "SOV" for lang in SOV_LANGUAGES},
        **{lang: "SVO" for lang in SVO_LANGUAGES},
        **{lang: "VSO" for lang in VSO_LANGUAGES},
    }

    @classmethod
    def get_strategy(cls, source_lang: str, target_lang: str) -> BufferingStrategy:
        source_group = cls.WORD_ORDER_GROUPS.get(source_lang, "SVO")
        target_group = cls.WORD_ORDER_GROUPS.get(target_lang, "SVO")
        if source_group == target_group:
            return BufferingStrategy.CHUNK_BASED
        else:
            return BufferingStrategy.SENTENCE_BASED

    @classmethod
    def get_buffer_duration_ms(cls, source_lang: str, target_lang: str) -> int:
        strategy = cls.get_strategy(source_lang, target_lang)
        if strategy == BufferingStrategy.CHUNK_BASED:
            return Config.CHUNK_DURATION_MS
        else:
            return Config.SENTENCE_MAX_DURATION_MS


# =============================================================================
# Voice Activity Detection (VAD)
# =============================================================================

class VADProcessor:
    def __init__(self, aggressiveness: int = 2):
        self.vad = webrtcvad.Vad(aggressiveness)
        self.sample_rate = Config.SAMPLE_RATE
        self.frame_duration_ms = 30
        self.frame_size = int(self.sample_rate * self.frame_duration_ms / 1000) * 2

        self.is_speaking = False
        self.silence_frames = 0
        self.speech_frames = 0
        self.min_speech_frames = 3
        self.max_silence_frames = int(Config.SILENCE_DURATION_MS / self.frame_duration_ms)

    def calculate_rms(self, audio_bytes: bytes) -> float:
        if len(audio_bytes) < 2:
            return 0.0
        arr = np.frombuffer(audio_bytes, dtype=np.int16)
        return float(np.sqrt(np.mean(arr.astype(np.float64) ** 2)))

    def has_speech(self, audio_bytes: bytes) -> bool:
        if len(audio_bytes) < self.frame_size:
            return False

        speech_frame_count = 0
        total_frames = 0

        for i in range(0, len(audio_bytes) - self.frame_size + 1, self.frame_size):
            frame = audio_bytes[i:i + self.frame_size]
            if len(frame) == self.frame_size:
                total_frames += 1
                try:
                    if self.vad.is_speech(frame, self.sample_rate):
                        speech_frame_count += 1
                except Exception:
                    rms = self.calculate_rms(frame)
                    if rms >= Config.SILENCE_THRESHOLD_RMS:
                        speech_frame_count += 1

        if total_frames > 0:
            speech_ratio = speech_frame_count / total_frames
            return speech_ratio >= 0.3
        return False

    def filter_speech(self, audio_bytes: bytes) -> bytes:
        if len(audio_bytes) < self.frame_size:
            return audio_bytes

        speech_frames = []
        for i in range(0, len(audio_bytes) - self.frame_size + 1, self.frame_size):
            frame = audio_bytes[i:i + self.frame_size]
            if len(frame) == self.frame_size:
                try:
                    if self.vad.is_speech(frame, self.sample_rate):
                        speech_frames.append(frame)
                except Exception:
                    rms = self.calculate_rms(frame)
                    if rms >= Config.SILENCE_THRESHOLD_RMS:
                        speech_frames.append(frame)

        if speech_frames:
            return b''.join(speech_frames)
        return b''

    def process_chunk(self, audio_bytes: bytes) -> Tuple[bool, bool]:
        has_speech = self.has_speech(audio_bytes)

        if has_speech:
            self.speech_frames += 1
            self.silence_frames = 0
            if not self.is_speaking and self.speech_frames >= self.min_speech_frames:
                self.is_speaking = True
            return True, False
        else:
            if self.is_speaking:
                self.silence_frames += 1
                if self.silence_frames >= self.max_silence_frames:
                    self.is_speaking = False
                    self.speech_frames = 0
                    self.silence_frames = 0
                    return False, True
            return False, False

    def reset(self):
        self.is_speaking = False
        self.silence_frames = 0
        self.speech_frames = 0


# =============================================================================
# Session Management
# =============================================================================

@dataclass
class Participant:
    participant_id: str
    nickname: str
    profile_img: str
    target_language: str
    translation_enabled: bool = True


@dataclass
class Speaker:
    participant_id: str
    nickname: str
    profile_img: str
    source_language: str


@dataclass
class SessionState:
    session_id: str
    room_id: str
    speaker: Speaker
    participants: Dict[str, Participant] = field(default_factory=dict)
    audio_buffer: bytearray = field(default_factory=bytearray)
    text_buffer: str = ""
    vad: VADProcessor = field(default_factory=VADProcessor)
    primary_strategy: BufferingStrategy = BufferingStrategy.CHUNK_BASED

    # Statistics
    chunks_processed: int = 0
    silence_skipped: int = 0
    sentences_completed: int = 0

    # Latency tracking
    total_stt_latency_ms: float = 0
    total_translation_latency_ms: float = 0
    total_tts_latency_ms: float = 0

    def get_target_languages(self) -> Set[str]:
        languages = set()
        for p in self.participants.values():
            if p.translation_enabled and p.target_language != self.speaker.source_language:
                languages.add(p.target_language)
        return languages

    def get_participants_by_target_language(self, target_lang: str) -> List[str]:
        return [
            p.participant_id for p in self.participants.values()
            if p.translation_enabled and p.target_language == target_lang
        ]

    def determine_primary_strategy(self) -> BufferingStrategy:
        source_lang = self.speaker.source_language
        for target_lang in self.get_target_languages():
            strategy = LanguageTopology.get_strategy(source_lang, target_lang)
            if strategy == BufferingStrategy.SENTENCE_BASED:
                self.primary_strategy = BufferingStrategy.SENTENCE_BASED
                return self.primary_strategy
        self.primary_strategy = BufferingStrategy.CHUNK_BASED
        return self.primary_strategy


# =============================================================================
# Model Manager with faster-whisper
# =============================================================================

class ModelManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def initialize(self):
        if self._initialized:
            return

        print("=" * 70)
        print("Loading AI Models (v10 - faster-whisper)")
        print("=" * 70)

        # 1. faster-whisper STT
        if FASTER_WHISPER_AVAILABLE and Config.STT_BACKEND == "whisper":
            print(f"[1/4] Loading faster-whisper ({Config.WHISPER_MODEL_SIZE})...")
            print(f"      Device: {Config.WHISPER_DEVICE}, Compute: {Config.WHISPER_COMPUTE_TYPE}")

            self.whisper_model = WhisperModel(
                Config.WHISPER_MODEL_SIZE,
                device=Config.WHISPER_DEVICE,
                compute_type=Config.WHISPER_COMPUTE_TYPE,
            )
            print("      ✓ faster-whisper loaded")
        else:
            print("[1/4] faster-whisper not available, using Amazon Transcribe fallback")
            self.whisper_model = None
            # Initialize Amazon Transcribe if needed
            self.transcribe_region = Config.AWS_REGION

        # 2. Qwen3 Translation Model
        print(f"[2/4] Loading Qwen3 {Config.QWEN_MODEL}...")
        self.qwen_tokenizer = AutoTokenizer.from_pretrained(
            Config.QWEN_MODEL,
            trust_remote_code=True
        )

        if Config.GPU_DEVICE == "cuda":
            gpu_mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            print(f"      GPU Memory: {gpu_mem:.1f}GB")

            if gpu_mem >= 20:
                self.qwen_model = AutoModelForCausalLM.from_pretrained(
                    Config.QWEN_MODEL,
                    torch_dtype=torch.float16,
                    device_map={"": 0},
                    trust_remote_code=True,
                )
            else:
                from transformers import BitsAndBytesConfig
                quantization_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_quant_type="nf4",
                )
                self.qwen_model = AutoModelForCausalLM.from_pretrained(
                    Config.QWEN_MODEL,
                    quantization_config=quantization_config,
                    device_map={"": 0},
                    trust_remote_code=True,
                )
                print("      Using 4-bit quantization (low VRAM)")
        else:
            self.qwen_model = AutoModelForCausalLM.from_pretrained(
                Config.QWEN_MODEL,
                torch_dtype=torch.float32,
                trust_remote_code=True,
            )

        self.qwen_model.eval()
        print("      ✓ Qwen3-8B loaded")

        # 3. Amazon Polly TTS
        print("[3/4] Initializing Amazon Polly...")
        self.polly_client = boto3.client("polly", region_name=Config.AWS_REGION)
        print("      ✓ Polly initialized")

        # 4. AWS Translate
        print("[4/4] Initializing AWS Translate...")
        self.translate_client = boto3.client("translate", region_name=Config.AWS_REGION)
        print(f"      ✓ AWS Translate initialized (backend: {Config.TRANSLATION_BACKEND})")

        print("=" * 70)
        print("All models loaded successfully!")
        print(f"STT Backend: {Config.STT_BACKEND}")
        print(f"Translation Backend: {Config.TRANSLATION_BACKEND}")
        print("=" * 70)

        self._initialized = True
        self._warmup()

    def _warmup(self):
        print("\n" + "=" * 70)
        print("Warming up models...")
        print("=" * 70)

        warmup_start = time.time()

        # 1. Whisper warmup
        if self.whisper_model:
            print("[Warmup] faster-whisper...")
            try:
                # Create 1 second of silence for warmup
                dummy_audio = np.zeros(16000, dtype=np.float32)
                segments, info = self.whisper_model.transcribe(
                    dummy_audio,
                    language="en",
                    beam_size=1,
                    vad_filter=False,
                )
                list(segments)  # Force evaluation
                print("         ✓ faster-whisper warmup complete")
            except Exception as e:
                print(f"         ⚠ faster-whisper warmup failed: {e}")

        # 2. Translation warmup
        if Config.TRANSLATION_BACKEND == "aws":
            print("[Warmup] AWS Translate...")
            try:
                _ = self._translate_aws("안녕하세요", "ko", "en")
                print("         ✓ AWS Translate warmup complete")
            except Exception as e:
                print(f"         ⚠ AWS Translate warmup failed: {e}")

        # 3. TTS warmup
        print("[Warmup] Amazon Polly...")
        try:
            _, _ = self.synthesize_speech("Hello", "en")
            print("         ✓ TTS warmup complete")
        except Exception as e:
            print(f"         ⚠ TTS warmup failed: {e}")

        warmup_time = time.time() - warmup_start
        print("=" * 70)
        print(f"Warmup completed in {warmup_time:.2f}s")
        print("=" * 70 + "\n")

    def _is_hallucination(self, text: str) -> bool:
        """
        Check if the transcribed text is a Whisper hallucination.

        Whisper often produces these when audio is silent, very short, or unclear.
        """
        if not text:
            return False

        text_lower = text.lower().strip()

        # Exact match check
        if text_lower in Config.HALLUCINATION_PATTERNS:
            return True

        # Partial match check (for patterns like "한글자막 by 한효정")
        for pattern in Config.HALLUCINATION_PATTERNS:
            if pattern in text_lower:
                return True

        # Check for repetitive patterns (e.g., "음 음 음 음 음")
        words = text_lower.split()
        if len(words) >= 3:
            # If all words are the same (repetition)
            if len(set(words)) == 1:
                return True
            # If most words are very short (likely noise)
            short_words = sum(1 for w in words if len(w) <= 1)
            if short_words / len(words) > 0.7:
                return True

        return False

    def transcribe(self, audio_data: np.ndarray, language: str) -> Tuple[str, float]:
        """
        Speech to Text using faster-whisper

        Args:
            audio_data: float32 normalized audio array [-1, 1]
            language: Language code (ko, en, ja, zh, etc.) - STRICTLY enforced

        Returns:
            (text, confidence)
        """
        start_time = time.time()

        DebugLogger.stt_start(len(audio_data) * 4, language)  # float32 = 4 bytes

        # Audio validation
        audio_rms = np.sqrt(np.mean(audio_data ** 2))
        audio_duration = len(audio_data) / Config.SAMPLE_RATE

        DebugLogger.log("STT_AUDIO", f"Audio analysis", {
            "samples": len(audio_data),
            "duration_sec": f"{audio_duration:.2f}",
            "rms": f"{audio_rms:.4f}",
            "max": f"{np.max(np.abs(audio_data)):.4f}",
            "language": language
        })

        # Skip if audio is too quiet (silence)
        if audio_rms < 0.001:
            DebugLogger.log("STT_SKIP", "Silence detected, skipping", {"rms": f"{audio_rms:.6f}"})
            return "", 0.0

        # Skip if audio is too short (prevents hallucinations)
        if audio_duration < Config.MIN_AUDIO_DURATION:
            DebugLogger.log("STT_SKIP", "Audio too short, skipping", {
                "duration": f"{audio_duration:.2f}",
                "min_required": Config.MIN_AUDIO_DURATION
            })
            return "", 0.0

        try:
            if self.whisper_model:
                # Get the Whisper language code
                whisper_lang = Config.WHISPER_LANG_CODES.get(language, "en")

                DebugLogger.log("STT_LANG", f"Using language: {whisper_lang} (from: {language})")

                # Use faster-whisper with STRICT language enforcement
                segments, info = self.whisper_model.transcribe(
                    audio_data,
                    language=whisper_lang,  # FORCE this language (no auto-detect)
                    beam_size=5,
                    best_of=5,
                    vad_filter=True,  # Built-in VAD for noise filtering
                    vad_parameters=dict(
                        min_silence_duration_ms=300,
                        speech_pad_ms=200,
                    ),
                    condition_on_previous_text=False,  # Disable for real-time
                    without_timestamps=True,  # Faster processing
                    suppress_blank=True,  # Suppress blank outputs
                    # Suppress common hallucination tokens
                    suppress_tokens=[-1],  # Let VAD handle this
                    no_speech_threshold=0.5,  # Higher threshold to filter out non-speech
                    log_prob_threshold=-0.8,  # Filter low-confidence segments
                    compression_ratio_threshold=2.0,  # Filter repetitive segments
                )

                # Collect all segments
                texts = []
                for segment in segments:
                    segment_text = segment.text.strip()

                    # Skip segments with low probability or that are hallucinations
                    if segment.no_speech_prob > 0.5:
                        DebugLogger.log("STT_FILTER", f"Filtered high no_speech_prob segment", {
                            "text": segment_text[:30],
                            "no_speech_prob": f"{segment.no_speech_prob:.2f}"
                        })
                        continue

                    # Check for hallucination
                    if self._is_hallucination(segment_text):
                        DebugLogger.log("STT_FILTER", f"Filtered hallucination", {
                            "text": segment_text[:50]
                        })
                        continue

                    if segment_text:
                        texts.append(segment_text)

                result_text = " ".join(texts).strip()

                # Final hallucination check on combined text
                if self._is_hallucination(result_text):
                    DebugLogger.log("STT_FILTER", f"Filtered combined hallucination", {
                        "text": result_text[:50]
                    })
                    result_text = ""

                confidence = info.language_probability if info.language_probability else 0.95

            else:
                # Fallback: No STT available
                result_text = ""
                confidence = 0.0

            latency_ms = (time.time() - start_time) * 1000

            if result_text:
                DebugLogger.stt_result(result_text, confidence, latency_ms)
            else:
                DebugLogger.log("STT_EMPTY", f"No valid text detected", {"latency_ms": f"{latency_ms:.0f}"})

            return result_text, confidence

        except Exception as e:
            import traceback
            DebugLogger.log("STT_ERROR", f"Transcription failed: {e}", {
                "traceback": traceback.format_exc()
            })
            return "", 0.0

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text using AWS Translate or Qwen3"""
        if not text.strip():
            return ""
        if source_lang == target_lang:
            return text

        start_time = time.time()
        DebugLogger.translation_start(text, source_lang, target_lang)

        if Config.TRANSLATION_BACKEND == "aws":
            result = self._translate_aws(text, source_lang, target_lang)
        else:
            result = self._translate_qwen(text, source_lang, target_lang)

        latency_ms = (time.time() - start_time) * 1000
        DebugLogger.translation_result(result, source_lang, target_lang, latency_ms)

        return result

    def _translate_aws(self, text: str, source_lang: str, target_lang: str) -> str:
        try:
            aws_source = Config.AWS_TRANSLATE_LANG_CODES.get(source_lang, source_lang)
            aws_target = Config.AWS_TRANSLATE_LANG_CODES.get(target_lang, target_lang)

            response = self.translate_client.translate_text(
                Text=text,
                SourceLanguageCode=aws_source,
                TargetLanguageCode=aws_target,
            )

            return response['TranslatedText']

        except Exception as e:
            DebugLogger.log("TRANS_ERROR", f"AWS Translate failed: {e}")
            return self._translate_qwen(text, source_lang, target_lang)

    def _translate_qwen(self, text: str, source_lang: str, target_lang: str) -> str:
        source_name = Config.LANGUAGE_NAMES.get(source_lang, "English")
        target_name = Config.LANGUAGE_NAMES.get(target_lang, "English")

        try:
            prompt = f"""Translate this {source_name} text to {target_name}.
Rules:
- Output ONLY the {target_name} translation
- Do NOT include the original text
- Do NOT add explanations

Text: {text}

{target_name} translation:"""

            messages = [{"role": "user", "content": prompt}]

            input_text = self.qwen_tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False
            )
            inputs = self.qwen_tokenizer(
                input_text,
                return_tensors="pt",
                truncation=True,
                max_length=512
            ).to(self.qwen_model.device)

            with torch.no_grad():
                outputs = self.qwen_model.generate(
                    **inputs,
                    max_new_tokens=256,
                    do_sample=False,
                    pad_token_id=self.qwen_tokenizer.eos_token_id,
                )

            input_len = inputs["input_ids"].shape[1]
            result = self.qwen_tokenizer.decode(
                outputs[0][input_len:],
                skip_special_tokens=True
            ).strip()

            return self._clean_translation(result)

        except Exception as e:
            DebugLogger.log("TRANS_ERROR", f"Qwen translation failed: {e}")
            return ""

    def _clean_translation(self, text: str) -> str:
        result = text.strip()

        prefixes = [
            "Here is the translation:", "Here's the translation:",
            "Translation:", "The translation is:", "Translated text:",
        ]
        for prefix in prefixes:
            if result.lower().startswith(prefix.lower()):
                result = result[len(prefix):].strip()

        lines = [line.strip() for line in result.split('\n') if line.strip()]
        if len(lines) > 1:
            if len(lines[0]) < 5 and len(lines) > 1:
                result = lines[1]
            else:
                result = lines[0]
        elif lines:
            result = lines[0]

        if (result.startswith('"') and result.endswith('"')) or \
           (result.startswith("'") and result.endswith("'")):
            result = result[1:-1]

        return result.strip()

    def synthesize_speech(self, text: str, target_lang: str) -> Tuple[bytes, int]:
        """Text to Speech using Amazon Polly"""
        if not text.strip():
            return b"", 0

        start_time = time.time()
        DebugLogger.tts_start(text, target_lang)

        voice_config = {
            "ko": ("Seoyeon", "neural"),
            "en": ("Joanna", "neural"),
            "zh": ("Zhiyu", "neural"),
            "ja": ("Takumi", "neural"),
            "es": ("Lucia", "neural"),
            "fr": ("Lea", "neural"),
            "de": ("Vicki", "neural"),
            "pt": ("Camila", "neural"),
            "ru": ("Tatyana", "standard"),
            "ar": ("Zeina", "standard"),
            "hi": ("Aditi", "standard"),
            "tr": ("Filiz", "standard"),
        }

        voice_id, engine = voice_config.get(target_lang, ("Joanna", "neural"))

        try:
            response = self.polly_client.synthesize_speech(
                Text=text,
                OutputFormat="mp3",
                VoiceId=voice_id,
                Engine=engine,
                SampleRate="24000",
            )

            audio_data = response["AudioStream"].read()
            duration_ms = int(len(audio_data) / 24 * 8)

            latency_ms = (time.time() - start_time) * 1000
            DebugLogger.tts_result(len(audio_data), duration_ms, latency_ms)

            return audio_data, duration_ms

        except Exception as e:
            DebugLogger.log("TTS_ERROR", f"Polly failed: {e}")
            return b"", 0


# =============================================================================
# gRPC Service Implementation
# =============================================================================

class ConversationServicer(conversation_pb2_grpc.ConversationServiceServicer):
    """gRPC 서비스 구현 (v10 - 상세 디버깅 포함)"""

    def __init__(self, model_manager: ModelManager):
        self.models = model_manager
        self.sessions: Dict[str, SessionState] = {}
        self.lock = threading.Lock()

    def StreamChat(self, request_iterator, context):
        """양방향 스트리밍 RPC 처리"""
        session_state: Optional[SessionState] = None
        current_session_id = None

        DebugLogger.log("STREAM", "New gRPC stream connected")

        try:
            for request in request_iterator:
                current_session_id = request.session_id
                room_id = request.room_id
                participant_id = request.participant_id
                payload_type = request.WhichOneof('payload')

                # 세션 초기화
                if payload_type == 'session_init':
                    init = request.session_init

                    speaker = Speaker(
                        participant_id=init.speaker.participant_id,
                        nickname=init.speaker.nickname,
                        profile_img=init.speaker.profile_img,
                        source_language=init.speaker.source_language,
                    )

                    participants = {}
                    for p in init.participants:
                        participants[p.participant_id] = Participant(
                            participant_id=p.participant_id,
                            nickname=p.nickname,
                            profile_img=p.profile_img,
                            target_language=p.target_language,
                            translation_enabled=p.translation_enabled
                        )

                    session_state = SessionState(
                        session_id=current_session_id,
                        room_id=room_id,
                        speaker=speaker,
                        participants=participants
                    )

                    session_state.determine_primary_strategy()

                    with self.lock:
                        self.sessions[current_session_id] = session_state

                    target_langs = session_state.get_target_languages()

                    DebugLogger.log("SESSION_INIT", f"Session initialized", {
                        "session": current_session_id[:8],
                        "speaker": speaker.nickname,
                        "source_lang": speaker.source_language,
                        "target_langs": list(target_langs),
                        "strategy": session_state.primary_strategy.value,
                        "participant_count": len(participants)
                    })

                    yield conversation_pb2.ChatResponse(
                        session_id=current_session_id,
                        room_id=room_id,
                        status=conversation_pb2.SessionStatus(
                            status=conversation_pb2.SessionStatus.READY,
                            message="Session initialized (v10)",
                            buffering_strategy=conversation_pb2.BufferingStrategy(
                                source_language=speaker.source_language,
                                primary_target_language=list(target_langs)[0] if target_langs else "",
                                strategy=conversation_pb2.BufferingStrategy.CHUNK_BASED
                                    if session_state.primary_strategy == BufferingStrategy.CHUNK_BASED
                                    else conversation_pb2.BufferingStrategy.SENTENCE_BASED,
                                buffer_size_ms=0
                            )
                        )
                    )

                # 오디오 청크 처리
                elif payload_type == 'audio_chunk' and session_state:
                    audio_chunk = request.audio_chunk
                    chunk_bytes = len(audio_chunk)
                    audio_duration = chunk_bytes / Config.BYTES_PER_SECOND

                    DebugLogger.audio_received(current_session_id, chunk_bytes, audio_duration)

                    # VAD 처리
                    vad = session_state.vad
                    has_speech, is_sentence_end = vad.process_chunk(audio_chunk)
                    buffer_duration = len(session_state.audio_buffer) / Config.BYTES_PER_SECOND

                    DebugLogger.vad_result(has_speech, is_sentence_end, buffer_duration)

                    min_speech_bytes = int(Config.BYTES_PER_SECOND * 0.5)
                    max_buffer_bytes = Config.SENTENCE_MAX_BYTES

                    if has_speech:
                        speech_audio = vad.filter_speech(audio_chunk)
                        if speech_audio:
                            session_state.audio_buffer.extend(speech_audio)

                    should_process = False
                    process_reason = ""

                    if is_sentence_end and len(session_state.audio_buffer) >= min_speech_bytes:
                        should_process = True
                        process_reason = "sentence_end"
                    elif len(session_state.audio_buffer) >= max_buffer_bytes:
                        should_process = True
                        process_reason = "buffer_full"

                    if should_process:
                        process_bytes = bytes(session_state.audio_buffer)
                        session_state.audio_buffer.clear()
                        if process_reason == "buffer_full":
                            vad.reset()

                        DebugLogger.log("PROCESS", f"Processing audio buffer", {
                            "reason": process_reason,
                            "bytes": len(process_bytes),
                            "duration_sec": f"{len(process_bytes) / Config.BYTES_PER_SECOND:.2f}"
                        })

                        try:
                            pipeline_start = time.time()

                            for response in self._process_audio(session_state, process_bytes, True):
                                yield response

                            pipeline_latency = (time.time() - pipeline_start) * 1000
                            DebugLogger.log("PIPELINE_DONE", f"Pipeline complete", {
                                "total_latency_ms": f"{pipeline_latency:.0f}"
                            })

                        except Exception as proc_err:
                            DebugLogger.log("PROCESS_ERROR", f"Audio processing failed: {proc_err}")

                # 세션 종료
                elif payload_type == 'session_end':
                    if session_state:
                        session_state.vad.reset()

                        min_speech_bytes = int(Config.BYTES_PER_SECOND * 0.3)
                        if len(session_state.audio_buffer) >= min_speech_bytes:
                            process_bytes = bytes(session_state.audio_buffer)
                            session_state.audio_buffer.clear()

                            try:
                                for response in self._process_audio(session_state, process_bytes, True):
                                    yield response
                            except Exception as proc_err:
                                DebugLogger.log("END_PROCESS_ERROR", f"Final processing failed: {proc_err}")
                        else:
                            session_state.audio_buffer.clear()

                    if current_session_id:
                        with self.lock:
                            self.sessions.pop(current_session_id, None)

                    DebugLogger.log("SESSION_END", "Session ended", {
                        "session": current_session_id[:8] if current_session_id else "unknown",
                        "chunks_processed": session_state.chunks_processed if session_state else 0,
                        "sentences": session_state.sentences_completed if session_state else 0,
                    })

                    break

        except Exception as e:
            DebugLogger.log("STREAM_ERROR", f"Stream error: {e}")
            yield conversation_pb2.ChatResponse(
                session_id=current_session_id or "",
                error=conversation_pb2.ErrorResponse(
                    code="STREAM_ERROR",
                    message=str(e)
                )
            )

        finally:
            if current_session_id:
                with self.lock:
                    self.sessions.pop(current_session_id, None)
            DebugLogger.log("STREAM", "Stream closed")

    def _process_audio(self, state: SessionState, audio_bytes: bytes, is_final: bool):
        """오디오 처리 파이프라인 (상세 디버깅 포함)"""

        pipeline_start = time.time()
        audio_duration = len(audio_bytes) / Config.BYTES_PER_SECOND

        DebugLogger.log("PIPELINE_START", f"Starting audio pipeline", {
            "bytes": len(audio_bytes),
            "duration_sec": f"{audio_duration:.2f}",
            "is_final": is_final
        })

        state.chunks_processed += 1
        if is_final:
            state.sentences_completed += 1

        # 오디오 정규화
        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # ===== STEP 1: STT =====
        stt_start = time.time()
        source_lang = state.speaker.source_language
        original_text, confidence = self.models.transcribe(audio_array, source_lang)
        stt_latency = (time.time() - stt_start) * 1000
        state.total_stt_latency_ms += stt_latency

        if not original_text:
            DebugLogger.log("PIPELINE_SKIP", "No text from STT, skipping rest of pipeline")
            return

        # Filler word check
        is_filler = original_text.lower().strip() in Config.FILLER_WORDS or \
                    original_text.strip() in Config.FILLER_WORDS
        if is_filler:
            DebugLogger.log("FILLER", f"Detected filler word, skipping translation/TTS")
            transcript_id = str(uuid.uuid4())[:8]
            yield conversation_pb2.ChatResponse(
                session_id=state.session_id,
                room_id=state.room_id,
                transcript=conversation_pb2.TranscriptResult(
                    id=transcript_id,
                    speaker=conversation_pb2.SpeakerInfo(
                        participant_id=state.speaker.participant_id,
                        nickname=state.speaker.nickname,
                        profile_img=state.speaker.profile_img,
                        source_language=source_lang
                    ),
                    original_text=original_text,
                    original_language=source_lang,
                    translations=[],
                    is_partial=False,
                    is_final=True,
                    timestamp_ms=int(time.time() * 1000),
                    confidence=confidence
                )
            )
            return

        transcript_id = str(uuid.uuid4())[:8]

        # ===== STEP 2: Translation =====
        target_languages = state.get_target_languages()
        translations = []

        if len(original_text.strip()) <= 1:
            DebugLogger.log("TRANS_SKIP", "Text too short, skipping translation")
            yield conversation_pb2.ChatResponse(
                session_id=state.session_id,
                room_id=state.room_id,
                transcript=conversation_pb2.TranscriptResult(
                    id=transcript_id,
                    speaker=conversation_pb2.SpeakerInfo(
                        participant_id=state.speaker.participant_id,
                        nickname=state.speaker.nickname,
                        profile_img=state.speaker.profile_img,
                        source_language=source_lang
                    ),
                    original_text=original_text,
                    original_language=source_lang,
                    translations=[],
                    is_partial=False,
                    is_final=True,
                    timestamp_ms=int(time.time() * 1000),
                    confidence=confidence
                )
            )
            return

        trans_start = time.time()
        for target_lang in target_languages:
            translated_text = self.models.translate(original_text, source_lang, target_lang)

            if translated_text:
                target_participants = state.get_participants_by_target_language(target_lang)
                translations.append(
                    conversation_pb2.TranslationEntry(
                        target_language=target_lang,
                        translated_text=translated_text,
                        target_participant_ids=target_participants
                    )
                )
        trans_latency = (time.time() - trans_start) * 1000
        state.total_translation_latency_ms += trans_latency

        # Send Transcript
        DebugLogger.log("TRANSCRIPT_SEND", f"Sending transcript", {
            "text_len": len(original_text),
            "translations": len(translations)
        })

        yield conversation_pb2.ChatResponse(
            session_id=state.session_id,
            room_id=state.room_id,
            transcript=conversation_pb2.TranscriptResult(
                id=transcript_id,
                speaker=conversation_pb2.SpeakerInfo(
                    participant_id=state.speaker.participant_id,
                    nickname=state.speaker.nickname,
                    profile_img=state.speaker.profile_img,
                    source_language=source_lang
                ),
                original_text=original_text,
                original_language=source_lang,
                translations=translations,
                is_partial=not is_final,
                is_final=is_final,
                timestamp_ms=int(time.time() * 1000),
                confidence=confidence
            )
        )

        # ===== STEP 3: TTS =====
        tts_start = time.time()
        for translation in translations:
            target_lang = translation.target_language
            translated_text = translation.translated_text

            if len(translated_text.strip()) < Config.MIN_TTS_TEXT_LENGTH:
                continue

            if translated_text.lower().strip() in Config.FILLER_WORDS or \
               translated_text.strip() in Config.FILLER_WORDS:
                continue

            audio_data, duration_ms = self.models.synthesize_speech(translated_text, target_lang)

            if audio_data:
                DebugLogger.log("TTS_SEND", f"Sending TTS audio", {
                    "target_lang": target_lang,
                    "audio_bytes": len(audio_data),
                    "duration_ms": duration_ms
                })

                yield conversation_pb2.ChatResponse(
                    session_id=state.session_id,
                    room_id=state.room_id,
                    audio=conversation_pb2.AudioResult(
                        transcript_id=transcript_id,
                        target_language=target_lang,
                        target_participant_ids=list(translation.target_participant_ids),
                        audio_data=audio_data,
                        format="mp3",
                        sample_rate=24000,
                        duration_ms=duration_ms,
                        speaker_participant_id=state.speaker.participant_id
                    )
                )

        tts_latency = (time.time() - tts_start) * 1000
        state.total_tts_latency_ms += tts_latency

        # Pipeline summary
        total_latency = (time.time() - pipeline_start) * 1000
        DebugLogger.pipeline_complete(total_latency, {
            "stt_ms": f"{stt_latency:.0f}",
            "trans_ms": f"{trans_latency:.0f}",
            "tts_ms": f"{tts_latency:.0f}",
        })

    def UpdateParticipantSettings(self, request, context):
        """참가자 설정 업데이트"""
        room_id = request.room_id
        participant_id = request.participant_id

        updated = False
        with self.lock:
            for session in self.sessions.values():
                if session.room_id == room_id and participant_id in session.participants:
                    p = session.participants[participant_id]
                    p.target_language = request.target_language
                    p.translation_enabled = request.translation_enabled
                    session.determine_primary_strategy()
                    updated = True

        return conversation_pb2.ParticipantSettingsResponse(
            success=updated,
            message="Settings updated" if updated else "Participant not found"
        )


# =============================================================================
# Server Entry Point
# =============================================================================

def serve():
    print("\n" + "=" * 70)
    print("Python AI Server v10 - Real-time Optimized")
    print("=" * 70)
    print(f"STT Backend: {Config.STT_BACKEND}")
    print(f"Whisper Model: {Config.WHISPER_MODEL_SIZE}")
    print(f"Translation Backend: {Config.TRANSLATION_BACKEND}")
    print(f"Debug Logging: {'ENABLED' if DebugLogger.ENABLED else 'DISABLED'}")
    print("=" * 70 + "\n")

    # 모델 로딩
    model_manager = ModelManager()
    model_manager.initialize()

    # gRPC 서버 시작
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=Config.MAX_WORKERS),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )
    conversation_pb2_grpc.add_ConversationServiceServicer_to_server(
        ConversationServicer(model_manager), server
    )

    server.add_insecure_port(f'[::]:{Config.GRPC_PORT}')
    server.start()

    print(f"\n🚀 gRPC Server started on port {Config.GRPC_PORT}")
    print(f"📡 STT: {'faster-whisper' if FASTER_WHISPER_AVAILABLE else 'Amazon Transcribe'}")
    print(f"🌐 Translation: {Config.TRANSLATION_BACKEND}")
    print("Press Ctrl+C to stop\n")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
        server.stop(5)


if __name__ == "__main__":
    serve()
