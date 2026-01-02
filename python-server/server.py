"""
Python gRPC AI Server - v9 (Production)

Features:
- Adaptive Buffering based on Language Topology
- Multi-user Target Language Support
- VAD-based Sentence Detection
- Amazon Transcribe Streaming (STT)
- Qwen3-8B Translation (Alibaba)
- Amazon Polly TTS
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

import grpc
import numpy as np
import torch
import boto3
import webrtcvad

# Amazon Transcribe Streaming
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

# Qwen3 Translation Model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generated import conversation_pb2
from generated import conversation_pb2_grpc


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
    SENTENCE_MAX_DURATION_MS = 2500  # 문장 최대 대기 시간 (2.5초 - 문장 완성을 위해)
    SENTENCE_MAX_BYTES = int(BYTES_PER_SECOND * SENTENCE_MAX_DURATION_MS / 1000)  # 80000 bytes

    # VAD settings - 침묵 감지로 빠르게 전송
    SILENCE_THRESHOLD_RMS = 30  # RMS 침묵 임계값
    SILENCE_DURATION_MS = 350   # 문장 끝 감지용 침묵 지속 시간 (350ms)
    SILENCE_FRAMES = int(SILENCE_DURATION_MS / 100)  # 100ms 프레임 기준

    # Translation backend: "aws" (fast) or "qwen" (local LLM)
    TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND", "aws")  # AWS Translate가 기본값 (10x 더 빠름)

    # Amazon Transcribe Language Codes
    TRANSCRIBE_LANG_CODES = {
        "ko": "ko-KR",    # Korean
        "en": "en-US",    # English (US)
        "ja": "ja-JP",    # Japanese
        "zh": "zh-CN",    # Chinese (Mandarin)
        "es": "es-US",    # Spanish (US)
        "fr": "fr-FR",    # French
        "de": "de-DE",    # German
        "pt": "pt-BR",    # Portuguese (Brazil)
        "ru": "ru-RU",    # Russian
        "ar": "ar-SA",    # Arabic (Saudi Arabia)
        "hi": "hi-IN",    # Hindi
        "tr": "tr-TR",    # Turkish
    }

    # AWS Translate Language Codes (ISO 639-1)
    AWS_TRANSLATE_LANG_CODES = {
        "ko": "ko",    # Korean
        "en": "en",    # English
        "ja": "ja",    # Japanese
        "zh": "zh",    # Chinese (Simplified)
        "es": "es",    # Spanish
        "fr": "fr",    # French
        "de": "de",    # German
        "pt": "pt",    # Portuguese
        "ru": "ru",    # Russian
        "ar": "ar",    # Arabic
        "hi": "hi",    # Hindi
        "tr": "tr",    # Turkish
    }

    # Qwen3 Translation Model (Alibaba)
    QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen3-8B")

    # GPU Device
    GPU_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    # Language Names (for Qwen3 prompts)
    LANGUAGE_NAMES = {
        "ko": "Korean",
        "en": "English",
        "ja": "Japanese",
        "zh": "Chinese",
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "pt": "Portuguese",
        "ru": "Russian",
        "ar": "Arabic",
        "hi": "Hindi",
        "tr": "Turkish",
    }

    # AWS Polly
    AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")

    # gRPC
    GRPC_PORT = int(os.getenv("GRPC_PORT", 50051))
    MAX_WORKERS = int(os.getenv("MAX_WORKERS", 32))  # 동시 세션 처리를 위해 증가

    # Timeouts (seconds) - 실시간 응답을 위해 짧게 설정
    STT_TIMEOUT = 15  # Amazon Transcribe 타임아웃 (15초로 단축)
    TRANSLATION_TIMEOUT = 10  # 번역 타임아웃 (10초로 단축)
    TTS_TIMEOUT = 8  # TTS 타임아웃 (8초로 단축)

    # Filler words to skip TTS (common interjections/fillers)
    FILLER_WORDS = {
        # Korean fillers
        "네", "예", "응", "음", "어", "아", "으", "흠", "뭐", "그", "저",
        "아아", "어어", "음음", "네네", "예예", "그래", "응응",
        # English fillers
        "uh", "um", "ah", "oh", "hmm", "yeah", "yes", "no", "ok", "okay",
        "well", "so", "like", "you know", "i mean",
        # Japanese fillers
        "あ", "え", "う", "ん", "はい", "うん", "ええ", "まあ",
        # Chinese fillers
        "嗯", "啊", "哦", "呃", "好", "是",
    }

    # Minimum text length for TTS (characters)
    MIN_TTS_TEXT_LENGTH = 2


# =============================================================================
# Language Topology - 언어 어순 기반 버퍼링 전략
# =============================================================================

class BufferingStrategy(Enum):
    CHUNK_BASED = "chunk"       # 1.5초 단위 청크 (어순 유사)
    SENTENCE_BASED = "sentence" # 문장 완성 대기 (어순 상이)


class LanguageTopology:
    """
    언어 간 어순 유사도를 기반으로 버퍼링 전략을 결정합니다.

    - SOV 언어군: 한국어, 일본어, 터키어
    - SVO 언어군: 영어, 중국어, 스페인어, 프랑스어

    같은 어순 그룹 내에서는 CHUNK_BASED (1.5초),
    다른 어순 그룹 간에는 SENTENCE_BASED (문장 완성 대기)
    """

    # 어순 그룹 정의
    SOV_LANGUAGES = {"ko", "ja", "tr", "hi", "bn"}  # Subject-Object-Verb
    SVO_LANGUAGES = {"en", "zh", "es", "fr", "de", "pt", "ru", "it"}  # Subject-Verb-Object
    VSO_LANGUAGES = {"ar", "he"}  # Verb-Subject-Object

    # 어순 그룹 매핑
    WORD_ORDER_GROUPS = {
        **{lang: "SOV" for lang in SOV_LANGUAGES},
        **{lang: "SVO" for lang in SVO_LANGUAGES},
        **{lang: "VSO" for lang in VSO_LANGUAGES},
    }

    @classmethod
    def get_strategy(cls, source_lang: str, target_lang: str) -> BufferingStrategy:
        """
        소스 언어와 타겟 언어의 어순을 비교하여 버퍼링 전략 결정

        Returns:
            BufferingStrategy.CHUNK_BASED: 어순이 유사한 경우 (빠른 응답)
            BufferingStrategy.SENTENCE_BASED: 어순이 다른 경우 (정확한 번역)
        """
        source_group = cls.WORD_ORDER_GROUPS.get(source_lang, "SVO")
        target_group = cls.WORD_ORDER_GROUPS.get(target_lang, "SVO")

        if source_group == target_group:
            return BufferingStrategy.CHUNK_BASED
        else:
            return BufferingStrategy.SENTENCE_BASED

    @classmethod
    def get_buffer_duration_ms(cls, source_lang: str, target_lang: str) -> int:
        """버퍼링 전략에 따른 최대 버퍼 시간 반환"""
        strategy = cls.get_strategy(source_lang, target_lang)
        if strategy == BufferingStrategy.CHUNK_BASED:
            return Config.CHUNK_DURATION_MS
        else:
            return Config.SENTENCE_MAX_DURATION_MS


# =============================================================================
# Voice Activity Detection (VAD) - WebRTC VAD
# =============================================================================

class VADProcessor:
    """
    WebRTC VAD 기반 음성 활동 감지

    - 30ms 프레임 단위로 음성 여부 판단
    - 음성이 감지된 프레임만 축적
    - 침묵 지속 시 문장 끝으로 판단
    """

    def __init__(self, aggressiveness: int = 2):
        """
        Args:
            aggressiveness: VAD 민감도 (0-3, 3이 가장 공격적으로 비음성 제거)
        """
        self.vad = webrtcvad.Vad(aggressiveness)
        self.sample_rate = Config.SAMPLE_RATE
        self.frame_duration_ms = 30  # WebRTC VAD는 10, 20, 30ms 지원
        self.frame_size = int(self.sample_rate * self.frame_duration_ms / 1000) * 2  # bytes

        # 상태
        self.is_speaking = False
        self.silence_frames = 0
        self.speech_frames = 0

        # 설정
        self.min_speech_frames = 3    # 최소 음성 프레임 (노이즈 필터링)
        self.max_silence_frames = int(Config.SILENCE_DURATION_MS / self.frame_duration_ms)  # 400ms / 30ms = 13 프레임

    def calculate_rms(self, audio_bytes: bytes) -> float:
        """int16 오디오 데이터의 RMS 계산"""
        if len(audio_bytes) < 2:
            return 0.0
        arr = np.frombuffer(audio_bytes, dtype=np.int16)
        return float(np.sqrt(np.mean(arr.astype(np.float64) ** 2)))

    def has_speech(self, audio_bytes: bytes) -> bool:
        """
        오디오 청크에 음성이 있는지 확인

        Args:
            audio_bytes: int16 PCM 오디오 데이터

        Returns:
            음성 존재 여부
        """
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
                    # VAD 오류 시 RMS 폴백
                    rms = self.calculate_rms(frame)
                    if rms >= Config.SILENCE_THRESHOLD_RMS:
                        speech_frame_count += 1

        # 30% 이상의 프레임이 음성이면 음성으로 판단
        if total_frames > 0:
            speech_ratio = speech_frame_count / total_frames
            return speech_ratio >= 0.3
        return False

    def filter_speech(self, audio_bytes: bytes) -> bytes:
        """
        오디오에서 음성 구간만 추출

        Args:
            audio_bytes: int16 PCM 오디오 데이터

        Returns:
            음성 프레임만 포함된 오디오 데이터
        """
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
                    # VAD 오류 시 RMS 폴백
                    rms = self.calculate_rms(frame)
                    if rms >= Config.SILENCE_THRESHOLD_RMS:
                        speech_frames.append(frame)

        if speech_frames:
            return b''.join(speech_frames)
        return b''

    def process_chunk(self, audio_bytes: bytes) -> Tuple[bool, bool]:
        """
        오디오 청크 처리 및 문장 경계 탐지

        Returns:
            (has_speech, is_sentence_end): 음성 존재 여부, 문장 끝 감지 여부
        """
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
                    # 침묵이 지속되면 문장 끝
                    self.is_speaking = False
                    self.speech_frames = 0
                    self.silence_frames = 0
                    return False, True
            return False, False

    def reset(self):
        """상태 초기화"""
        self.is_speaking = False
        self.silence_frames = 0
        self.speech_frames = 0


# =============================================================================
# Participant & Session Management
# =============================================================================

@dataclass
class Participant:
    """참가자 정보"""
    participant_id: str
    nickname: str
    profile_img: str
    target_language: str
    translation_enabled: bool = True


@dataclass
class Speaker:
    """발화자 정보"""
    participant_id: str
    nickname: str
    profile_img: str
    source_language: str


@dataclass
class SessionState:
    """세션 상태 관리"""
    session_id: str
    room_id: str
    speaker: Speaker
    participants: Dict[str, Participant] = field(default_factory=dict)

    # 오디오 버퍼
    audio_buffer: bytearray = field(default_factory=bytearray)
    text_buffer: str = ""

    # VAD
    vad: VADProcessor = field(default_factory=VADProcessor)

    # 현재 버퍼링 전략 (타겟 언어에 따라 다를 수 있음)
    primary_strategy: BufferingStrategy = BufferingStrategy.CHUNK_BASED

    # 처리 통계
    chunks_processed: int = 0
    silence_skipped: int = 0
    sentences_completed: int = 0

    def get_target_languages(self) -> Set[str]:
        """번역이 활성화된 참가자들의 타겟 언어 목록"""
        languages = set()
        for p in self.participants.values():
            if p.translation_enabled and p.target_language != self.speaker.source_language:
                languages.add(p.target_language)
        return languages

    def get_participants_by_target_language(self, target_lang: str) -> List[str]:
        """특정 타겟 언어를 원하는 참가자 ID 목록"""
        return [
            p.participant_id for p in self.participants.values()
            if p.translation_enabled and p.target_language == target_lang
        ]

    def determine_primary_strategy(self) -> BufferingStrategy:
        """
        모든 타겟 언어를 고려하여 주요 버퍼링 전략 결정
        하나라도 SENTENCE_BASED가 필요하면 SENTENCE_BASED 사용
        """
        source_lang = self.speaker.source_language

        for target_lang in self.get_target_languages():
            strategy = LanguageTopology.get_strategy(source_lang, target_lang)
            if strategy == BufferingStrategy.SENTENCE_BASED:
                self.primary_strategy = BufferingStrategy.SENTENCE_BASED
                return self.primary_strategy

        self.primary_strategy = BufferingStrategy.CHUNK_BASED
        return self.primary_strategy


# =============================================================================
# Model Loaders
# =============================================================================

class AsyncLoopManager:
    """
    전용 asyncio 이벤트 루프 관리자

    별도 스레드에서 이벤트 루프를 실행하여 asyncio.run() 블로킹 문제 해결
    """
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

        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self._initialized = True

    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run_async(self, coro, timeout: float = 30.0):
        """
        비동기 코루틴을 실행하고 결과를 반환

        Args:
            coro: 실행할 코루틴
            timeout: 타임아웃 (초)

        Returns:
            코루틴 결과
        """
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        try:
            return future.result(timeout=timeout)
        except asyncio.TimeoutError:
            future.cancel()
            raise TimeoutError(f"Async operation timed out after {timeout}s")
        except Exception as e:
            raise e

    def shutdown(self):
        if self._initialized and self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=5)


class ModelManager:
    """모델 로딩 및 관리"""

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

        print("=" * 60)
        print("Loading AI Models...")
        print("=" * 60)

        # Async Loop Manager 초기화
        print("[0/3] Initializing Async Loop Manager...")
        self.async_manager = AsyncLoopManager()
        self.async_manager.initialize()
        print("      ✓ Async Loop Manager initialized")

        # STT: Amazon Transcribe Streaming
        print("[1/3] Initializing Amazon Transcribe Streaming...")
        self.transcribe_region = Config.AWS_REGION
        print(f"      Region: {self.transcribe_region}")
        print("      ✓ Amazon Transcribe initialized")

        # Translation: Qwen3-8B (Alibaba)
        print(f"[2/3] Loading Qwen3 {Config.QWEN_MODEL}...")
        self.qwen_tokenizer = AutoTokenizer.from_pretrained(
            Config.QWEN_MODEL,
            trust_remote_code=True
        )

        # GPU 메모리 확인 후 로딩 방식 결정
        if Config.GPU_DEVICE == "cuda":
            gpu_mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            print(f"      GPU Memory: {gpu_mem:.1f}GB")

            if gpu_mem >= 20:  # 20GB 이상이면 전체 GPU 로딩
                self.qwen_model = AutoModelForCausalLM.from_pretrained(
                    Config.QWEN_MODEL,
                    torch_dtype=torch.float16,
                    device_map={"": 0},  # 전체를 GPU 0에 로드
                    trust_remote_code=True,
                )
            else:  # 메모리 부족시 4bit 양자화
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

        # TTS: Amazon Polly
        print("[3/3] Initializing Amazon Polly...")
        self.polly_client = boto3.client("polly", region_name=Config.AWS_REGION)
        print("      ✓ Polly initialized")

        # Translation: AWS Translate (빠른 번역용)
        print("[3.5/3] Initializing AWS Translate...")
        self.translate_client = boto3.client("translate", region_name=Config.AWS_REGION)
        print(f"      ✓ AWS Translate initialized (backend: {Config.TRANSLATION_BACKEND})")

        print("=" * 60)
        print("All models loaded successfully!")
        print("=" * 60)

        self._initialized = True

        # 워밍업 실행
        self._warmup()

    def _warmup(self):
        """
        모델 워밍업 - 첫 번째 추론 지연을 방지

        CUDA 커널 컴파일, 메모리 할당 등이 첫 추론 시 발생하므로
        서버 시작 시 미리 실행하여 실제 요청 시 빠른 응답 보장
        """
        print("\n" + "=" * 60)
        print("Warming up models...")
        print("=" * 60)

        warmup_start = time.time()

        # 1. Translation 워밍업
        if Config.TRANSLATION_BACKEND == "aws":
            print("[Warmup] AWS Translate...")
            try:
                warmup_text = "안녕하세요"
                _ = self._translate_aws(warmup_text, "ko", "en")
                print("         ✓ AWS Translate warmup complete")
            except Exception as e:
                print(f"         ⚠ AWS Translate warmup failed: {e}")
        else:
            print("[Warmup] Translation model (Qwen3)...")
            try:
                warmup_text = "안녕하세요"
                _ = self._translate_qwen(warmup_text, "ko", "en")
                print("         ✓ Qwen3 warmup complete")
            except Exception as e:
                print(f"         ⚠ Qwen3 warmup failed: {e}")

        # 2. Amazon Polly TTS 워밍업
        print("[Warmup] TTS model (Polly)...")
        try:
            warmup_tts = "Hello"
            _, _ = self.synthesize_speech(warmup_tts, "en")
            print("         ✓ TTS warmup complete")
        except Exception as e:
            print(f"         ⚠ TTS warmup failed: {e}")

        # 3. WebRTC VAD 워밍업
        print("[Warmup] VAD processor...")
        try:
            vad = webrtcvad.Vad(2)
            # 30ms 프레임 (16kHz, 16-bit = 960 bytes)
            dummy_audio = bytes(960)
            _ = vad.is_speech(dummy_audio, 16000)
            print("         ✓ VAD warmup complete")
        except Exception as e:
            print(f"         ⚠ VAD warmup failed: {e}")

        warmup_time = time.time() - warmup_start
        print("=" * 60)
        print(f"Warmup completed in {warmup_time:.2f}s")
        print("=" * 60 + "\n")

    def transcribe(self, audio_data: np.ndarray, language: str) -> Tuple[str, float]:
        """
        음성을 텍스트로 변환 (Amazon Transcribe Streaming)

        Args:
            audio_data: float32 normalized audio array
            language: 언어 코드 (예: "ko", "en")

        Returns:
            (text, confidence)
        """
        try:
            # ========== 디버그: 오디오 분석 ==========
            audio_rms = np.sqrt(np.mean(audio_data ** 2))
            audio_max = np.max(np.abs(audio_data))
            audio_duration = len(audio_data) / Config.SAMPLE_RATE

            print(f"[STT DEBUG] Audio: {len(audio_data)} samples ({audio_duration:.2f}s), "
                  f"RMS={audio_rms:.4f}, Max={audio_max:.4f}")

            # 완전 침묵만 스킵 (매우 낮은 임계값)
            if audio_rms < 0.001:
                print(f"[STT] Skipped (silence): RMS={audio_rms:.6f}")
                return "", 0.0

            # Amazon Transcribe 언어 코드 변환
            transcribe_lang = Config.TRANSCRIBE_LANG_CODES.get(language, "en-US")
            print(f"[STT] Using Amazon Transcribe with language: {transcribe_lang}")

            # 오디오를 int16 bytes로 변환
            audio_int16 = (audio_data * 32768).clip(-32768, 32767).astype(np.int16)
            audio_bytes = audio_int16.tobytes()

            # 전용 이벤트 루프에서 스트리밍 전사 실행 (타임아웃 적용)
            result_text, confidence = self.async_manager.run_async(
                self._transcribe_streaming(audio_bytes, transcribe_lang),
                timeout=Config.STT_TIMEOUT
            )

            if result_text:
                print(f"[STT] Final result: {len(result_text)} chars (confidence={confidence:.2f})")
            else:
                print(f"[STT] No speech detected")

            return result_text, confidence

        except TimeoutError as e:
            print(f"[STT Timeout] {e}")
            return "", 0.0
        except Exception as e:
            import traceback
            print(f"[STT Error] {e}")
            print(f"[STT Error Traceback] {traceback.format_exc()}")
            return "", 0.0

    async def _transcribe_streaming(self, audio_bytes: bytes, language_code: str) -> Tuple[str, float]:
        """
        Amazon Transcribe Streaming을 사용한 음성 전사

        Args:
            audio_bytes: int16 PCM audio bytes
            language_code: Amazon Transcribe 언어 코드 (예: "ko-KR", "en-US")

        Returns:
            (text, confidence)
        """
        client = TranscribeStreamingClient(region=self.transcribe_region)

        # 전사 결과를 수집할 핸들러
        class ResultHandler(TranscriptResultStreamHandler):
            def __init__(self, stream):
                super().__init__(stream)
                self.transcripts: List[Tuple[str, float]] = []  # (text, confidence)

            async def handle_transcript_event(self, event: TranscriptEvent):
                results = event.transcript.results
                for result in results:
                    if not result.is_partial:  # 최종 결과만 처리
                        for alt in result.alternatives:
                            text = alt.transcript.strip()
                            conf = alt.confidence if hasattr(alt, 'confidence') and alt.confidence else 0.95
                            if text:
                                self.transcripts.append((text, conf))
                                print(f"[Transcribe] Final: {len(text)} chars (conf={conf:.2f})")

        try:
            # 스트리밍 세션 시작
            stream = await client.start_stream_transcription(
                language_code=language_code,
                media_sample_rate_hz=Config.SAMPLE_RATE,
                media_encoding="pcm",
            )

            handler = ResultHandler(stream.output_stream)

            # 오디오를 청크로 나누어 전송 (8KB 청크)
            chunk_size = 8192
            async def send_audio():
                for i in range(0, len(audio_bytes), chunk_size):
                    chunk = audio_bytes[i:i + chunk_size]
                    await stream.input_stream.send_audio_event(audio_chunk=chunk)
                await stream.input_stream.end_stream()

            # 오디오 전송과 결과 수신을 동시에 처리
            await asyncio.gather(
                send_audio(),
                handler.handle_events()
            )

            # 결과 조합
            if handler.transcripts:
                texts = [t[0] for t in handler.transcripts]
                confidences = [t[1] for t in handler.transcripts]
                full_text = " ".join(texts)
                avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
                return full_text, avg_confidence
            else:
                return "", 0.0

        except Exception as e:
            print(f"[Transcribe Error] {e}")
            return "", 0.0

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        텍스트 번역 (AWS Translate 또는 Qwen3-8B)

        Args:
            text: 원본 텍스트
            source_lang: 소스 언어 코드 (ko, en, ja, zh 등)
            target_lang: 타겟 언어 코드

        Returns:
            번역된 텍스트
        """
        if not text.strip():
            return ""

        # 같은 언어면 번역 불필요
        if source_lang == target_lang:
            return text

        # 번역 백엔드 선택
        if Config.TRANSLATION_BACKEND == "aws":
            return self._translate_aws(text, source_lang, target_lang)
        else:
            return self._translate_qwen(text, source_lang, target_lang)

    def _translate_aws(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        AWS Translate를 사용한 빠른 번역 (50-100ms)
        """
        try:
            # AWS Translate 언어 코드 변환
            aws_source = Config.AWS_TRANSLATE_LANG_CODES.get(source_lang, source_lang)
            aws_target = Config.AWS_TRANSLATE_LANG_CODES.get(target_lang, target_lang)

            start_time = time.time()

            response = self.translate_client.translate_text(
                Text=text,
                SourceLanguageCode=aws_source,
                TargetLanguageCode=aws_target,
            )

            result = response['TranslatedText']
            elapsed = (time.time() - start_time) * 1000

            print(f"[AWS Translate] {source_lang}→{target_lang}: {len(text)} chars → {len(result)} chars ({elapsed:.0f}ms)")
            return result

        except Exception as e:
            print(f"[AWS Translate Error] {e}, falling back to Qwen")
            # AWS 실패 시 Qwen으로 폴백
            return self._translate_qwen(text, source_lang, target_lang)

    def _translate_qwen(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        Qwen3-8B를 사용한 로컬 번역 (느리지만 오프라인 가능)
        """
        # 언어 이름 가져오기
        source_name = Config.LANGUAGE_NAMES.get(source_lang, "English")
        target_name = Config.LANGUAGE_NAMES.get(target_lang, "English")

        try:
            start_time = time.time()

            # 번역 프롬프트 구성 (명확하고 직접적, 이중 번역 방지)
            prompt = f"""Translate this {source_name} text to {target_name}.
Rules:
- Output ONLY the {target_name} translation
- Do NOT include the original text
- Do NOT include any other language
- Do NOT add explanations or notes

Text: {text}

{target_name} translation:"""

            # Qwen3 chat 형식으로 메시지 구성
            messages = [
                {"role": "user", "content": prompt}
            ]

            # 토크나이즈
            input_text = self.qwen_tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False  # 번역은 thinking 불필요
            )
            inputs = self.qwen_tokenizer(
                input_text,
                return_tensors="pt",
                truncation=True,
                max_length=512
            ).to(self.qwen_model.device)

            # 번역 생성
            with torch.no_grad():
                outputs = self.qwen_model.generate(
                    **inputs,
                    max_new_tokens=256,
                    do_sample=False,  # 결정적 출력
                    temperature=None,
                    top_p=None,
                    pad_token_id=self.qwen_tokenizer.eos_token_id,
                )

            # 디코딩 (입력 부분 제외)
            input_len = inputs["input_ids"].shape[1]
            result = self.qwen_tokenizer.decode(
                outputs[0][input_len:],
                skip_special_tokens=True
            ).strip()

            # 결과 정제 (불필요한 접두어 제거)
            result = self._clean_translation(result)

            elapsed = (time.time() - start_time) * 1000
            print(f"[Qwen Translation] {source_lang}→{target_lang}: {len(text)} chars → {len(result)} chars ({elapsed:.0f}ms)")
            return result

        except Exception as e:
            import traceback
            print(f"[Qwen Translation Error] {e}")
            print(f"[Qwen Translation Traceback] {traceback.format_exc()}")
            return ""

    def _clean_translation(self, text: str, target_lang: str = "") -> str:
        """
        번역 결과에서 불필요한 접두어 및 이중 번역 제거

        Qwen3가 때때로 여러 언어로 번역하거나 설명을 추가하는 경우 처리
        """
        result = text.strip()

        # 1. 흔한 접두어 패턴 제거
        prefixes = [
            "Here is the translation:",
            "Here's the translation:",
            "Translation:",
            "The translation is:",
            "Translated text:",
            "In English:",
            "In Korean:",
            "In Japanese:",
            "In Chinese:",
        ]
        for prefix in prefixes:
            if result.lower().startswith(prefix.lower()):
                result = result[len(prefix):].strip()

        # 2. 이중 번역 방지: 여러 줄이 있으면 첫 번째 의미있는 줄만 사용
        lines = [line.strip() for line in result.split('\n') if line.strip()]
        if len(lines) > 1:
            # 첫 번째 줄이 너무 짧으면 (라벨일 수 있음) 두 번째 줄 사용
            if len(lines[0]) < 5 and len(lines) > 1:
                result = lines[1]
            else:
                result = lines[0]
        elif lines:
            result = lines[0]

        # 3. 따옴표 제거
        if (result.startswith('"') and result.endswith('"')) or \
           (result.startswith("'") and result.endswith("'")):
            result = result[1:-1]

        # 4. 괄호로 둘러싸인 설명 제거 (예: "(Translation: ...)" 또는 "(English)")
        import re
        result = re.sub(r'\s*\([^)]*translation[^)]*\)\s*', '', result, flags=re.IGNORECASE)
        result = re.sub(r'\s*\([^)]*english[^)]*\)\s*', '', result, flags=re.IGNORECASE)
        result = re.sub(r'\s*\([^)]*korean[^)]*\)\s*', '', result, flags=re.IGNORECASE)

        # 5. 이중 언어 출력 감지 및 제거 (예: "한국어 → English")
        arrow_patterns = [' → ', ' -> ', ' - ', ' / ']
        for arrow in arrow_patterns:
            if arrow in result:
                parts = result.split(arrow)
                if len(parts) == 2:
                    # 타겟 언어에 맞는 부분 선택
                    # 기본적으로 첫 번째 부분 사용 (보통 타겟 언어가 먼저 옴)
                    result = parts[0].strip()
                    break

        return result.strip()

    def synthesize_speech(self, text: str, target_lang: str) -> Tuple[bytes, int]:
        """
        텍스트를 음성으로 합성 (Amazon Polly)

        Args:
            text: 합성할 텍스트
            target_lang: 타겟 언어 코드

        Returns:
            (audio_bytes, duration_ms)
        """
        if not text.strip():
            return b"", 0

        # Polly 음성 ID 및 엔진 매핑
        # Neural 지원 음성: Seoyeon(ko), Joanna(en), Zhiyu(zh), Takumi(ja), Lucia(es), Lea(fr), Vicki(de), Camila(pt)
        voice_config = {
            "ko": ("Seoyeon", "neural"),
            "en": ("Joanna", "neural"),
            "zh": ("Zhiyu", "neural"),
            "ja": ("Takumi", "neural"),  # Mizuki는 neural 미지원, Takumi 사용
            "es": ("Lucia", "neural"),
            "fr": ("Lea", "neural"),
            "de": ("Vicki", "neural"),
            "pt": ("Camila", "neural"),
            "ru": ("Tatyana", "standard"),  # neural 미지원
            "ar": ("Zeina", "standard"),    # neural 미지원
            "hi": ("Aditi", "standard"),    # neural 미지원
            "tr": ("Filiz", "standard"),    # neural 미지원
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

            # 대략적인 duration 계산 (MP3 비트레이트 기준)
            # 실제로는 AudioStream의 메타데이터에서 가져와야 함
            duration_ms = int(len(audio_data) / 24 * 8)  # 대략적 추정

            return audio_data, duration_ms

        except Exception as e:
            error_name = type(e).__name__
            if "AccessDenied" in str(e) or "AccessDenied" in error_name:
                print(f"[TTS Error] ❌ AWS Polly AccessDeniedException - IAM 권한 필요!")
                print(f"[TTS Error] IAM 사용자에 'AmazonPollyFullAccess' 정책을 추가하세요.")
            else:
                print(f"[TTS Error] {error_name}: {e}")
            return b"", 0


# =============================================================================
# gRPC Service Implementation
# =============================================================================

class ConversationServicer(conversation_pb2_grpc.ConversationServiceServicer):
    """gRPC 서비스 구현"""

    def __init__(self, model_manager: ModelManager):
        self.models = model_manager
        self.sessions: Dict[str, SessionState] = {}
        self.lock = threading.Lock()

    def StreamChat(self, request_iterator, context):
        """양방향 스트리밍 RPC 처리"""
        session_state: Optional[SessionState] = None
        current_session_id = None

        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] New stream connected")

        try:
            for request in request_iterator:
                current_session_id = request.session_id
                room_id = request.room_id
                participant_id = request.participant_id
                payload_type = request.WhichOneof('payload')

                # 세션 초기화
                if payload_type == 'session_init':
                    init = request.session_init

                    # 발화자 정보
                    speaker = Speaker(
                        participant_id=init.speaker.participant_id,
                        nickname=init.speaker.nickname,
                        profile_img=init.speaker.profile_img,
                        source_language=init.speaker.source_language,
                    )

                    # 참가자 목록
                    participants = {}
                    for p in init.participants:
                        participants[p.participant_id] = Participant(
                            participant_id=p.participant_id,
                            nickname=p.nickname,
                            profile_img=p.profile_img,
                            target_language=p.target_language,
                            translation_enabled=p.translation_enabled
                        )

                    # 세션 상태 생성
                    session_state = SessionState(
                        session_id=current_session_id,
                        room_id=room_id,
                        speaker=speaker,
                        participants=participants
                    )

                    # 버퍼링 전략 결정
                    session_state.determine_primary_strategy()

                    with self.lock:
                        self.sessions[current_session_id] = session_state

                    strategy_name = "CHUNK (1.5s)" if session_state.primary_strategy == BufferingStrategy.CHUNK_BASED else "SENTENCE"
                    target_langs = session_state.get_target_languages()

                    print(f"[Session Init] {current_session_id[:8]}...")
                    print(f"  Speaker: {speaker.nickname} (speaks: {speaker.source_language})")
                    print(f"  Participants: {[(p.nickname, p.target_language) for p in session_state.participants.values()]}")
                    print(f"  Targets to translate: {target_langs}")
                    print(f"  Strategy: {strategy_name}")
                    if not target_langs:
                        print(f"  ⚠️ WARNING: No translation targets! sourceLang={speaker.source_language}, check participant targetLanguages")

                    # Ready 상태 전송
                    yield conversation_pb2.ChatResponse(
                        session_id=current_session_id,
                        room_id=room_id,
                        status=conversation_pb2.SessionStatus(
                            status=conversation_pb2.SessionStatus.READY,
                            message="Session initialized",
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

                # 오디오 청크 처리 (VAD 전처리 적용)
                elif payload_type == 'audio_chunk' and session_state:
                    audio_chunk = request.audio_chunk
                    chunk_bytes = len(audio_chunk)
                    audio_duration = chunk_bytes / Config.BYTES_PER_SECOND

                    # VAD로 음성 여부 확인
                    vad = session_state.vad
                    has_speech, is_sentence_end = vad.process_chunk(audio_chunk)

                    # 처리 임계값 (최소 0.5초, 최대 3초)
                    min_speech_bytes = int(Config.BYTES_PER_SECOND * 0.5)  # 0.5초
                    max_buffer_bytes = Config.SENTENCE_MAX_BYTES  # 3초

                    if has_speech:
                        # 음성 프레임만 추출하여 버퍼에 누적
                        speech_audio = vad.filter_speech(audio_chunk)
                        if speech_audio:
                            session_state.audio_buffer.extend(speech_audio)
                            speech_duration = len(speech_audio) / Config.BYTES_PER_SECOND
                            buffer_total = len(session_state.audio_buffer) / Config.BYTES_PER_SECOND
                            print(f"[VAD] Speech: +{speech_duration:.2f}s, buffer: {buffer_total:.2f}s")

                    # 문장 끝 감지 또는 버퍼가 3초 이상이면 처리
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
                            vad.reset()  # 버퍼 오버플로우 시에만 VAD 리셋

                        buffer_duration = len(process_bytes) / Config.BYTES_PER_SECOND
                        print(f"[VAD] Processing ({process_reason}): {buffer_duration:.2f}s")

                        # 오디오 처리 (에러 발생해도 스트림 유지)
                        try:
                            for response in self._process_audio(session_state, process_bytes, True):
                                yield response
                        except Exception as proc_err:
                            print(f"[Audio Processing Error] {proc_err}")
                            # 에러 발생해도 스트림 계속 유지

                # 세션 종료
                elif payload_type == 'session_end':
                    if session_state:
                        # VAD 리셋
                        session_state.vad.reset()

                        # 남은 버퍼 처리 (최소 0.3초 이상)
                        min_speech_bytes = int(Config.BYTES_PER_SECOND * 0.3)
                        if len(session_state.audio_buffer) >= min_speech_bytes:
                            process_bytes = bytes(session_state.audio_buffer)
                            session_state.audio_buffer.clear()

                            try:
                                for response in self._process_audio(session_state, process_bytes, True):
                                    yield response
                            except Exception as proc_err:
                                print(f"[Session End Processing Error] {proc_err}")
                        else:
                            session_state.audio_buffer.clear()

                    # 세션 정리
                    if current_session_id:
                        with self.lock:
                            self.sessions.pop(current_session_id, None)

                    print(f"[Session End] {current_session_id[:8] if current_session_id else 'unknown'}...")
                    if session_state:
                        print(f"  Processed: {session_state.chunks_processed}")
                        print(f"  Sentences: {session_state.sentences_completed}")
                        print(f"  Skipped: {session_state.silence_skipped}")

                    break

        except Exception as e:
            print(f"[Stream Error] {e}")
            yield conversation_pb2.ChatResponse(
                session_id=current_session_id or "",
                error=conversation_pb2.ErrorResponse(
                    code="STREAM_ERROR",
                    message=str(e)
                )
            )

        finally:
            # 정리
            if current_session_id:
                with self.lock:
                    self.sessions.pop(current_session_id, None)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Stream closed")

    def _process_audio(self, state: SessionState, audio_bytes: bytes, is_final: bool):
        """
        오디오 버퍼 처리 및 응답 생성

        Note: LiveKit에서 이미 오디오를 처리하므로 VAD 필터링 없이 바로 처리
        모든 오디오를 처리 (짧은 오디오도 스킵하지 않음)

        Yields:
            ChatResponse 메시지들
        """
        audio_duration = len(audio_bytes) / Config.BYTES_PER_SECOND
        print(f"[Audio] Processing {len(audio_bytes)} bytes ({audio_duration:.1f}s)")

        state.chunks_processed += 1
        if is_final:
            state.sentences_completed += 1

        # 오디오 정규화
        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # STT
        source_lang = state.speaker.source_language
        print(f"[STT] Starting transcription: lang={source_lang}, samples={len(audio_array)}")
        original_text, confidence = self.models.transcribe(audio_array, source_lang)

        if not original_text:
            print(f"[STT] No text detected from audio")
            return

        print(f"[STT] Result: {len(original_text)} chars (confidence: {confidence:.2f})")

        # Check if text is a filler word (skip translation/TTS but still send transcript)
        is_filler = original_text.lower().strip() in Config.FILLER_WORDS or \
                    original_text.strip() in Config.FILLER_WORDS
        if is_filler:
            print(f"[Filter] Skipping filler word")
            # Still send transcript for chat log, but skip translation/TTS
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
                    translations=[],  # No translation for filler
                    is_partial=False,
                    is_final=True,
                    timestamp_ms=int(time.time() * 1000),
                    confidence=confidence
                )
            )
            return

        # 고유 ID 생성
        transcript_id = str(uuid.uuid4())[:8]

        # 타겟 언어별 번역 수행
        target_languages = state.get_target_languages()
        translations = []

        # Skip translation for very short texts (1 character)
        if len(original_text.strip()) <= 1:
            print(f"[Translation] Skipping very short text: {len(original_text)} chars")
            # Still send transcript without translation
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

        for target_lang in target_languages:
            # 번역
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
                print(f"    → {target_lang}: {len(translated_text)} chars")

        # 1. Transcript 결과 전송
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

        # 2. TTS 오디오 생성 및 전송 (타겟별)
        for translation in translations:
            target_lang = translation.target_language
            translated_text = translation.translated_text

            # Skip TTS for very short translations (filler-like)
            if len(translated_text.strip()) < Config.MIN_TTS_TEXT_LENGTH:
                print(f"[TTS] Skipping short text: {len(translated_text)} chars")
                continue

            # Skip TTS if translated text is also a filler word
            if translated_text.lower().strip() in Config.FILLER_WORDS or \
               translated_text.strip() in Config.FILLER_WORDS:
                print(f"[TTS] Skipping filler translation")
                continue

            print(f"[TTS] Synthesizing: {len(translated_text)} chars (lang={target_lang})")
            audio_data, duration_ms = self.models.synthesize_speech(translated_text, target_lang)

            if audio_data:
                print(f"[TTS] Generated {len(audio_data)} bytes, duration={duration_ms}ms")
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
            else:
                print(f"[TTS] Failed to generate audio: {len(translated_text)} chars (lang={target_lang})")

    def UpdateParticipantSettings(self, request, context):
        """참가자 설정 업데이트"""
        room_id = request.room_id
        participant_id = request.participant_id

        # 해당 방의 모든 세션에서 참가자 설정 업데이트
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
    # 모델 로딩
    model_manager = ModelManager()
    model_manager.initialize()

    # gRPC 서버 시작
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=Config.MAX_WORKERS),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),  # 50MB
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )

    servicer = ConversationServicer(model_manager)
    conversation_pb2_grpc.add_ConversationServiceServicer_to_server(servicer, server)
    server.add_insecure_port(f'0.0.0.0:{Config.GRPC_PORT}')
    server.start()

    translation_backend = "AWS Translate (FAST)" if Config.TRANSLATION_BACKEND == "aws" else Config.QWEN_MODEL.split('/')[-1]
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  Python AI Server v10 - Real-time Translation                ║
╠══════════════════════════════════════════════════════════════╣
║  gRPC Port:     {Config.GRPC_PORT}                                        ║
║  Region:        {Config.AWS_REGION}                              ║
║  Device:        {Config.GPU_DEVICE.upper()}                                       ║
╠══════════════════════════════════════════════════════════════╣
║  STT:           Amazon Transcribe Streaming                  ║
║  Translation:   {translation_backend:<41} ║
║  TTS:           Amazon Polly                                 ║
╠══════════════════════════════════════════════════════════════╣
║  Real-time Settings:                                         ║
║    - Max buffer: {Config.SENTENCE_MAX_DURATION_MS}ms                                     ║
║    - Silence detection: {Config.SILENCE_DURATION_MS}ms                              ║
╚══════════════════════════════════════════════════════════════╝
""")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.stop(grace=5)


if __name__ == '__main__':
    serve()
