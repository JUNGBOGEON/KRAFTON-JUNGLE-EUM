"""
Room Processor - 병렬 번역/TTS 처리
Room당 하나의 프로세서로 효율적인 리소스 사용
"""

import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass
import threading

from config.settings import Config
from utils.logger import DebugLogger

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from generated import conversation_pb2


@dataclass
class TranslationResult:
    """번역 결과"""
    target_lang: str
    translated_text: str
    target_participant_ids: List[str]
    cached: bool = False


@dataclass
class TTSResult:
    """TTS 결과"""
    target_lang: str
    audio_data: bytes
    duration_ms: int
    target_participant_ids: List[str]
    cached: bool = False


class RoomProcessor:
    """
    Room 단위 오디오 처리 프로세서

    특징:
    - Room당 하나의 프로세서 인스턴스
    - 병렬 번역 처리 (ThreadPoolExecutor)
    - 병렬 TTS 처리
    - 효율적인 캐시 활용
    """

    # 클래스 레벨 ThreadPoolExecutor (모든 Room에서 공유)
    _executor: Optional[ThreadPoolExecutor] = None
    _executor_lock = threading.Lock()

    @classmethod
    def get_executor(cls) -> ThreadPoolExecutor:
        """공유 ThreadPoolExecutor 반환"""
        if cls._executor is None:
            with cls._executor_lock:
                if cls._executor is None:
                    # 번역 + TTS 병렬 처리를 위한 worker 수
                    max_workers = Config.PARALLEL_WORKERS if hasattr(Config, 'PARALLEL_WORKERS') else 8
                    cls._executor = ThreadPoolExecutor(max_workers=max_workers)
                    DebugLogger.log("PROCESSOR", f"ThreadPoolExecutor created with {max_workers} workers")
        return cls._executor

    def __init__(self, room_id: str, model_manager):
        self.room_id = room_id
        self.models = model_manager
        self.target_languages: Set[str] = set()
        self._lock = threading.Lock()

        DebugLogger.log("ROOM_PROCESSOR", f"RoomProcessor created for room {room_id}")

    def add_target_language(self, lang: str):
        """타겟 언어 추가"""
        with self._lock:
            self.target_languages.add(lang)

    def remove_target_language(self, lang: str):
        """타겟 언어 제거"""
        with self._lock:
            self.target_languages.discard(lang)

    def get_target_languages(self) -> List[str]:
        """현재 타겟 언어 목록"""
        with self._lock:
            return list(self.target_languages)

    def translate_parallel(
        self,
        text: str,
        source_lang: str,
        target_languages: List[str],
        get_participants_fn
    ) -> List[TranslationResult]:
        """
        병렬 번역 처리

        Args:
            text: 원본 텍스트
            source_lang: 원본 언어
            target_languages: 타겟 언어 목록
            get_participants_fn: 타겟 언어별 참가자 ID 반환 함수

        Returns:
            List[TranslationResult]
        """
        if not target_languages or len(text.strip()) <= 1:
            return []

        start_time = time.time()
        results: List[TranslationResult] = []
        executor = self.get_executor()

        def translate_single(target_lang: str) -> Optional[TranslationResult]:
            """단일 언어 번역"""
            try:
                def do_translate(txt, src, tgt):
                    return self.models.translate(txt, src, tgt)

                translated_text, cached = self.models.room_cache.get_or_create_translation(
                    room_id=self.room_id,
                    text=text,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    translate_fn=do_translate
                )

                if translated_text:
                    participants = get_participants_fn(target_lang)
                    return TranslationResult(
                        target_lang=target_lang,
                        translated_text=translated_text,
                        target_participant_ids=participants,
                        cached=cached
                    )
            except Exception as e:
                DebugLogger.log("TRANS_ERROR", f"Translation failed for {target_lang}: {e}")
            return None

        # 병렬 번역 실행
        futures = {executor.submit(translate_single, lang): lang for lang in target_languages}

        for future in as_completed(futures):
            lang = futures[future]
            try:
                result = future.result()
                if result:
                    results.append(result)
                    if result.cached:
                        DebugLogger.log("CACHE_TRANS", f"Cached: {lang}")
            except Exception as e:
                DebugLogger.log("TRANS_ERROR", f"Future failed for {lang}: {e}")

        latency_ms = (time.time() - start_time) * 1000
        DebugLogger.log("TRANS_PARALLEL", f"Parallel translation complete", {
            "languages": len(target_languages),
            "results": len(results),
            "latency_ms": f"{latency_ms:.0f}"
        })

        return results

    def synthesize_parallel(
        self,
        translations: List[TranslationResult],
        speaker_participant_id: str
    ) -> List[TTSResult]:
        """
        병렬 TTS 합성

        Args:
            translations: 번역 결과 목록
            speaker_participant_id: 발화자 ID

        Returns:
            List[TTSResult]
        """
        if not translations:
            return []

        start_time = time.time()
        results: List[TTSResult] = []
        executor = self.get_executor()

        # TTS가 필요한 번역만 필터링
        tts_candidates = [
            t for t in translations
            if len(t.translated_text.strip()) >= Config.MIN_TTS_TEXT_LENGTH
            and t.translated_text.lower().strip() not in Config.FILLER_WORDS
            and t.translated_text.strip() not in Config.FILLER_WORDS
        ]

        if not tts_candidates:
            return []

        def synthesize_single(translation: TranslationResult) -> Optional[TTSResult]:
            """단일 TTS 합성"""
            try:
                def do_synthesize(txt, lang):
                    return self.models.synthesize_speech(txt, lang)

                audio_data, duration_ms, cached = self.models.room_cache.get_or_create_tts(
                    room_id=self.room_id,
                    text=translation.translated_text,
                    target_lang=translation.target_lang,
                    synthesize_fn=do_synthesize
                )

                if audio_data:
                    return TTSResult(
                        target_lang=translation.target_lang,
                        audio_data=audio_data,
                        duration_ms=duration_ms,
                        target_participant_ids=translation.target_participant_ids,
                        cached=cached
                    )
            except Exception as e:
                DebugLogger.log("TTS_ERROR", f"TTS failed for {translation.target_lang}: {e}")
            return None

        # 병렬 TTS 실행
        futures = {executor.submit(synthesize_single, t): t for t in tts_candidates}

        for future in as_completed(futures):
            translation = futures[future]
            try:
                result = future.result()
                if result:
                    results.append(result)
                    if result.cached:
                        DebugLogger.log("CACHE_TTS", f"Cached: {result.target_lang}")
            except Exception as e:
                DebugLogger.log("TTS_ERROR", f"Future failed for {translation.target_lang}: {e}")

        latency_ms = (time.time() - start_time) * 1000
        DebugLogger.log("TTS_PARALLEL", f"Parallel TTS complete", {
            "candidates": len(tts_candidates),
            "results": len(results),
            "latency_ms": f"{latency_ms:.0f}"
        })

        return results

    def process_audio_parallel(
        self,
        state,  # SessionState
        audio_bytes: bytes,
        is_final: bool
    ):
        """
        병렬 오디오 처리 파이프라인

        STT → 병렬 번역 → 병렬 TTS
        """
        import numpy as np

        pipeline_start = time.time()
        audio_duration = len(audio_bytes) / Config.BYTES_PER_SECOND

        DebugLogger.log("PIPELINE_START", f"Starting parallel pipeline", {
            "bytes": len(audio_bytes),
            "duration_sec": f"{audio_duration:.2f}",
            "is_final": is_final
        })

        state.chunks_processed += 1
        if is_final:
            state.sentences_completed += 1

        # ===== STEP 1: STT =====
        stt_start = time.time()
        source_lang = state.speaker.source_language

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

        if not original_text:
            DebugLogger.log("PIPELINE_SKIP", "No text from STT")
            return

        # Filler word check
        is_filler = original_text.lower().strip() in Config.FILLER_WORDS or \
                    original_text.strip() in Config.FILLER_WORDS
        if is_filler:
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
        target_languages = state.get_target_languages()

        # ===== STEP 2: Parallel Translation =====
        trans_start = time.time()
        translation_results = self.translate_parallel(
            text=original_text,
            source_lang=source_lang,
            target_languages=list(target_languages),
            get_participants_fn=state.get_participants_by_target_language
        )
        trans_latency = (time.time() - trans_start) * 1000
        state.total_translation_latency_ms += trans_latency

        # Build protobuf translations
        translations = [
            conversation_pb2.TranslationEntry(
                target_language=r.target_lang,
                translated_text=r.translated_text,
                target_participant_ids=r.target_participant_ids
            )
            for r in translation_results
        ]

        # Send Transcript
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

        # ===== STEP 3: Parallel TTS =====
        tts_start = time.time()
        tts_results = self.synthesize_parallel(
            translations=translation_results,
            speaker_participant_id=state.speaker.participant_id
        )
        tts_latency = (time.time() - tts_start) * 1000
        state.total_tts_latency_ms += tts_latency

        # Send TTS Audio
        for tts_result in tts_results:
            yield conversation_pb2.ChatResponse(
                session_id=state.session_id,
                room_id=state.room_id,
                audio=conversation_pb2.AudioResult(
                    transcript_id=transcript_id,
                    target_language=tts_result.target_lang,
                    target_participant_ids=tts_result.target_participant_ids,
                    audio_data=tts_result.audio_data,
                    format="mp3",
                    sample_rate=24000,
                    duration_ms=tts_result.duration_ms,
                    speaker_participant_id=state.speaker.participant_id
                )
            )

        # Pipeline summary
        total_latency = (time.time() - pipeline_start) * 1000
        DebugLogger.pipeline_complete(total_latency, {
            "stt_ms": f"{stt_latency:.0f}",
            "trans_ms": f"{trans_latency:.0f}",
            "tts_ms": f"{tts_latency:.0f}",
            "parallel": True
        })


class RoomProcessorManager:
    """Room별 RoomProcessor 관리"""

    def __init__(self, model_manager):
        self.model_manager = model_manager
        self.processors: Dict[str, RoomProcessor] = {}
        self._lock = threading.Lock()

    def get_or_create(self, room_id: str) -> RoomProcessor:
        """RoomProcessor 반환 (없으면 생성)"""
        with self._lock:
            if room_id not in self.processors:
                self.processors[room_id] = RoomProcessor(room_id, self.model_manager)
            return self.processors[room_id]

    def remove(self, room_id: str):
        """RoomProcessor 제거"""
        with self._lock:
            self.processors.pop(room_id, None)

    def cleanup_all(self):
        """모든 RoomProcessor 정리"""
        with self._lock:
            self.processors.clear()
