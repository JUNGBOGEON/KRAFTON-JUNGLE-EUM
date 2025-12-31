"""
Python gRPC AI Server - v5 (Stable)
48000 bytes = 1.5초 버퍼 + RMS 침묵 필터링
"""

import sys
import os
import asyncio
from concurrent import futures
from datetime import datetime

import grpc
import numpy as np
import torch
from faster_whisper import WhisperModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import edge_tts

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generated import conversation_pb2
from generated import conversation_pb2_grpc

# ============================================================================
# 모델 로딩
# ============================================================================

print("Loading models...")

stt_model = WhisperModel("tiny", device="cpu", compute_type="int8")
print("STT OK")

llm_tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct", trust_remote_code=True)
llm_model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct", torch_dtype="auto", device_map="cpu", trust_remote_code=True)
print("LLM OK")

# ============================================================================
# 설정: 48000 bytes = 1.5초 (16kHz, 16bit, mono)
# ============================================================================

CUT_BYTES = 48000  # 16000Hz * 2bytes * 1.5s = 48000 bytes
RMS_THRESHOLD = 500  # int16 기준 RMS 임계값
TTS_VOICE = "en-US-AriaNeural"


# ============================================================================
# RMS 계산 (침묵 감지용)
# ============================================================================

def calculate_rms(audio_bytes: bytes) -> float:
    """int16 오디오 데이터의 RMS 계산"""
    arr = np.frombuffer(audio_bytes, dtype=np.int16)
    return np.sqrt(np.mean(arr.astype(np.float64) ** 2))


# ============================================================================
# TTS
# ============================================================================

def tts(text):
    if not text.strip():
        return b""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def gen():
            c = edge_tts.Communicate(text.strip(), TTS_VOICE)
            data = b""
            async for chunk in c.stream():
                if chunk["type"] == "audio":
                    data += chunk["data"]
            return data

        result = loop.run_until_complete(gen())
        loop.close()
        return result
    except:
        return b""


# ============================================================================
# LLM: 빈칸 채우기 모드
# ============================================================================

