from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChatRequest(_message.Message):
    __slots__ = ("session_id", "room_id", "participant_id", "audio_chunk", "session_init", "session_end")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    AUDIO_CHUNK_FIELD_NUMBER: _ClassVar[int]
    SESSION_INIT_FIELD_NUMBER: _ClassVar[int]
    SESSION_END_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    room_id: str
    participant_id: str
    audio_chunk: bytes
    session_init: SessionInit
    session_end: SessionEnd
    def __init__(self, session_id: _Optional[str] = ..., room_id: _Optional[str] = ..., participant_id: _Optional[str] = ..., audio_chunk: _Optional[bytes] = ..., session_init: _Optional[_Union[SessionInit, _Mapping]] = ..., session_end: _Optional[_Union[SessionEnd, _Mapping]] = ...) -> None: ...

class SessionInit(_message.Message):
    __slots__ = ("sample_rate", "channels", "bits_per_sample", "source_language", "participants", "speaker")
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    BITS_PER_SAMPLE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_FIELD_NUMBER: _ClassVar[int]
    sample_rate: int
    channels: int
    bits_per_sample: int
    source_language: str
    participants: _containers.RepeatedCompositeFieldContainer[ParticipantInfo]
    speaker: SpeakerInfo
    def __init__(self, sample_rate: _Optional[int] = ..., channels: _Optional[int] = ..., bits_per_sample: _Optional[int] = ..., source_language: _Optional[str] = ..., participants: _Optional[_Iterable[_Union[ParticipantInfo, _Mapping]]] = ..., speaker: _Optional[_Union[SpeakerInfo, _Mapping]] = ...) -> None: ...

class ParticipantInfo(_message.Message):
    __slots__ = ("participant_id", "nickname", "profile_img", "target_language", "translation_enabled")
    PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    NICKNAME_FIELD_NUMBER: _ClassVar[int]
    PROFILE_IMG_FIELD_NUMBER: _ClassVar[int]
    TARGET_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TRANSLATION_ENABLED_FIELD_NUMBER: _ClassVar[int]
    participant_id: str
    nickname: str
    profile_img: str
    target_language: str
    translation_enabled: bool
    def __init__(self, participant_id: _Optional[str] = ..., nickname: _Optional[str] = ..., profile_img: _Optional[str] = ..., target_language: _Optional[str] = ..., translation_enabled: bool = ...) -> None: ...

class SpeakerInfo(_message.Message):
    __slots__ = ("participant_id", "nickname", "profile_img", "source_language")
    PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    NICKNAME_FIELD_NUMBER: _ClassVar[int]
    PROFILE_IMG_FIELD_NUMBER: _ClassVar[int]
    SOURCE_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    participant_id: str
    nickname: str
    profile_img: str
    source_language: str
    def __init__(self, participant_id: _Optional[str] = ..., nickname: _Optional[str] = ..., profile_img: _Optional[str] = ..., source_language: _Optional[str] = ...) -> None: ...

class SessionEnd(_message.Message):
    __slots__ = ("reason",)
    REASON_FIELD_NUMBER: _ClassVar[int]
    reason: str
    def __init__(self, reason: _Optional[str] = ...) -> None: ...

class ParticipantSettingsRequest(_message.Message):
    __slots__ = ("room_id", "participant_id", "target_language", "translation_enabled")
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TRANSLATION_ENABLED_FIELD_NUMBER: _ClassVar[int]
    room_id: str
    participant_id: str
    target_language: str
    translation_enabled: bool
    def __init__(self, room_id: _Optional[str] = ..., participant_id: _Optional[str] = ..., target_language: _Optional[str] = ..., translation_enabled: bool = ...) -> None: ...

class ParticipantSettingsResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: bool = ..., message: _Optional[str] = ...) -> None: ...

class ChatResponse(_message.Message):
    __slots__ = ("session_id", "room_id", "transcript", "audio", "error", "status")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOM_ID_FIELD_NUMBER: _ClassVar[int]
    TRANSCRIPT_FIELD_NUMBER: _ClassVar[int]
    AUDIO_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    room_id: str
    transcript: TranscriptResult
    audio: AudioResult
    error: ErrorResponse
    status: SessionStatus
    def __init__(self, session_id: _Optional[str] = ..., room_id: _Optional[str] = ..., transcript: _Optional[_Union[TranscriptResult, _Mapping]] = ..., audio: _Optional[_Union[AudioResult, _Mapping]] = ..., error: _Optional[_Union[ErrorResponse, _Mapping]] = ..., status: _Optional[_Union[SessionStatus, _Mapping]] = ...) -> None: ...

