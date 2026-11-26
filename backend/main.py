from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agent import process_balc_turn
from http_executor import list_available_manifests, load_manifest
from schemas import BalcRequest, BalcResponse, PublicSiteConfig

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(
    title="BALC API — Balconista Virtual Consultivo",
    description="Camada portátil e agnóstica de acessibilidade conversacional para qualquer plataforma web.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

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


@app.post("/balc/conversar", response_model=BalcResponse)
async def conversar(req: BalcRequest):
    """Endpoint stateless que processa 1 turno da conversa consultiva com o BALC."""
    try:
        manifest = load_manifest(req.site_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    try:
        return await process_balc_turn(req, manifest)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao processar turno do BALC: {exc}")
