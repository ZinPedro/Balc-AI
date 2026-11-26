import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path

import edge_tts
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import process_balc_turn
from http_executor import list_available_manifests, load_manifest
from schemas import AllowedVoice, BalcRequest, BalcResponse, PublicSiteConfig

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger("balc.api")

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("BALC_ALLOWED_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    origins = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    return origins or DEFAULT_ALLOWED_ORIGINS


app = FastAPI(
    title="BALC API — Balconista Virtual Consultivo",
    description="Camada portátil e agnóstica de acessibilidade conversacional para qualquer plataforma web.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Rate limiter leve em memória (janela deslizante de 60s por IP e bucket)
_rate_limit_buckets: dict[str, deque[float]] = defaultdict(deque)
_RATE_WINDOW_SECONDS = 60.0


def _make_rate_limiter(bucket: str, default_limit: int):
    limit = int(os.getenv(f"BALC_RATE_LIMIT_{bucket.upper()}", str(default_limit)))

    async def _check_limit(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"{bucket}:{client_ip}"
        now = time.monotonic()
        hits = _rate_limit_buckets[key]
        while hits and (now - hits[0]) > _RATE_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Muitas requisições em pouco tempo. Aguarde alguns segundos e tente novamente.",
            )
        hits.append(now)

    return _check_limit


limit_chat = _make_rate_limiter("chat", 40)
limit_tts = _make_rate_limiter("tts", 80)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "balc-backend",
        "sites_disponiveis": list_available_manifests(),
    }


@app.get("/balc/config/{site_id}", response_model=PublicSiteConfig)
async def get_site_config(site_id: str):
    """Retorna a configuração pública do manifesto para o Frontend Modo Foco inicializar."""
    try:
        manifest = load_manifest(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Configuração do site não encontrada.")

    return PublicSiteConfig(
        site_id=manifest.site_id,
        site_name=manifest.site_name,
        api_base_url=manifest.api_base_url,
        simulation_mode=manifest.simulation_mode,
        greeting=manifest.greeting,
        initial_options=manifest.initial_options,
        theme=manifest.theme,
        auth=manifest.auth,
    )


@app.post("/balc/conversar", response_model=BalcResponse, dependencies=[Depends(limit_chat)])
async def conversar(req: BalcRequest):
    """Endpoint stateless que processa 1 turno da conversa consultiva com o BALC."""
    try:
        manifest = load_manifest(req.site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Configuração do site não encontrada.")

    try:
        return await process_balc_turn(req, manifest)
    except Exception:
        logger.exception("Erro interno ao processar turno do BALC para site_id=%s", req.site_id)
        raise HTTPException(
            status_code=500,
            detail="Não foi possível processar sua mensagem agora. Tente novamente em instantes.",
        )


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=600)
    voice: AllowedVoice = "pt-BR-FranciscaNeural"


async def _stream_tts(text: str, voice: AllowedVoice):
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Texto vazio para síntese de voz.")
    if len(clean_text) > 600:
        clean_text = clean_text[:600]

    try:
        communicate = edge_tts.Communicate(clean_text, voice)

        async def audio_generator():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        return StreamingResponse(
            audio_generator(),
            media_type="audio/mpeg",
            headers={"Cache-Control": "private, no-store"},
        )
    except Exception:
        logger.exception("Erro ao gerar áudio TTS com voz=%s", voice)
        raise HTTPException(status_code=500, detail="Não foi possível gerar o áudio agora.")


@app.get("/balc/tts", dependencies=[Depends(limit_tts)])
async def text_to_speech_get(
    text: str = Query(..., min_length=1, max_length=600),
    voice: AllowedVoice = Query(default="pt-BR-FranciscaNeural"),
):
    """Gera áudio neural em português brasileiro via GET para streaming progressivo no <audio>."""
    return await _stream_tts(text, voice)


@app.post("/balc/tts", dependencies=[Depends(limit_tts)])
async def text_to_speech(req: TTSRequest):
    """Gera áudio neural em português brasileiro usando edge-tts."""
    return await _stream_tts(req.text, req.voice)