class TranscriptResult(_message.Message):
    __slots__ = ("id", "speaker", "original_text", "original_language", "translations", "is_partial", "is_final", "timestamp_ms", "confidence")
    ID_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_TEXT_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TRANSLATIONS_FIELD_NUMBER: _ClassVar[int]
    IS_PARTIAL_FIELD_NUMBER: _ClassVar[int]
    IS_FINAL_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_MS_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    id: str
    speaker: SpeakerInfo
    original_text: str
    original_language: str
    translations: _containers.RepeatedCompositeFieldContainer[TranslationEntry]
    is_partial: bool
    is_final: bool
    timestamp_ms: int
    confidence: float
    def __init__(self, id: _Optional[str] = ..., speaker: _Optional[_Union[SpeakerInfo, _Mapping]] = ..., original_text: _Optional[str] = ..., original_language: _Optional[str] = ..., translations: _Optional[_Iterable[_Union[TranslationEntry, _Mapping]]] = ..., is_partial: bool = ..., is_final: bool = ..., timestamp_ms: _Optional[int] = ..., confidence: _Optional[float] = ...) -> None: ...

class TranslationEntry(_message.Message):
    __slots__ = ("target_language", "translated_text", "target_participant_ids")
    TARGET_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TRANSLATED_TEXT_FIELD_NUMBER: _ClassVar[int]
    TARGET_PARTICIPANT_IDS_FIELD_NUMBER: _ClassVar[int]
    target_language: str
    translated_text: str
    target_participant_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, target_language: _Optional[str] = ..., translated_text: _Optional[str] = ..., target_participant_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class AudioResult(_message.Message):
    __slots__ = ("transcript_id", "target_language", "target_participant_ids", "audio_data", "format", "sample_rate", "duration_ms", "speaker_participant_id")
    TRANSCRIPT_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TARGET_PARTICIPANT_IDS_FIELD_NUMBER: _ClassVar[int]
    AUDIO_DATA_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    transcript_id: str
    target_language: str
    target_participant_ids: _containers.RepeatedScalarFieldContainer[str]
    audio_data: bytes
    format: str
    sample_rate: int
    duration_ms: int
    speaker_participant_id: str
    def __init__(self, transcript_id: _Optional[str] = ..., target_language: _Optional[str] = ..., target_participant_ids: _Optional[_Iterable[str]] = ..., audio_data: _Optional[bytes] = ..., format: _Optional[str] = ..., sample_rate: _Optional[int] = ..., duration_ms: _Optional[int] = ..., speaker_participant_id: _Optional[str] = ...) -> None: ...

class SessionStatus(_message.Message):
    __slots__ = ("status", "message", "buffering_strategy")
    class Status(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        UNKNOWN: _ClassVar[SessionStatus.Status]
        READY: _ClassVar[SessionStatus.Status]
        PROCESSING: _ClassVar[SessionStatus.Status]
        BUFFERING: _ClassVar[SessionStatus.Status]
        COMPLETED: _ClassVar[SessionStatus.Status]
        ERROR: _ClassVar[SessionStatus.Status]
    UNKNOWN: SessionStatus.Status
    READY: SessionStatus.Status
    PROCESSING: SessionStatus.Status
    BUFFERING: SessionStatus.Status
    COMPLETED: SessionStatus.Status
    ERROR: SessionStatus.Status
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    BUFFERING_STRATEGY_FIELD_NUMBER: _ClassVar[int]
    status: SessionStatus.Status
    message: str
    buffering_strategy: BufferingStrategy
    def __init__(self, status: _Optional[_Union[SessionStatus.Status, str]] = ..., message: _Optional[str] = ..., buffering_strategy: _Optional[_Union[BufferingStrategy, _Mapping]] = ...) -> None: ...

class BufferingStrategy(_message.Message):
    __slots__ = ("source_language", "primary_target_language", "strategy", "buffer_size_ms")
    class StrategyType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        CHUNK_BASED: _ClassVar[BufferingStrategy.StrategyType]
        SENTENCE_BASED: _ClassVar[BufferingStrategy.StrategyType]
    CHUNK_BASED: BufferingStrategy.StrategyType
    SENTENCE_BASED: BufferingStrategy.StrategyType
    SOURCE_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_TARGET_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    BUFFER_SIZE_MS_FIELD_NUMBER: _ClassVar[int]
    source_language: str
    primary_target_language: str
    strategy: BufferingStrategy.StrategyType
    buffer_size_ms: int
    def __init__(self, source_language: _Optional[str] = ..., primary_target_language: _Optional[str] = ..., strategy: _Optional[_Union[BufferingStrategy.StrategyType, str]] = ..., buffer_size_ms: _Optional[int] = ...) -> None: ...

class ErrorResponse(_message.Message):
    __slots__ = ("code", "message", "details")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DETAILS_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    details: str
    def __init__(self, code: _Optional[str] = ..., message: _Optional[str] = ..., details: _Optional[str] = ...) -> None: ...
