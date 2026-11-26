import json
from pathlib import Path
from typing import Any, Optional

import httpx

from schemas import SiteAction, SiteManifest

MANIFESTS_DIR = Path(__file__).parent / "manifests"

# Dados fictícios usados APENAS quando simulation_mode=True (para testar o BALC sem API externa)
SANDBOX_CATALOG: list[dict[str, Any]] = [
    {"id": 1, "titulo": "Cesta Orgânica Semanal", "quantidade": 20, "unidade": "unidade", "preco": 65.0},
    {"id": 2, "titulo": "Mel Silvestre Puro", "quantidade": 35, "unidade": "pote", "preco": 38.0},
    {"id": 3, "titulo": "Queijo Artesanal Curado", "quantidade": 15, "unidade": "peça", "preco": 48.0},
    {"id": 4, "titulo": "Café Moído Especial 500g", "quantidade": 40, "unidade": "pacote", "preco": 32.0},
]


def load_manifest(site_id: str) -> SiteManifest:
    safe_id = "".join(ch for ch in site_id if ch.isalnum() or ch in ("_", "-"))
    manifest_path = MANIFESTS_DIR / f"{safe_id}.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifesto '{safe_id}' não encontrado em {MANIFESTS_DIR}")
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    return SiteManifest.model_validate(raw)


def list_available_manifests() -> list[str]:
    if not MANIFESTS_DIR.exists():
        return []
    return sorted(p.stem for p in MANIFESTS_DIR.glob("*.json"))


def find_action(manifest: SiteManifest, action_id: Optional[str]) -> Optional[SiteAction]:
    if not action_id:
        return None
    for action in manifest.actions:
        if action.id == action_id:
            return action
    return None


async def fetch_consultative_context(
    manifest: SiteManifest,
    action: SiteAction,
    dados_coletados: dict[str, Any],
    token_usuario: Optional[str] = None,
) -> Optional[str]:
    """Consulta a API REST do cliente (ou sandbox) para enriquecer o conselho do BALC."""
    if not action.consultative_endpoint:
        return None

    if manifest.simulation_mode or not manifest.api_base_url:
        precos = [item["preco"] for item in SANDBOX_CATALOG if isinstance(item.get("preco"), (int, float))]
        if not precos:
            return None
        media = sum(precos) / len(precos)
        return (
            f"Dados de referência do ambiente sandbox ({manifest.site_name}): "
            f"preço médio observado = R$ {media:.2f} (faixa de R$ {min(precos):.2f} a R$ {max(precos):.2f})."
        )

    url = f"{manifest.api_base_url.rstrip('/')}/{action.consultative_endpoint.lstrip('/')}"
    headers: dict[str, str] = {}
    if token_usuario:
        headers["Authorization"] = f"Bearer {token_usuario}"

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()
            items = payload if isinstance(payload, list) else payload.get("items", [])
            if not isinstance(items, list) or not items:
                return None
            # Resume até 10 registros para a LLM usar na consultoria sem estourar contexto
            return f"Registros atuais na API do cliente ({len(items)} encontrados): {json.dumps(items[:10], ensure_ascii=False)}"
    except Exception as exc:
        return f"Não foi possível consultar dados prévios da API cliente ({exc})."


async def execute_client_action(
    manifest: SiteManifest,
    action: SiteAction,
    dados: dict[str, Any],
    token_usuario: Optional[str] = None,
) -> tuple[bool, list[dict[str, Any]], str]:
    """Executa a ação confirmada exclusivamente via HTTP REST na API do cliente (ou sandbox)."""
    if manifest.simulation_mode or not manifest.api_base_url:
        if action.method == "GET":
            termo = str(dados.get("termo", "")).strip().lower()
            encontrados = [
                item for item in SANDBOX_CATALOG
                if not termo or termo in str(item.get("titulo", "")).lower()
            ]
            if not encontrados:
                encontrados = SANDBOX_CATALOG[:3]
            return True, encontrados, f"Encontrei {len(encontrados)} opções no catálogo."

        novo_item = {"id": len(SANDBOX_CATALOG) + 1, **dados}
        SANDBOX_CATALOG.insert(0, novo_item)
        return True, [novo_item], "Prontinho! Sua ação foi registrada com sucesso no ambiente de demonstração."

    url = f"{manifest.api_base_url.rstrip('/')}/{action.endpoint.lstrip('/')}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token_usuario:
        headers["Authorization"] = f"Bearer {token_usuario}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if action.method == "GET":
                resp = await client.get(url, params=dados, headers=headers)
            else:
                resp = await client.request(action.method, url, json=dados, headers=headers)
            resp.raise_for_status()
            data = resp.json() if resp.content else {}
            if action.method == "GET":
                items = data if isinstance(data, list) else data.get("items", [data])
                return True, items, f"Encontrei {len(items)} resultados na plataforma {manifest.site_name}."
            return True, [data] if isinstance(data, dict) and data else [], (
                f"Tudo certo! A ação '{action.name}' foi concluída com sucesso em {manifest.site_name}."
            )
    except Exception as exc:
        return False, [], f"Desculpe, não consegui concluir agora na plataforma {manifest.site_name}. Detalhe: {exc}"
