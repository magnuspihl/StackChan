import io
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from huggingface_hub import snapshot_download
from pydantic import BaseModel

app = FastAPI(title="Roest Danish TTS Server")

MODEL_REPO = os.getenv("ROEST_TTS_MODEL", "CoRal-project/roest-v3-chatterbox-500m")
DEFAULT_VOICE = os.getenv("ROEST_TTS_DEFAULT_VOICE", "default")
# "default" is the reference speaker that ships with the model (its conds.pt); no voice file needed.
BUILTIN_VOICE = "default"
KEEPALIVE_MINS = float(os.getenv("ROEST_TTS_KEEPALIVE_MINS", "10"))
VOICES_DIR = Path(os.getenv("ROEST_TTS_VOICES_DIR", "/voices"))

# Sampling settings from the model card's MOS evaluation / audio samples.
GEN_KWARGS = dict(
    temperature=float(os.getenv("ROEST_TTS_TEMPERATURE", "0.7")),
    top_p=0.95,
    min_p=0.05,
    cfg_weight=0.5,
    repetition_penalty=2.0,
)
# The model degrades on long inputs, so text is synthesized sentence by sentence.
MAX_CHUNK_CHARS = 250
PAUSE_SECS = 0.15
SAMPLE_RATE = 24000  # chatterbox (S3Gen) output rate
# Danish speech runs ~13-15 chars/sec; output faster than this means generation was cut short.
CHARS_PER_SEC_MAX = 30
MAX_ATTEMPTS = 3

_model = None
_conds: dict = {}
_model_lock = threading.Lock()
_last_used: float = 0.0
_loaded: bool = False


def _voice_files() -> dict[str, Path]:
    """Every *.wav in the voices dir is a voice; its id is the filename stem."""
    return {p.stem.lower(): p for p in sorted(VOICES_DIR.glob("*.wav"))}


def _load_model():
    global _model, _loaded, _last_used
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    ckpt_dir = snapshot_download(
        repo_id=MODEL_REPO,
        allow_patterns=["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"],
    )
    _model = ChatterboxMultilingualTTS.from_local(ckpt_dir, device="cuda")
    _conds[BUILTIN_VOICE] = _model.conds
    _loaded = True
    _last_used = time.time()
    print(f"[roest-tts] Model loaded: {MODEL_REPO}", flush=True)


def _unload_model():
    global _model, _loaded
    print("[roest-tts] Unloading model (keep-alive expired)", flush=True)
    del _model
    _model = None
    _conds.clear()
    _loaded = False
    torch.cuda.empty_cache()


def _keepalive_watcher():
    while True:
        time.sleep(30)
        with _model_lock:
            if _loaded and (time.time() - _last_used) > KEEPALIVE_MINS * 60:
                _unload_model()


threading.Thread(target=_keepalive_watcher, daemon=True).start()


def _use_voice(voice_id: str, path: Optional[Path]):
    """Point the model at a voice, computing its conditionals once per load."""
    if voice_id not in _conds:  # the built-in voice is cached at load
        _model.prepare_conditionals(str(path))
        _conds[voice_id] = _model.conds
    _model.conds = _conds[voice_id]


def _split_text(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?…])\s+", text.strip())
    chunks = []
    for s in sentences:
        while len(s) > MAX_CHUNK_CHARS:
            cut = s.rfind(",", 0, MAX_CHUNK_CHARS)
            if cut <= 0:
                cut = s.rfind(" ", 0, MAX_CHUNK_CHARS)
            if cut <= 0:
                cut = MAX_CHUNK_CHARS
            chunks.append(s[: cut + 1].strip())
            s = s[cut + 1 :].strip()
        if s:
            chunks.append(s)
    return chunks


def _generate_chunk(chunk: str, language_id: str) -> np.ndarray:
    """Synthesize one chunk, retrying when chatterbox ends it early.

    Its stream analyzer can force EOS mid-sentence (resemble-ai/chatterbox#519), which shows up as
    audio far shorter than the text. Sampling is random, so a retry usually comes out whole.
    """
    min_secs = len(chunk) / CHARS_PER_SEC_MAX
    for attempt in range(1, MAX_ATTEMPTS + 1):
        wav = _model.generate(chunk, language_id=language_id, **GEN_KWARGS).squeeze(0).numpy()
        if len(wav) / _model.sr >= min_secs or attempt == MAX_ATTEMPTS:
            return wav
        print(f"[roest-tts] Truncated output ({len(wav) / _model.sr:.2f}s for {len(chunk)} chars), retrying", flush=True)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_REPO, "loaded": _loaded}


