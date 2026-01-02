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

# faster-whisper for STT (optional)
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    print("[INFO] faster-whisper not installed. Using Amazon Transcribe.")

# Amazon Transcribe Streaming
try:
    from amazon_transcribe.client import TranscribeStreamingClient
    from amazon_transcribe.handlers import TranscriptResultStreamHandler
    from amazon_transcribe.model import TranscriptEvent
    AMAZON_TRANSCRIBE_AVAILABLE = True
except ImportError:
    AMAZON_TRANSCRIBE_AVAILABLE = False
    print("[WARNING] amazon-transcribe not installed. Install with: pip install amazon-transcribe")

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

    # STT Backend: "whisper" (local, fast) or "transcribe" (AWS)
    STT_BACKEND = os.getenv("STT_BACKEND", "whisper")  # Default to faster-whisper (local GPU)

    # faster-whisper model settings (Option A: Speed Optimized)
    WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")  # Options: tiny, base, small, medium, large-v3, large-v3-turbo
    WHISPER_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    WHISPER_COMPUTE_TYPE = "int8_float16" if torch.cuda.is_available() else "int8"  # int8_float16: 더 빠르고 메모리 절약

    # Real-time optimized parameters
    WHISPER_BEAM_SIZE = 1       # 5 → 1: 가장 큰 속도 향상
    WHISPER_BEST_OF = 1         # 5 → 1: 속도 향상
    WHISPER_TEMPERATURE = 0.0   # 고정값 (fallback 없음)

    # Translation backend: "aws" (fast) or "qwen" (local LLM)
    TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND", "aws")

    # Language code mappings for Whisper
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

    # Room Cache Settings
    CACHE_TTL_SECONDS = 10  # 캐시 유효 시간 (10초)
    CACHE_CLEANUP_INTERVAL = 30  # 캐시 정리 간격 (30초)


# =============================================================================
# Room-based Cache Manager - STT/Translation/TTS 결과 캐싱
# =============================================================================

@dataclass
class CacheEntry:
    """캐시 엔트리"""
    value: any
    created_at: float
    ttl: float = Config.CACHE_TTL_SECONDS

    def is_expired(self) -> bool:
        return time.time() - self.created_at > self.ttl


