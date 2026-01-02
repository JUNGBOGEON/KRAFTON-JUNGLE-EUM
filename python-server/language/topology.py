"""
Language Topology - 언어 어순 기반 버퍼링 전략
"""

from enum import Enum
from config import Config


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
