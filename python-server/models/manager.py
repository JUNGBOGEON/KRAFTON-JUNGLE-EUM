"""
Model Manager - 통합 AI 모델 관리자
STT, Translation, TTS Mixin을 통합하고 모델 초기화 및 warmup 관리
"""

import os
import time
import threading
import tempfile

import numpy as np
import torch
import boto3

from config.settings import Config
from utils.logger import DebugLogger
from cache.room_cache import RoomCacheManager
from models.async_manager import AsyncLoopManager
from models.stt import STTMixin
from models.translation import TranslationMixin
from models.tts import TTSMixin

# Optional imports
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    print("[INFO] faster-whisper not installed.")

try:
    import nemo.collections.asr as nemo_asr
    import soundfile as sf
    NEMO_AVAILABLE = True
except ImportError:
    NEMO_AVAILABLE = False
    print("[INFO] NeMo not installed. Install with: pip install nemo_toolkit[asr]")

try:
    from amazon_transcribe.client import TranscribeStreamingClient
    AMAZON_TRANSCRIBE_AVAILABLE = True
except ImportError:
    AMAZON_TRANSCRIBE_AVAILABLE = False
    print("[WARNING] amazon-transcribe not installed.")

from transformers import AutoModelForCausalLM, AutoTokenizer


class ModelManager(STTMixin, TranslationMixin, TTSMixin):
    """
    통합 AI 모델 관리자 (싱글톤)

    - STT: Multi-model (NeMo, faster-whisper) / Single model / Amazon Transcribe
    - Translation: AWS Translate / Qwen3-8B
    - TTS: Amazon Polly
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

        print("=" * 70)
        print("Loading AI Models (v10 Modular)")
        print("=" * 70)

        # 0. Async Loop Manager + Room Cache Manager
        print("[0/5] Initializing Async Loop Manager & Room Cache...")
        self.async_manager = AsyncLoopManager()
        self.async_manager.initialize()
        self.room_cache = RoomCacheManager()
        self.room_cache.initialize()
        print("      ✓ Async Loop Manager & Room Cache initialized")

        # 1. STT Backend - Multi-Model or Single Model
        self.whisper_model = None  # Legacy single model
        self.whisper_models = {}   # Language-specific Whisper models
        self.nemo_models = {}      # Language-specific NeMo models
        self.transcribe_region = Config.AWS_REGION

        if Config.STT_BACKEND == "multi":
            self._load_multi_model_stt()

        elif Config.STT_BACKEND == "whisper" and FASTER_WHISPER_AVAILABLE:
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
            print(f"      NEMO_AVAILABLE={NEMO_AVAILABLE}")
            print(f"      TRANSCRIBE_AVAILABLE={AMAZON_TRANSCRIBE_AVAILABLE}")

        # 2. Qwen3 Translation Model
        print(f"[2/4] Loading Qwen3 {Config.QWEN_MODEL}...")
        self._load_qwen_model()

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

    def _load_multi_model_stt(self):
        """Load language-specific STT models (with deduplication)"""
        print("[1/4] Loading Multi-Model STT (Language-Specific)...")
        print(f"      Device: {Config.WHISPER_DEVICE}, Compute: {Config.WHISPER_COMPUTE_TYPE}")
        print()

        # Track loaded models to avoid duplicate loading
        loaded_whisper_models = {}  # model_name -> WhisperModel instance
        loaded_nemo_models = {}     # model_name -> NeMo model instance

        for lang, model_config in Config.MULTI_MODEL_STT.items():
            model_type = model_config["type"]
            model_name = model_config["model"]
            description = model_config["description"]

            print(f"      [{lang.upper()}] {description}")
            print(f"           Model: {model_name}")

            try:
                if model_type == "whisper" and FASTER_WHISPER_AVAILABLE:
                    # Check if model already loaded
                    if model_name in loaded_whisper_models:
                        self.whisper_models[lang] = loaded_whisper_models[model_name]
                        print(f"           ✓ Reusing already loaded model")
                    else:
                        model = WhisperModel(
                            model_name,
                            device=Config.WHISPER_DEVICE,
                            compute_type=Config.WHISPER_COMPUTE_TYPE,
                        )
                        loaded_whisper_models[model_name] = model
                        self.whisper_models[lang] = model
                        print(f"           ✓ Loaded (faster-whisper)")

                elif model_type == "nemo" and NEMO_AVAILABLE:
                    # Check if model already loaded
                    if model_name in loaded_nemo_models:
                        self.nemo_models[lang] = loaded_nemo_models[model_name]
                        print(f"           ✓ Reusing already loaded model")
                    else:
                        model = nemo_asr.models.ASRModel.from_pretrained(model_name)
                        if Config.WHISPER_DEVICE == "cuda":
                            model = model.cuda()
                        model.eval()
                        loaded_nemo_models[model_name] = model
                        self.nemo_models[lang] = model
                        print(f"           ✓ Loaded (NeMo)")

                else:
                    print(f"           ⚠ Skipped (framework not available)")

            except Exception as e:
                print(f"           ✗ Failed to load: {e}")

        # Load fallback model (also check for deduplication)
        fallback_name = Config.FALLBACK_MODEL["model"]
        print(f"\n      [FALLBACK] Loading {Config.FALLBACK_MODEL['description']}...")
        try:
            if fallback_name in loaded_whisper_models:
                self.whisper_models["fallback"] = loaded_whisper_models[fallback_name]
                print(f"           ✓ Reusing already loaded model")
            else:
                self.whisper_models["fallback"] = WhisperModel(
                    fallback_name,
                    device=Config.WHISPER_DEVICE,
                    compute_type=Config.WHISPER_COMPUTE_TYPE,
                )
                print(f"           ✓ Loaded")
        except Exception as e:
            print(f"           ✗ Failed: {e}")

        print()
        unique_whisper = len(loaded_whisper_models)
        unique_nemo = len(loaded_nemo_models)
        total_mappings = len(self.whisper_models) + len(self.nemo_models)
        print(f"      Summary: {unique_whisper} unique Whisper, {unique_nemo} unique NeMo models")
        print(f"               {total_mappings} language mappings created")

    def _load_qwen_model(self):
        """Load Qwen3 translation model"""
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

    def _warmup(self):
        """Warmup all loaded models"""
        print("\n" + "=" * 70)
        print("Warming up models...")
        print("=" * 70)

        warmup_start = time.time()
        dummy_audio = np.zeros(16000, dtype=np.float32)

        # 1. Multi-Model warmup (deduplicated - only warmup unique models)
        if Config.STT_BACKEND == "multi":
            print("[Warmup] Multi-Model STT...")

            # Warmup unique Whisper models only
            warmed_whisper = set()
            for lang, model in self.whisper_models.items():
                model_id = id(model)  # Use object id to detect shared instances
                if model_id in warmed_whisper:
                    print(f"         [{lang.upper()}] Skipping (already warmed up)")
                    continue

                try:
                    print(f"         [{lang.upper()}] Warming up Whisper...")
                    segments, info = model.transcribe(
                        dummy_audio,
                        language=Config.WHISPER_LANG_CODES.get(lang, "en"),
                        beam_size=1,
                        vad_filter=False,
                    )
                    list(segments)
                    warmed_whisper.add(model_id)
                    print(f"         [{lang.upper()}] ✓ Whisper warmup complete")
                except Exception as e:
                    print(f"         [{lang.upper()}] ⚠ Whisper warmup failed: {e}")

            # Warmup unique NeMo models only
            warmed_nemo = set()
            for lang, model in self.nemo_models.items():
                model_id = id(model)
                if model_id in warmed_nemo:
                    print(f"         [{lang.upper()}] Skipping (already warmed up)")
                    continue

                try:
                    print(f"         [{lang.upper()}] Warming up NeMo...")
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                        temp_path = f.name
                        audio_int16 = np.zeros(16000, dtype=np.int16)
                        sf.write(temp_path, audio_int16, Config.SAMPLE_RATE)
                    model.transcribe([temp_path])
                    os.unlink(temp_path)
                    warmed_nemo.add(model_id)
                    print(f"         [{lang.upper()}] ✓ NeMo warmup complete")
                except Exception as e:
                    print(f"         [{lang.upper()}] ⚠ NeMo warmup failed: {e}")

        elif self.whisper_model:
            print("[Warmup] faster-whisper...")
            try:
                segments, info = self.whisper_model.transcribe(
                    dummy_audio,
                    language="en",
                    beam_size=1,
                    vad_filter=False,
                )
                list(segments)
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

    def get_stt_display(self) -> str:
        """Get STT backend display string for logging"""
        if Config.STT_BACKEND == "multi":
            loaded_models = []
            for lang in self.whisper_models.keys():
                if lang == "fallback":
                    loaded_models.append("fallback")
                else:
                    loaded_models.append(f"{lang}(W)")
            for lang in self.nemo_models.keys():
                loaded_models.append(f"{lang}(N)")
            return f"Multi-Model ({', '.join(loaded_models)})"
        elif Config.STT_BACKEND == "transcribe":
            return "Amazon Transcribe Streaming"
        elif Config.STT_BACKEND == "whisper" and FASTER_WHISPER_AVAILABLE:
            return f"faster-whisper ({Config.WHISPER_MODEL_SIZE})"
        else:
            return "None (check configuration)"
