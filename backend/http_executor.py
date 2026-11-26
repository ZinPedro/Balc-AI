import json
import logging
import math
import re
from pathlib import Path
from typing import Any, Optional

import httpx

from schemas import SiteAction, SiteManifest

logger = logging.getLogger("balc.http_executor")

MANIFESTS_DIR = Path(__file__).parent / "manifests"
SITE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
PT_BR_THOUSANDS_PATTERN = re.compile(r"^-?\d{1,3}(\.\d{3})+$")
MAX_SANDBOX_ITEMS = 50

# Dados fictícios iniciais usados APENAS quando simulation_mode=True (para testar o BALC sem API externa)
_DEFAULT_SANDBOX_ITEMS: list[dict[str, Any]] = [
    {"id": 1, "titulo": "Cesta Orgânica Semanal", "quantidade": 20, "unidade": "unidade", "preco": 65.0},
    {"id": 2, "titulo": "Mel Silvestre Puro", "quantidade": 35, "unidade": "pote", "preco": 38.0},
    {"id": 3, "titulo": "Queijo Artesanal Curado", "quantidade": 15, "unidade": "peça", "preco": 48.0},
    {"id": 4, "titulo": "Café Moído Especial 500g", "quantidade": 40, "unidade": "pacote", "preco": 32.0},
]

_sandbox_catalogs: dict[str, list[dict[str, Any]]] = {}
_sandbox_next_ids: dict[str, int] = {}


def _get_sandbox_catalog(site_id: str) -> list[dict[str, Any]]:
    if site_id not in _sandbox_catalogs:
        _sandbox_catalogs[site_id] = [dict(item) for item in _DEFAULT_SANDBOX_ITEMS]
        _sandbox_next_ids[site_id] = len(_DEFAULT_SANDBOX_ITEMS) + 1
    return _sandbox_catalogs[site_id]


def load_manifest(site_id: str) -> SiteManifest:
    if not SITE_ID_PATTERN.match(site_id or ""):
        raise FileNotFoundError("Manifesto solicitado não encontrado.")
    manifest_path = (MANIFESTS_DIR / f"{site_id}.json").resolve()
    if manifest_path.parent != MANIFESTS_DIR.resolve() or not manifest_path.exists():
        raise FileNotFoundError("Manifesto solicitado não encontrado.")
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


