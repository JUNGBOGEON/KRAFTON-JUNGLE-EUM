"""
Configuration settings for AI Server
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