class RoomCacheManager:
    """
    Room 기반 캐시 매니저

    동일 Room 내에서 동일한 발화에 대해:
    - STT 결과: 1회만 처리
    - 번역 결과: 타겟 언어별 1회만 처리
    - TTS 결과: 타겟 언어별 1회만 처리

    이를 통해 같은 언어를 원하는 여러 리스너가 동일한 결과를 공유
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

        # room_id -> speaker_id -> cache_key -> CacheEntry
        self.stt_cache: Dict[str, Dict[str, Dict[str, CacheEntry]]] = defaultdict(lambda: defaultdict(dict))
        self.translation_cache: Dict[str, Dict[str, CacheEntry]] = defaultdict(dict)  # cache_key -> CacheEntry
        self.tts_cache: Dict[str, Dict[str, CacheEntry]] = defaultdict(dict)  # cache_key -> CacheEntry

        # 리스너 관리: room_id -> target_lang -> set of listener_ids
        self.room_listeners: Dict[str, Dict[str, Set[str]]] = defaultdict(lambda: defaultdict(set))

        # 결과 대기 큐: 동일 요청이 처리 중일 때 대기
        self.pending_requests: Dict[str, threading.Event] = {}

        self._cache_lock = threading.Lock()
        self._initialized = True

        # 주기적 캐시 정리 스레드 시작
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

        DebugLogger.log("CACHE", "RoomCacheManager initialized")

    def _cleanup_loop(self):
        """주기적으로 만료된 캐시 정리"""
        while True:
            time.sleep(Config.CACHE_CLEANUP_INTERVAL)
            self._cleanup_expired()

    def _cleanup_expired(self):
        """만료된 캐시 엔트리 제거"""
        with self._cache_lock:
            now = time.time()
            cleaned = 0

            # STT 캐시 정리
            for room_id in list(self.stt_cache.keys()):
                for speaker_id in list(self.stt_cache[room_id].keys()):
                    for key in list(self.stt_cache[room_id][speaker_id].keys()):
                        if self.stt_cache[room_id][speaker_id][key].is_expired():
                            del self.stt_cache[room_id][speaker_id][key]
                            cleaned += 1

            # Translation 캐시 정리
            for key in list(self.translation_cache.keys()):
                if self.translation_cache[key].is_expired():
                    del self.translation_cache[key]
                    cleaned += 1

            # TTS 캐시 정리
            for key in list(self.tts_cache.keys()):
                if self.tts_cache[key].is_expired():
                    del self.tts_cache[key]
                    cleaned += 1

            if cleaned > 0:
                DebugLogger.log("CACHE_CLEANUP", f"Cleaned {cleaned} expired entries")

    def register_listener(self, room_id: str, listener_id: str, target_lang: str):
        """리스너 등록"""
        with self._cache_lock:
            self.room_listeners[room_id][target_lang].add(listener_id)
            DebugLogger.log("CACHE", f"Listener registered", {
                "room": room_id[:8] if room_id else "unknown",
                "listener": listener_id[:8] if listener_id else "unknown",
                "target_lang": target_lang,
                "total_listeners": len(self.room_listeners[room_id][target_lang])
            })

    def unregister_listener(self, room_id: str, listener_id: str, target_lang: str):
        """리스너 해제"""
        with self._cache_lock:
            if room_id in self.room_listeners and target_lang in self.room_listeners[room_id]:
                self.room_listeners[room_id][target_lang].discard(listener_id)

    def get_listeners_for_language(self, room_id: str, target_lang: str) -> Set[str]:
        """특정 타겟 언어의 모든 리스너 ID 반환"""
        with self._cache_lock:
            return self.room_listeners[room_id][target_lang].copy()

    def _make_audio_hash(self, audio_bytes: bytes) -> str:
        """오디오 데이터의 해시 생성 (빠른 비교용)"""
        import hashlib
        return hashlib.md5(audio_bytes).hexdigest()[:16]

    def get_or_create_stt(self, room_id: str, speaker_id: str, audio_bytes: bytes,
                          transcribe_fn) -> Tuple[str, float, bool]:
        """
        STT 결과 캐시에서 가져오거나 새로 생성

        Returns:
            (text, confidence, was_cached)
        """
        audio_hash = self._make_audio_hash(audio_bytes)
        cache_key = f"{room_id}:{speaker_id}:{audio_hash}"

        event = None
        with self._cache_lock:
            # 캐시 확인
            if room_id in self.stt_cache and speaker_id in self.stt_cache[room_id]:
                if audio_hash in self.stt_cache[room_id][speaker_id]:
                    entry = self.stt_cache[room_id][speaker_id][audio_hash]
                    if not entry.is_expired():
                        DebugLogger.log("CACHE_HIT", "STT cache hit", {"key": cache_key[:16]})
                        return entry.value[0], entry.value[1], True

            # 처리 중인지 확인
            if cache_key in self.pending_requests:
                event = self.pending_requests[cache_key]

        # 다른 스레드가 처리 중이면 대기
        if event is not None:
            event.wait(timeout=Config.STT_TIMEOUT)
            with self._cache_lock:
                if room_id in self.stt_cache and speaker_id in self.stt_cache[room_id]:
                    if audio_hash in self.stt_cache[room_id][speaker_id]:
                        entry = self.stt_cache[room_id][speaker_id][audio_hash]
                        return entry.value[0], entry.value[1], True

        # 처리 시작 마킹
        with self._cache_lock:
            self.pending_requests[cache_key] = threading.Event()

        try:
            # 실제 STT 처리
            text, confidence = transcribe_fn(audio_bytes)

            # 결과 캐시
            with self._cache_lock:
                self.stt_cache[room_id][speaker_id][audio_hash] = CacheEntry(
                    value=(text, confidence),
                    created_at=time.time()
                )
                DebugLogger.log("CACHE_SET", "STT cached", {"key": cache_key[:16], "text_len": len(text)})

            return text, confidence, False
        finally:
            with self._cache_lock:
                if cache_key in self.pending_requests:
                    self.pending_requests[cache_key].set()
                    del self.pending_requests[cache_key]

    def get_or_create_translation(self, room_id: str, text: str, source_lang: str, target_lang: str,
                                   translate_fn) -> Tuple[str, bool]:
        """
        번역 결과 캐시에서 가져오거나 새로 생성

        Returns:
            (translated_text, was_cached)
        """
        # room_id를 포함하여 방 간 캐시 누출 방지
        cache_key = f"{room_id}:{source_lang}:{target_lang}:{hash(text)}"

        with self._cache_lock:
            if cache_key in self.translation_cache:
                entry = self.translation_cache[cache_key]
                if not entry.is_expired():
                    DebugLogger.log("CACHE_HIT", "Translation cache hit", {"room": room_id[:8], "key": cache_key[:24]})
                    return entry.value, True

        # 실제 번역 처리
        translated = translate_fn(text, source_lang, target_lang)

        # 결과 캐시
        with self._cache_lock:
            self.translation_cache[cache_key] = CacheEntry(
                value=translated,
                created_at=time.time()
            )
            DebugLogger.log("CACHE_SET", "Translation cached", {"room": room_id[:8], "key": cache_key[:24]})

        return translated, False

    def get_or_create_tts(self, room_id: str, text: str, target_lang: str,
                          synthesize_fn) -> Tuple[bytes, int, bool]:
        """
        TTS 결과 캐시에서 가져오거나 새로 생성

        Returns:
            (audio_bytes, duration_ms, was_cached)
        """
        # room_id를 포함하여 방 간 캐시 누출 방지
        cache_key = f"{room_id}:tts:{target_lang}:{hash(text)}"

        with self._cache_lock:
            if cache_key in self.tts_cache:
                entry = self.tts_cache[cache_key]
                if not entry.is_expired():
                    DebugLogger.log("CACHE_HIT", "TTS cache hit", {"room": room_id[:8], "key": cache_key[:24]})
                    return entry.value[0], entry.value[1], True

        # 실제 TTS 처리
        audio_bytes, duration_ms = synthesize_fn(text, target_lang)

        # 결과 캐시
        with self._cache_lock:
            self.tts_cache[cache_key] = CacheEntry(
                value=(audio_bytes, duration_ms),
                created_at=time.time()
            )
            DebugLogger.log("CACHE_SET", "TTS cached", {"room": room_id[:8], "key": cache_key[:24]})

        return audio_bytes, duration_ms, False


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
# Async Loop Manager (for Amazon Transcribe Streaming)
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
        """비동기 코루틴을 실행하고 결과를 반환"""
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


# =============================================================================
# Model Manager with Amazon Transcribe / faster-whisper
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
        print("Loading AI Models (v10)")
        print("=" * 70)

        # 0. Async Loop Manager (for Amazon Transcribe) + Room Cache Manager
        print("[0/5] Initializing Async Loop Manager & Room Cache...")
        self.async_manager = AsyncLoopManager()
        self.async_manager.initialize()
        self.room_cache = RoomCacheManager()
        self.room_cache.initialize()
        print("      ✓ Async Loop Manager & Room Cache initialized")

        # 1. STT Backend
        self.whisper_model = None
        self.transcribe_region = Config.AWS_REGION

        if Config.STT_BACKEND == "whisper" and FASTER_WHISPER_AVAILABLE:
            print(f"[1/4] Loading faster-whisper ({Config.WHISPER_MODEL_SIZE})...")
            print(f"      Device: {Config.WHISPER_DEVICE}, Compute: {Config.WHISPER_COMPUTE_TYPE}")

            self.whisper_model = WhisperModel(
                Config.WHISPER_MODEL_SIZE,
                device=Config.WHISPER_DEVICE,
                compute_type=Config.WHISPER_COMPUTE_TYPE,
            )
            print("      ✓ faster-whisper loaded")
        elif Config.STT_BACKEND == "transcribe" and AMAZON_TRANSCRIBE_AVAILABLE:
            print(f"[1/4] Initializing Amazon Transcribe Streaming...")
            print(f"      Region: {self.transcribe_region}")
            print("      ✓ Amazon Transcribe initialized")
        else:
            print("[1/4] ⚠ No STT backend available!")
            print(f"      STT_BACKEND={Config.STT_BACKEND}")
            print(f"      WHISPER_AVAILABLE={FASTER_WHISPER_AVAILABLE}")
            print(f"      TRANSCRIBE_AVAILABLE={AMAZON_TRANSCRIBE_AVAILABLE}")

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
                self.transcripts: List[Tuple[str, float]] = []

            async def handle_transcript_event(self, event: TranscriptEvent):
                results = event.transcript.results
                for result in results:
                    if not result.is_partial:  # 최종 결과만 처리
                        for alt in result.alternatives:
                            text = alt.transcript.strip()
                            conf = alt.confidence if hasattr(alt, 'confidence') and alt.confidence else 0.95
                            if text:
                                self.transcripts.append((text, conf))
                                DebugLogger.log("TRANSCRIBE", f"Segment: {text[:50]}", {"conf": f"{conf:.2f}"})

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
            DebugLogger.log("TRANSCRIBE_ERROR", f"Amazon Transcribe failed: {e}")
            return "", 0.0

    def transcribe(self, audio_data: np.ndarray, language: str) -> Tuple[str, float]:
        """
        Speech to Text using Amazon Transcribe or faster-whisper

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
            "language": language,
            "backend": Config.STT_BACKEND
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
            result_text = ""
            confidence = 0.0

            # ===== Amazon Transcribe Backend =====
            if Config.STT_BACKEND == "transcribe" and AMAZON_TRANSCRIBE_AVAILABLE:
                # Get the Transcribe language code
                transcribe_lang = Config.TRANSCRIBE_LANG_CODES.get(language, "en-US")
                DebugLogger.log("STT_LANG", f"Using Amazon Transcribe: {transcribe_lang} (from: {language})")

                # Convert float32 to int16 bytes
                audio_int16 = (audio_data * 32768).clip(-32768, 32767).astype(np.int16)
                audio_bytes = audio_int16.tobytes()

                # Run streaming transcription via AsyncLoopManager
                result_text, confidence = self.async_manager.run_async(
                    self._transcribe_streaming(audio_bytes, transcribe_lang),
                    timeout=Config.STT_TIMEOUT
                )

            # ===== faster-whisper Backend =====
            elif self.whisper_model:
                # Get the Whisper language code
                whisper_lang = Config.WHISPER_LANG_CODES.get(language, "en")
                DebugLogger.log("STT_LANG", f"Using faster-whisper: {whisper_lang} (from: {language})")

                # Use faster-whisper with STRICT language enforcement (Option A: Speed Optimized)
                segments, info = self.whisper_model.transcribe(
                    audio_data,
                    language=whisper_lang,  # FORCE this language (no auto-detect)
                    beam_size=Config.WHISPER_BEAM_SIZE,      # 1: 최대 속도
                    best_of=Config.WHISPER_BEST_OF,          # 1: 최대 속도
                    temperature=Config.WHISPER_TEMPERATURE,  # 0: 고정값
                    vad_filter=True,  # Built-in VAD for noise filtering
                    vad_parameters=dict(
                        min_silence_duration_ms=200,  # 300 → 200: 더 빠른 문장 끝 감지
                        speech_pad_ms=100,            # 200 → 100: 패딩 줄이기
                    ),
                    condition_on_previous_text=False,  # Disable for real-time
                    without_timestamps=True,  # Faster processing
                    suppress_blank=True,  # Suppress blank outputs
                    suppress_tokens=[-1],
                    no_speech_threshold=0.6,  # 0.5 → 0.6: 노이즈 필터링 강화
                    log_prob_threshold=-0.8,
                    compression_ratio_threshold=2.0,
                )

                # Collect all segments
                texts = []
                for segment in segments:
                    segment_text = segment.text.strip()

                    # Skip segments with high no_speech probability
                    if segment.no_speech_prob > 0.5:
                        DebugLogger.log("STT_FILTER", f"Filtered high no_speech_prob", {
                            "text": segment_text[:30],
                            "no_speech_prob": f"{segment.no_speech_prob:.2f}"
                        })
                        continue

                    # Check for hallucination (Whisper-specific)
                    if self._is_hallucination(segment_text):
                        DebugLogger.log("STT_FILTER", f"Filtered hallucination", {
                            "text": segment_text[:50]
                        })
                        continue

                    if segment_text:
                        texts.append(segment_text)

                result_text = " ".join(texts).strip()
                confidence = info.language_probability if info.language_probability else 0.95

                # Final hallucination check on combined text (Whisper-specific)
                if self._is_hallucination(result_text):
                    DebugLogger.log("STT_FILTER", f"Filtered combined hallucination", {
                        "text": result_text[:50]
                    })
                    result_text = ""

            else:
                # No STT backend available
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

        # ===== STEP 1: STT (with Room Cache) =====
        stt_start = time.time()
        source_lang = state.speaker.source_language

        # 캐시를 활용한 STT
        def do_transcribe(audio_data):
            audio_arr = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
            return self.models.transcribe(audio_arr, source_lang)

        original_text, confidence, stt_cached = self.models.room_cache.get_or_create_stt(
            room_id=state.room_id,
            speaker_id=state.speaker.participant_id,
            audio_bytes=audio_bytes,
            transcribe_fn=do_transcribe
        )

        stt_latency = (time.time() - stt_start) * 1000
        state.total_stt_latency_ms += stt_latency

        if stt_cached:
            DebugLogger.log("CACHE_STT", f"Using cached STT result", {"text_preview": original_text[:30] if original_text else ""})

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
            # 캐시를 활용한 번역
            def do_translate(text, src, tgt):
                return self.models.translate(text, src, tgt)

            translated_text, trans_cached = self.models.room_cache.get_or_create_translation(
                room_id=state.room_id,
                text=original_text,
                source_lang=source_lang,
                target_lang=target_lang,
                translate_fn=do_translate
            )

            if trans_cached:
                DebugLogger.log("CACHE_TRANS", f"Using cached translation", {"target": target_lang})

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

        # ===== STEP 3: TTS (with Room Cache) =====
        tts_start = time.time()
        for translation in translations:
            target_lang = translation.target_language
            translated_text = translation.translated_text

            if len(translated_text.strip()) < Config.MIN_TTS_TEXT_LENGTH:
                continue

            if translated_text.lower().strip() in Config.FILLER_WORDS or \
               translated_text.strip() in Config.FILLER_WORDS:
                continue

            # 캐시를 활용한 TTS
            def do_synthesize(text, lang):
                return self.models.synthesize_speech(text, lang)

            audio_data, duration_ms, tts_cached = self.models.room_cache.get_or_create_tts(
                room_id=state.room_id,
                text=translated_text,
                target_lang=target_lang,
                synthesize_fn=do_synthesize
            )

            if tts_cached:
                DebugLogger.log("CACHE_TTS", f"Using cached TTS", {"target": target_lang, "audio_bytes": len(audio_data) if audio_data else 0})

            if audio_data:
                DebugLogger.log("TTS_SEND", f"Sending TTS audio", {
                    "target_lang": target_lang,
                    "audio_bytes": len(audio_data),
                    "duration_ms": duration_ms,
                    "cached": tts_cached
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
    if Config.STT_BACKEND == "whisper":
        print(f"Whisper Model: {Config.WHISPER_MODEL_SIZE}")
    else:
        print(f"Transcribe Region: {Config.AWS_REGION}")
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

    # STT 백엔드 표시
    if Config.STT_BACKEND == "transcribe":
        stt_display = "Amazon Transcribe Streaming"
    elif Config.STT_BACKEND == "whisper" and FASTER_WHISPER_AVAILABLE:
        stt_display = f"faster-whisper ({Config.WHISPER_MODEL_SIZE})"
    else:
        stt_display = "None (check configuration)"

    print(f"\n🚀 gRPC Server started on port {Config.GRPC_PORT}")
    print(f"📡 STT: {stt_display}")
    print(f"🌐 Translation: {Config.TRANSLATION_BACKEND}")
    print("Press Ctrl+C to stop\n")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
        server.stop(5)


if __name__ == "__main__":
    serve()
