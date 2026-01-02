"""
Configuration settings for AI Server v10
Multi-Model STT, Room Cache, Hallucination Filter 지원
"""

import os
import torch


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

    # ==========================================================================
    # STT Backend Configuration
    # ==========================================================================
    # "multi" (language-specific), "whisper" (single model), or "transcribe" (AWS)
    STT_BACKEND = os.getenv("STT_BACKEND", "multi")

    # Multi-Model STT Configuration (Language-Specific Models)
    # NOTE: faster-whisper는 CTranslate2 형식만 지원
    # HuggingFace 모델은 호환되지 않음 - OpenAI 모델명 또는 Systran 변환 모델 사용
    MULTI_MODEL_STT = {
        # 모든 언어에 large-v3-turbo 사용 (4개 언어 모두 우수한 성능)
        # 언어별 최적화가 필요하면 Systran/faster-whisper-* 모델 사용
        "en": {
            "type": "whisper",
            "model": "large-v3-turbo",  # OpenAI 다국어 모델
            "description": "OpenAI Whisper large-v3-turbo (English)",
        },
        "ko": {
            "type": "whisper",
            "model": "large-v3-turbo",  # 한국어도 우수한 성능
            "description": "OpenAI Whisper large-v3-turbo (Korean)",
        },
        "ja": {
            "type": "whisper",
            "model": "large-v3-turbo",  # 일본어도 우수한 성능
            "description": "OpenAI Whisper large-v3-turbo (Japanese)",
        },
        "zh": {
            "type": "whisper",
            "model": "large-v3-turbo",  # 중국어도 우수한 성능
            "description": "OpenAI Whisper large-v3-turbo (Chinese)",
        },
    }

    # Fallback model for unsupported languages
    FALLBACK_MODEL = {
        "type": "whisper",
        "model": "large-v3-turbo",
        "description": "OpenAI Whisper large-v3-turbo (multilingual fallback)",
    }

    # Single Model Settings (when STT_BACKEND="whisper")
    WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")
    WHISPER_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    WHISPER_COMPUTE_TYPE = "int8_float16" if torch.cuda.is_available() else "int8"

    # Real-time optimized parameters
    WHISPER_BEAM_SIZE = 1
    WHISPER_BEST_OF = 1
    WHISPER_TEMPERATURE = 0.0

    # Language code mappings for Whisper
    WHISPER_LANG_CODES = {
        "ko": "ko", "en": "en", "ja": "ja", "zh": "zh",
        "es": "es", "fr": "fr", "de": "de", "pt": "pt",
        "ru": "ru", "ar": "ar", "hi": "hi", "tr": "tr",
    }

    # Translation backend: "aws" (fast) or "qwen" (local LLM)
    TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND", "aws")

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

    # ==========================================================================
    # Hallucination Filter Settings
    # ==========================================================================
    # Audio artifact patterns - NOT real speech, just transcription artifacts
    AUDIO_ARTIFACT_PATTERNS = {
        "[음악]", "[音楽]", "[music]", "[applause]", "[laughter]",
        "[박수]", "[웃음]", "♪", "♫", "...", "…",
    }

    # Minimum RMS threshold for hallucination detection
    HALLUCINATION_RMS_THRESHOLD = 0.005

    # Minimum audio duration to process (seconds)
    MIN_AUDIO_DURATION = 0.3  # 300ms minimum

    # ==========================================================================
    # Room Cache Settings
    # ==========================================================================
    CACHE_TTL_SECONDS = 10  # 캐시 유효 시간 (10초)
    CACHE_CLEANUP_INTERVAL = 30  # 캐시 정리 간격 (30초)

    # ==========================================================================
    # Parallel Processing Settings
    # ==========================================================================
    PARALLEL_WORKERS = int(os.getenv("PARALLEL_WORKERS", "8"))  # 병렬 처리 worker 수
