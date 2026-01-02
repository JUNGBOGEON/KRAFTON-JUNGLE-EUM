"""
Participant & Session Management
"""

from dataclasses import dataclass, field
from typing import Dict, List, Set

from audio import VADProcessor
from language import BufferingStrategy, LanguageTopology


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
