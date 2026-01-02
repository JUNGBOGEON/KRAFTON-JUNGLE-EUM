"""
Voice Activity Detection (VAD) - WebRTC VAD
"""

from typing import Tuple
import numpy as np
import webrtcvad

from config import Config


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