def translate(korean):
    # 빈 텍스트 또는 "..." 스킵
    text = korean.strip()
    if not text or text == "..." or text == "…":
        return ""

    # 단순 빈칸 채우기 프롬프트
    prompt = f"Korean: {text}\nEnglish:"

    inputs = llm_tokenizer(prompt, return_tensors="pt").to(llm_model.device)

    with torch.no_grad():
        out = llm_model.generate(
            **inputs,
            max_new_tokens=30,  # 1.5초면 더 긴 문장 가능
            do_sample=False,
            pad_token_id=llm_tokenizer.eos_token_id
        )

    # 생성된 부분만 추출
    generated = llm_tokenizer.decode(out[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)

    # 첫 줄만 (줄바꿈 이후 무시)
    result = generated.split("\n")[0].strip()
    return result


# ============================================================================
# gRPC 서비스
# ============================================================================

class Servicer(conversation_pb2_grpc.ConversationServiceServicer):

    def StreamChat(self, request_iterator, context):
        session_id = None
        buf = bytearray()  # 오디오 버퍼
        n = 0  # 처리 횟수
        skip_count = 0  # 침묵 스킵 횟수

        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Stream started")

        for req in request_iterator:
            session_id = req.session_id
            pt = req.WhichOneof('payload')

            if pt == 'session_init':
                print(f"Session: {session_id[:8]}... | Cut @ {CUT_BYTES} bytes (1.5s) | RMS threshold: {RMS_THRESHOLD}")
                yield conversation_pb2.ChatResponse(
                    session_id=session_id,
                    transcript_partial=conversation_pb2.TranscriptPartial(text="Ready", confidence=1.0)
                )

            elif pt == 'audio_chunk':
                buf.extend(req.audio_chunk)

                # 1.5초 단위로 처리
                while len(buf) >= CUT_BYTES:
                    # 정확히 CUT_BYTES만큼만 추출
                    chunk = bytes(buf[:CUT_BYTES])
                    del buf[:CUT_BYTES]

                    audio_sec = len(chunk) / 32000

                    # ★ RMS 침묵 필터링
                    rms = calculate_rms(chunk)
                    if rms < RMS_THRESHOLD:
                        skip_count += 1
                        print(f"[Skipped] Silence detected (RMS: {rms:.0f} < {RMS_THRESHOLD})")
                        continue

                    n += 1

                    # STT
                    arr = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

                    segs, _ = stt_model.transcribe(
                        arr,
                        language="ko",
                        beam_size=1,
                        condition_on_previous_text=False,
                        initial_prompt=None,
                        vad_filter=False
                    )

                    ko = " ".join(s.text.strip() for s in segs).strip()

                    # ★ 빈 텍스트 또는 "..." 스킵
                    if not ko or ko == "..." or ko == "…":
                        print(f"[{n}] {audio_sec:.1f}s | (empty or dots)")
                        continue

                    print(f"[{n}] {audio_sec:.1f}s | RMS: {rms:.0f} | KO: {ko}")

                    # 1. 원본 한국어 STT 결과 전송
                    yield conversation_pb2.ChatResponse(
                        session_id=session_id,
                        transcript_final=conversation_pb2.TranscriptFinal(text=ko)
                    )

                    # LLM 번역
                    en = translate(ko)

                    if not en:
                        print(f"    EN: (skipped)")
                        continue

                    print(f"    EN: {en}")

                    # 2. 번역된 영어 LLM 결과 전송
                    yield conversation_pb2.ChatResponse(
                        session_id=session_id,
                        text_response=conversation_pb2.TextResponse(text=en)
                    )

                    # TTS
                    audio = tts(en)
                    if audio:
                        yield conversation_pb2.ChatResponse(
                            session_id=session_id,
                            audio_response=conversation_pb2.AudioResponse(
                                audio_data=audio,
                                format="mp3",
                                sample_rate=24000
                            )
                        )

            elif pt == 'session_end':
                # 남은 버퍼 처리 (최소 0.5초 = 16000 bytes 이상)
                if len(buf) > 16000:
                    rms = calculate_rms(bytes(buf))
                    if rms >= RMS_THRESHOLD:
                        arr = np.frombuffer(bytes(buf), dtype=np.int16).astype(np.float32) / 32768.0
                        segs, _ = stt_model.transcribe(arr, language="ko", beam_size=1, vad_filter=False)
                        ko = " ".join(s.text.strip() for s in segs).strip()
                        if ko and ko != "..." and ko != "…":
                            # 1. 원본 한국어 STT 결과 전송
                            yield conversation_pb2.ChatResponse(
                                session_id=session_id,
                                transcript_final=conversation_pb2.TranscriptFinal(text=ko)
                            )
                            en = translate(ko)
                            if en:
                                # 2. 번역된 영어 LLM 결과 전송
                                yield conversation_pb2.ChatResponse(
                                    session_id=session_id,
                                    text_response=conversation_pb2.TextResponse(text=en)
                                )
                                audio = tts(en)
                                if audio:
                                    yield conversation_pb2.ChatResponse(
                                        session_id=session_id,
                                        audio_response=conversation_pb2.AudioResponse(
                                            audio_data=audio, format="mp3", sample_rate=24000
                                        )
                                    )
                print(f"Session end | Processed: {n} | Skipped (silence): {skip_count}")
                break

        print(f"Stream closed\n")


# ============================================================================
# 서버 시작
# ============================================================================

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    conversation_pb2_grpc.add_ConversationServiceServicer_to_server(Servicer(), server)
    server.add_insecure_port('0.0.0.0:50051')
    server.start()

    print(f"""
╔═══════════════════════════════════════════════════╗
║  Python AI Server v5 (Stable)                     ║
╠═══════════════════════════════════════════════════╣
║  Buffer:  48000 bytes = 1.5s                      ║
║  RMS:     threshold {RMS_THRESHOLD} (silence filter)            ║
║  STT:     Whisper tiny (no VAD)                   ║
║  LLM:     Qwen 0.5B (completion mode)             ║
║  TTS:     edge-tts (en-US-AriaNeural)             ║
╚═══════════════════════════════════════════════════╝
""")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        server.stop(0)


if __name__ == '__main__':
    serve()