@app.post("/warmup")
def warmup():
    global _last_used
    with _model_lock:
        if not _loaded:
            _load_model()
        _last_used = time.time()
    return {"ok": True, "loaded": True}


@app.get("/voices")
def get_voices():
    names = [BUILTIN_VOICE, *(v for v in _voice_files() if v != BUILTIN_VOICE)]
    return {"voices": [{"id": v, "name": f"{v.capitalize()} (Danish)"} for v in names]}


def _resolve_voice(voice_id: Optional[str]) -> tuple[str, Path]:
    voice_id = (voice_id or DEFAULT_VOICE).lower()
    voices = _voice_files()
    if voice_id == BUILTIN_VOICE and voice_id not in voices:
        return voice_id, None
    if voice_id not in voices:
        names = [BUILTIN_VOICE, *voices]
        raise HTTPException(status_code=400, detail=f"Unknown voice {voice_id!r}; available: {', '.join(names)}")
    return voice_id, voices[voice_id]


def _language_id(language: Optional[str]) -> str:
    return "en" if (language or "").lower() in ("en", "english") else "da"


class SpeakRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language: Optional[str] = "Danish"


@app.post("/speak")
def speak(req: SpeakRequest):
    global _last_used
    voice_id, voice_path = _resolve_voice(req.voice_id)
    language_id = _language_id(req.language)
    chunks = _split_text(req.text)
    if not chunks:
        raise HTTPException(status_code=400, detail="Empty text")

    with _model_lock:
        if not _loaded:
            _load_model()
        _use_voice(voice_id, voice_path)
        sr = _model.sr
        pause = np.zeros(int(sr * PAUSE_SECS), dtype=np.float32)
        parts = []
        for chunk in chunks:
            parts += [_generate_chunk(chunk, language_id), pause]
        _last_used = time.time()

    buf = io.BytesIO()
    sf.write(buf, np.concatenate(parts[:-1]), sr, format="WAV")
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=speech.wav"},
    )


# ---- OpenAI-compatible speech endpoint (for clients such as the StackChan kit) ----


class OpenAISpeechRequest(BaseModel):
    input: str
    model: Optional[str] = None  # ignored: there is one model
    voice: Optional[str] = None
    response_format: Optional[str] = "pcm"
    speed: Optional[float] = None  # not supported by the model; ignored
    language: Optional[str] = "Danish"  # extension: "en" for English


def _pcm16(wav: np.ndarray) -> bytes:
    return (np.clip(wav, -1.0, 1.0) * 32767).astype("<i2").tobytes()


@app.post("/v1/audio/speech")
def openai_speech(req: OpenAISpeechRequest):
    """POST /v1/audio/speech as in OpenAI's API.

    response_format "pcm" (raw 16-bit mono, 24 kHz) is streamed one sentence at a time, so a client
    can start playing while the rest is still being generated. "wav" returns the whole file.
    """
    fmt = (req.response_format or "pcm").lower()
    if fmt == "wav":
        return speak(SpeakRequest(text=req.input, voice_id=req.voice, language=req.language))
    if fmt != "pcm":
        raise HTTPException(status_code=400, detail="response_format must be pcm or wav")
    voice_id, voice_path = _resolve_voice(req.voice)
    language_id = _language_id(req.language)
    chunks = _split_text(req.input)
    if not chunks:
        raise HTTPException(status_code=400, detail="Empty input")

    def synthesize(chunk: str) -> bytes:
        global _last_used
        with _model_lock:
            if not _loaded:
                _load_model()
            _use_voice(voice_id, voice_path)
            pcm = _pcm16(_generate_chunk(chunk, language_id))
            _last_used = time.time()
            return pcm

    def generate():
        # The lock is held per sentence, never across a yield: if the client hangs up mid-stream,
        # the generator is simply dropped and the next request isn't blocked.
        pause = _pcm16(np.zeros(int(SAMPLE_RATE * PAUSE_SECS), dtype=np.float32))
        for i, chunk in enumerate(chunks):
            pcm = synthesize(chunk)
            if i:
                yield pause
            yield pcm

    return StreamingResponse(generate(), media_type="audio/pcm", headers={"X-Sample-Rate": str(SAMPLE_RATE)})
