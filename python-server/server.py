"""
Python gRPC AI Server - v7 (Production)

Features:
- Adaptive Buffering based on Language Topology
- Multi-user Target Language Support
- VAD-based Sentence Detection
- Amazon Polly TTS
- Faster-Whisper Large-v3 (CUDA)
- NLLB-200-3.3B Translation (Meta's No Language Left Behind)
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
from faster_whisper import WhisperModel

# NLLB Translation Model
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

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

    SENTENCE_MAX_DURATION_MS = 8000  # 문장 최대 대기 시간
    SENTENCE_MAX_BYTES = int(BYTES_PER_SECOND * SENTENCE_MAX_DURATION_MS / 1000)

    # VAD settings
    SILENCE_THRESHOLD_RMS = 30  # RMS 침묵 임계값 (낮출수록 더 민감하게 음성 감지)
    SILENCE_DURATION_MS = 700    # 문장 끝 감지용 침묵 지속 시간
    SILENCE_FRAMES = int(SILENCE_DURATION_MS / 100)  # 100ms 프레임 기준

    # Model settings
    WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
    WHISPER_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    WHISPER_COMPUTE_TYPE = "float16" if torch.cuda.is_available() else "int8"

    # NLLB Translation Model (Meta's No Language Left Behind)
    NLLB_MODEL = os.getenv("NLLB_MODEL", "facebook/nllb-200-3.3B")

    # NLLB Language Codes
    NLLB_LANG_CODES = {
        "ko": "kor_Hang",  # Korean
        "en": "eng_Latn",  # English
        "ja": "jpn_Jpan",  # Japanese
        "zh": "zho_Hans",  # Chinese (Simplified)
        "es": "spa_Latn",  # Spanish
        "fr": "fra_Latn",  # French
        "de": "deu_Latn",  # German
        "pt": "por_Latn",  # Portuguese
        "ru": "rus_Cyrl",  # Russian
        "ar": "arb_Arab",  # Arabic
        "hi": "hin_Deva",  # Hindi
        "tr": "tur_Latn",  # Turkish
    }

    # AWS Polly
    AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")

    # gRPC
    GRPC_PORT = int(os.getenv("GRPC_PORT", 50051))
    MAX_WORKERS = int(os.getenv("MAX_WORKERS", 8))


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
# Voice Activity Detection (VAD)
# =============================================================================

class VADProcessor:
    """음성 활동 감지 및 문장 경계 탐지"""

    def __init__(self):
        self.silence_frames = 0
        self.is_speaking = False

    def calculate_rms(self, audio_bytes: bytes) -> float:
        """int16 오디오 데이터의 RMS 계산"""
        if len(audio_bytes) < 2:
            return 0.0
        arr = np.frombuffer(audio_bytes, dtype=np.int16)
        return float(np.sqrt(np.mean(arr.astype(np.float64) ** 2)))

    def process_chunk(self, audio_bytes: bytes, chunk_duration_ms: int = 100) -> Tuple[bool, bool]:
        """
        오디오 청크 처리

        Returns:
            (is_speech, is_sentence_end): 음성 존재 여부, 문장 끝 감지 여부
        """
        rms = self.calculate_rms(audio_bytes)
        is_speech = rms >= Config.SILENCE_THRESHOLD_RMS

        if is_speech:
            if not self.is_speaking:
                self.is_speaking = True
            self.silence_frames = 0
            return True, False
        else:
            if self.is_speaking:
                self.silence_frames += 1
                # 일정 시간 침묵이 지속되면 문장 끝으로 판단
                if self.silence_frames >= Config.SILENCE_FRAMES:
                    self.is_speaking = False
                    self.silence_frames = 0
                    return False, True  # 문장 끝
            return False, False

    def reset(self):
        """상태 초기화"""
        self.silence_frames = 0
        self.is_speaking = False


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

        # STT: Faster-Whisper
        print(f"[1/3] Loading Whisper {Config.WHISPER_MODEL}...")
        print(f"      Device: {Config.WHISPER_DEVICE}, Compute: {Config.WHISPER_COMPUTE_TYPE}")
        self.stt_model = WhisperModel(
            Config.WHISPER_MODEL,
            device=Config.WHISPER_DEVICE,
            compute_type=Config.WHISPER_COMPUTE_TYPE
        )
        print("      ✓ Whisper loaded")

        # Translation: NLLB-200 (Meta's No Language Left Behind)
        print(f"[2/3] Loading NLLB {Config.NLLB_MODEL}...")
        self.nllb_tokenizer = AutoTokenizer.from_pretrained(Config.NLLB_MODEL)
        self.nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
            Config.NLLB_MODEL,
            torch_dtype=torch.float16 if Config.WHISPER_DEVICE == "cuda" else torch.float32,
            device_map="auto",
        )
        print("      ✓ NLLB loaded (~7GB VRAM)")

        # TTS: Amazon Polly
        print("[3/3] Initializing Amazon Polly...")
        self.polly_client = boto3.client("polly", region_name=Config.AWS_REGION)
        print("      ✓ Polly initialized")

        print("=" * 60)
        print("All models loaded successfully!")
        print("=" * 60)

        self._initialized = True

    def transcribe(self, audio_data: np.ndarray, language: str) -> Tuple[str, float]:
        """
        음성을 텍스트로 변환

        Args:
            audio_data: float32 normalized audio array
            language: 언어 코드 (예: "ko", "en")

        Returns:
            (text, confidence)
        """
        try:
            segments, info = self.stt_model.transcribe(
                audio_data,
                language=language,
                beam_size=5,
                best_of=5,  # 더 많은 후보 탐색
                patience=1.0,  # 더 인내심 있게 탐색
                vad_filter=True,
                vad_parameters={
                    "min_silence_duration_ms": 300,  # 더 짧은 침묵도 허용
                    "speech_pad_ms": 300,  # 음성 패딩 증가
                    "threshold": 0.3,  # VAD 임계값 낮춤 (더 민감)
                },
                condition_on_previous_text=False,
                no_speech_threshold=0.5,  # 음성 없음 임계값 낮춤
            )

            text_parts = []
            total_confidence = 0.0
            segment_count = 0

            for seg in segments:
                text = seg.text.strip()
                if text and text not in ["...", "…", "."]:
                    text_parts.append(text)
                    total_confidence += seg.avg_logprob
                    segment_count += 1

            if not text_parts:
                return "", 0.0

            full_text = " ".join(text_parts)
            avg_confidence = np.exp(total_confidence / segment_count) if segment_count > 0 else 0.0

            return full_text, float(avg_confidence)

        except Exception as e:
            print(f"[STT Error] {e}")
            return "", 0.0

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """
        텍스트 번역 (NLLB-200)

        Args:
            text: 원본 텍스트
            source_lang: 소스 언어 코드 (ko, en, ja, zh 등)
            target_lang: 타겟 언어 코드

        Returns:
            번역된 텍스트
        """
        if not text.strip():
            return ""

        # NLLB 언어 코드로 변환
        source_nllb = Config.NLLB_LANG_CODES.get(source_lang, "eng_Latn")
        target_nllb = Config.NLLB_LANG_CODES.get(target_lang, "eng_Latn")

        # 같은 언어면 번역 불필요
        if source_lang == target_lang:
            return text

        try:
            # 소스 언어 설정
            self.nllb_tokenizer.src_lang = source_nllb

            # 토크나이즈
            inputs = self.nllb_tokenizer(
                text,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512
            ).to(self.nllb_model.device)

            # 타겟 언어 토큰 ID
            forced_bos_token_id = self.nllb_tokenizer.convert_tokens_to_ids(target_nllb)

            # 번역 생성
            with torch.no_grad():
                outputs = self.nllb_model.generate(
                    **inputs,
                    forced_bos_token_id=forced_bos_token_id,
                    max_new_tokens=256,
                    num_beams=5,
                    early_stopping=True,
                )

            # 디코딩
            result = self.nllb_tokenizer.decode(outputs[0], skip_special_tokens=True)
            return result.strip()

        except Exception as e:
            print(f"[Translation Error] {e}")
            return ""

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

        # Polly 음성 ID 매핑
        voice_map = {
            "ko": "Seoyeon",
            "en": "Joanna",
            "zh": "Zhiyu",
            "ja": "Mizuki",
            "es": "Lucia",
            "fr": "Lea",
            "de": "Vicki",
            "pt": "Camila",
            "ru": "Tatyana",
            "ar": "Zeina",
            "hi": "Aditi",
            "tr": "Filiz",
        }

        voice_id = voice_map.get(target_lang, "Joanna")

        try:
            response = self.polly_client.synthesize_speech(
                Text=text,
                OutputFormat="mp3",
                VoiceId=voice_id,
                Engine="neural" if voice_id in ["Joanna", "Seoyeon", "Zhiyu", "Mizuki"] else "standard",
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

                # 오디오 청크 처리
                elif payload_type == 'audio_chunk' and session_state:
                    audio_chunk = request.audio_chunk
                    session_state.audio_buffer.extend(audio_chunk)

                    # VAD 처리 (100ms 단위)
                    chunk_size = Config.BYTES_PER_SECOND // 10  # 100ms
                    is_sentence_end = False

                    while len(session_state.audio_buffer) >= chunk_size:
                        vad_chunk = bytes(session_state.audio_buffer[:chunk_size])
                        del session_state.audio_buffer[:chunk_size]

                        is_speech, sentence_end = session_state.vad.process_chunk(vad_chunk)

                        if sentence_end:
                            is_sentence_end = True
                            break

                    # 버퍼링 전략에 따른 처리
                    should_process = False
                    buffer_bytes = len(session_state.audio_buffer)

                    if session_state.primary_strategy == BufferingStrategy.CHUNK_BASED:
                        # 1.5초 단위로 처리
                        should_process = buffer_bytes >= Config.CHUNK_BYTES
                    else:
                        # 문장 완성 또는 최대 버퍼 도달 시 처리
                        should_process = is_sentence_end or buffer_bytes >= Config.SENTENCE_MAX_BYTES

                    if should_process and buffer_bytes > 0:
                        # 처리할 버퍼 추출
                        process_bytes = bytes(session_state.audio_buffer)
                        session_state.audio_buffer.clear()

                        # 처리 및 응답 생성
                        for response in self._process_audio(session_state, process_bytes, is_sentence_end):
                            yield response

                # 세션 종료
                elif payload_type == 'session_end':
                    if session_state and len(session_state.audio_buffer) > Config.BYTES_PER_SECOND // 2:
                        # 남은 버퍼 처리
                        process_bytes = bytes(session_state.audio_buffer)
                        session_state.audio_buffer.clear()

                        for response in self._process_audio(session_state, process_bytes, True):
                            yield response

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

        print(f"[STT] Result: \"{original_text}\" (confidence: {confidence:.2f})")

        # 고유 ID 생성
        transcript_id = str(uuid.uuid4())[:8]

        # 타겟 언어별 번역 수행
        target_languages = state.get_target_languages()
        translations = []

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
                print(f"    → {target_lang}: {translated_text}")

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

            print(f"[TTS] Synthesizing: \"{translated_text}\" (lang={target_lang})")
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
                print(f"[TTS] Failed to generate audio for: \"{translated_text}\"")

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

    nllb_name = Config.NLLB_MODEL.split('/')[-1]
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  Python AI Server v7                                         ║
╠══════════════════════════════════════════════════════════════╣
║  gRPC Port:     {Config.GRPC_PORT}                                        ║
║  Device:        {Config.WHISPER_DEVICE.upper()}                                       ║
╠══════════════════════════════════════════════════════════════╣
║  STT:           Whisper {Config.WHISPER_MODEL}                            ║
║  Translation:   {nllb_name}                              ║
║  TTS:           Amazon Polly                                 ║
╠══════════════════════════════════════════════════════════════╣
║  Buffering Strategies:                                       ║
║    - CHUNK (1.5s): Same word order (ko↔ja, en↔zh)            ║
║    - SENTENCE:     Different word order (ko↔en)              ║
╚══════════════════════════════════════════════════════════════╝
""")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.stop(grace=5)


if __name__ == '__main__':
    serve()