def _parse_pt_br_number(raw: str) -> float:
    cleaned = raw.strip().replace("R$", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        # Formato PT-BR completo: 1.200,50 -> 1200.50
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        # Decimal com vírgula: 38,50 -> 38.50
        cleaned = cleaned.replace(",", ".")
    elif PT_BR_THOUSANDS_PATTERN.match(cleaned):
        # Milhar PT-BR sem centavos: 1.500 -> 1500
        cleaned = cleaned.replace(".", "")
    return float(cleaned)


def _coerce_field_value(field_type: str, value: Any) -> tuple[bool, Any]:
    if value is None or value == "":
        return False, None
    if field_type == "string":
        text = str(value).strip()
        return (bool(text), text[:500])
    if field_type == "number":
        if isinstance(value, bool):
            return False, None
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                return False, None
            return True, value
        try:
            num = _parse_pt_br_number(str(value))
            if not math.isfinite(num):
                return False, None
            return True, int(num) if num.is_integer() else num
        except ValueError:
            return False, None
    if field_type == "boolean":
        if isinstance(value, bool):
            return True, value
        lower = str(value).strip().lower()
        if lower in ("true", "sim", "1", "yes"):
            return True, True
        if lower in ("false", "não", "nao", "0", "no"):
            return True, False
        return False, None
    return False, None


def sanitize_action_payload(
    action: SiteAction,
    dados: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Filtra apenas os campos permitidos pelo manifesto, valida tipos e lista obrigatórios ausentes."""
    clean: dict[str, Any] = {}
    missing_labels: list[str] = []

    for field in action.fields:
        raw_val = dados.get(field.name)
        ok, coerced = _coerce_field_value(field.type, raw_val)
        if ok:
            clean[field.name] = coerced
        elif field.required:
            missing_labels.append(field.label or field.name)

    return clean, missing_labels


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
        catalog = _get_sandbox_catalog(manifest.site_id)
        precos = [item["preco"] for item in catalog if isinstance(item.get("preco"), (int, float))]
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
            payload = resp.json() if resp.content else []
            if isinstance(payload, list):
                items = payload
            elif isinstance(payload, dict):
                items = payload.get("items", [])
            else:
                items = []
            if not isinstance(items, list) or not items:
                return None
            # Resume até 10 registros para a LLM usar na consultoria sem estourar contexto
            return f"Registros atuais na API do cliente ({len(items)} encontrados): {json.dumps(items[:10], ensure_ascii=False)}"
    except Exception:
        logger.warning("Falha ao consultar contexto consultivo para site_id=%s action_id=%s", manifest.site_id, action.id)
        return "Não foi possível consultar dados prévios da API cliente neste momento."


async def execute_client_action(
    manifest: SiteManifest,
    action: SiteAction,
    dados: dict[str, Any],
    token_usuario: Optional[str] = None,
) -> tuple[bool, list[dict[str, Any]], str]:
    """Executa a ação confirmada exclusivamente via HTTP REST na API do cliente (ou sandbox)."""
    if action.requires_auth and not (token_usuario and token_usuario.strip()):
        return False, [], "Para concluir esta ação, você precisa entrar na sua conta primeiro."

    sanitized_dados, missing_labels = sanitize_action_payload(action, dados)
    if missing_labels:
        campos = ", ".join(missing_labels)
        return False, [], f"Ainda faltam algumas informações antes de concluir: {campos}."

    if manifest.simulation_mode or not manifest.api_base_url:
        catalog = _get_sandbox_catalog(manifest.site_id)
        if action.method == "GET":
            termo = str(sanitized_dados.get("termo", "")).strip().lower()
            encontrados = [
                item for item in catalog
                if not termo or termo in str(item.get("titulo", "")).lower()
            ]
            if not encontrados:
                encontrados = catalog[:3]
            return True, encontrados, f"Encontrei {len(encontrados)} opções no catálogo."

        next_id = _sandbox_next_ids.get(manifest.site_id, len(catalog) + 1)
        _sandbox_next_ids[manifest.site_id] = next_id + 1
        novo_item = {"id": next_id, **sanitized_dados}
        catalog.insert(0, novo_item)
        if len(catalog) > MAX_SANDBOX_ITEMS:
            del catalog[MAX_SANDBOX_ITEMS:]
        return True, [novo_item], "Prontinho! Sua ação foi registrada com sucesso no ambiente de demonstração."

    url = f"{manifest.api_base_url.rstrip('/')}/{action.endpoint.lstrip('/')}"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token_usuario:
        headers["Authorization"] = f"Bearer {token_usuario}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if action.method == "GET":
                resp = await client.get(url, params=sanitized_dados, headers=headers)
            else:
                resp = await client.request(action.method, url, json=sanitized_dados, headers=headers)
            resp.raise_for_status()
            data = resp.json() if resp.content else {}
            if action.method == "GET":
                if isinstance(data, list):
                    items = [item for item in data if isinstance(item, dict)]
                elif isinstance(data, dict):
                    raw_items = data.get("items")
                    if isinstance(raw_items, list):
                        items = [item for item in raw_items if isinstance(item, dict)]
                    else:
                        items = [data] if data else []
                else:
                    items = []
                return True, items, f"Encontrei {len(items)} resultados na plataforma {manifest.site_name}."
            return True, [data] if isinstance(data, dict) and data else [], (
                f"Tudo certo! A ação '{action.name}' foi concluída com sucesso em {manifest.site_name}."
            )
    except Exception:
        logger.exception("Erro ao executar ação '%s' no site '%s'", action.id, manifest.site_id)
        return False, [], (
            f"Desculpe, não consegui concluir agora na plataforma {manifest.site_name}. "
            "Tente novamente em alguns instantes."
        )
