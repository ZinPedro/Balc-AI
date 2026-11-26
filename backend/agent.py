import asyncio
import json
import os
from typing import Any, Literal, Optional

import httpx
from google import genai
from google.genai import types

from http_executor import (
    execute_client_action,
    fetch_consultative_context,
    find_action,
    sanitize_action_payload,
)
from schemas import BalcRequest, BalcResponse, LLMDecision, SiteManifest

ProviderName = Literal["groq", "cerebras", "openrouter", "gemini", "fallback_local"]

FAST_GEMINI_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
]

# Provedores OpenAI-compatíveis em ordem de prioridade (todos têm camada gratuita)
OPENAI_COMPAT_PROVIDERS = [
    {
        "name": "groq",
        "env_key": "GROQ_API_KEY",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "default_model": "llama-3.3-70b-versatile",
        "model_env": "BALC_GROQ_MODEL",
    },
    {
        "name": "cerebras",
        "env_key": "CEREBRAS_API_KEY",
        "url": "https://api.cerebras.ai/v1/chat/completions",
        "default_model": "llama-3.3-70b",
        "model_env": "BALC_CEREBRAS_MODEL",
    },
    {
        "name": "openrouter",
        "env_key": "OPENROUTER_API_KEY",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "default_model": "meta-llama/llama-3.3-70b-instruct:free",
        "model_env": "BALC_OPENROUTER_MODEL",
    },
]

_gemini_client_cache: dict[str, genai.Client] = {}


def _get_gemini_client(api_key: str) -> genai.Client:
    """Reaproveita o cliente HTTP do Gemini para evitar handshake TLS a cada turno."""
    if api_key not in _gemini_client_cache:
        _gemini_client_cache[api_key] = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=6_000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
    return _gemini_client_cache[api_key]


def _get_gemini_model_chain() -> list[str]:
    preferred = os.getenv("BALC_GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    chain = [preferred] if preferred else []
    for m in FAST_GEMINI_MODELS:
        if m not in chain:
            chain.append(m)
    return chain


async def _call_openai_compatible(
    provider_cfg: dict[str, str],
    api_key: str,
    turn_input: str,
    system_instruction: str,
) -> LLMDecision:
    model = os.getenv(provider_cfg["model_env"], provider_cfg["default_model"]).strip()
    schema_str = json.dumps(LLMDecision.model_json_schema(), ensure_ascii=False)
    json_system = (
        f"{system_instruction}\n\n"
        f"FORMATO DE SAÍDA OBRIGATÓRIO: Responda EXCLUSIVAMENTE com um objeto JSON válido "
        f"seguindo exatamente este schema:\n{schema_str}"
    )

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": json_system},
            {"role": "user", "content": turn_input},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=6.0) as client:
        resp = await client.post(provider_cfg["url"], json=payload, headers=headers)
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return LLMDecision.model_validate_json(content)


def _call_gemini_sync(
    api_key: str,
    turn_input: str,
    system_instruction: str,
) -> LLMDecision:
    client = _get_gemini_client(api_key)
    last_error: Optional[Exception] = None

    for model_name in _get_gemini_model_chain():
        try:
            interaction = client.interactions.create(
                model=model_name,
                input=turn_input,
                system_instruction=system_instruction,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": LLMDecision.model_json_schema(),
                },
                store=False,
            )
            return LLMDecision.model_validate_json(interaction.output_text)
        except Exception as exc:
            last_error = exc
            continue

    raise RuntimeError(f"Gemini indisponível: {last_error}")


async def _run_llm_cascade(
    turn_input: str,
    system_instruction: str,
) -> tuple[Optional[LLMDecision], ProviderName]:
    """Tenta provedores na ordem: Groq -> Cerebras -> OpenRouter -> Gemini."""
    for cfg in OPENAI_COMPAT_PROVIDERS:
        key = os.getenv(cfg["env_key"], "").strip()
        if not key or key.startswith("sua_chave"):
            continue
        try:
            decision = await _call_openai_compatible(cfg, key, turn_input, system_instruction)
            return decision, cfg["name"]  # type: ignore[return-value]
        except Exception:
            continue

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if gemini_key and not gemini_key.startswith("sua_chave"):
        try:
            decision = await asyncio.to_thread(
                _call_gemini_sync,
                gemini_key,
                turn_input,
                system_instruction,
            )
            return decision, "gemini"
        except Exception:
            pass

    return None, "fallback_local"


def _build_system_instruction(manifest: SiteManifest, consultative_context: Optional[str]) -> str:
    if not manifest.actions:
        return f"""
{manifest.persona}

MODO ATUAL: Atendimento Livre (BALC ainda NÃO acoplado a nenhum site cliente).

REGRAS DE OURO DE ACESSIBILIDADE DO BALC:
1. INFORMAÇÃO AOS POUCOS: Dê uma explicação ou faça APENAS UMA pergunta por resposta.
2. CLAREZA: Use frases curtas, acolhedoras e sem jargões técnicos (máximo 2 a 3 frases).
3. BOTÕES CONTEXTUAIS: Sugira de 2 a 3 opções curtas em `opcoes_botoes` que ajudem o usuário a continuar a conversa atual (ex: aprofundar uma dúvida, seguir no planejamento, resumir o plano).
4. NÃO INVENTE LOJA OU CATÁLOGO: Como nenhum site está acoplado agora, NÃO ofereça ações de "criar anúncio", "buscar no catálogo" ou "fazer login", a menos que o usuário pergunte como isso funciona em teoria.
5. PLANEJAMENTO CONSULTIVO: Se o usuário quiser planejar algo (uma compra, uma venda, uma tarefa do dia), ajude-o passo a passo, organizando as ideias em `dados_coletados_json` apenas se fizer sentido para o planejamento.
""".strip()

    actions_summary = [
        {
            "id": a.id,
            "name": a.name,
            "description": a.description,
            "requires_auth": a.requires_auth,
            "consultative_hint": a.consultative_hint,
            "fields": [f.model_dump() for f in a.fields],
        }
        for a in manifest.actions
    ]

    return f"""
{manifest.persona}

Você está acoplado ao site: "{manifest.site_name}".

REGRAS DE OURO DE ACESSIBILIDADE DO BALC:
1. INFORMAÇÃO AOS POUCOS: Faça APENAS UMA pergunta ou apresente UMA decisão por resposta.
2. CLAREZA: Use frases curtas, acolhedoras e sem jargões técnicos (máximo 2 a 3 frases).
3. BOTÕES GIGANTES: Sempre sugira de 2 a 4 opções curtas em `opcoes_botoes` para que o usuário possa tocar, falar ou escrever.
4. CONSULTORIA: Se houver contexto de mercado/referência abaixo e o usuário precisar decidir um valor ou plano, ajude-o com conselhos práticos e sugira opções claras em `opcoes_botoes`.
5. SEGURANÇA DE SENHA (ZERO-LEAK):
   - NUNCA peça para o usuário falar ou escrever a senha no chat comum.
   - Se o usuário quiser entrar na conta (ou se uma ação exigir `requires_auth=true` e `usuario_autenticado=false`), primeiro pergunte o identificador ({manifest.auth.identifier_label}).
   - Assim que ele informar o identificador, devolva `modo_entrada="senha_cofre"`, `acao_atual="autenticar"` e `identificador_login` preenchido, avisando: "Agora digite sua senha na caixa segura abaixo."
6. CONFIRMAÇÃO EXPLÍCITA (HUMAN-IN-THE-LOOP):
   - Quando todos os campos obrigatórios (`required=true`) da ação estiverem preenchidos em `dados_coletados_json`, NÃO execute direto!
   - Em vez disso, resuma os dados de forma simples, defina `modo_entrada="confirmacao"`, `opcoes_botoes=["Confirmar", "Alterar dados", "Cancelar"]` e `executar_acao_confirmada=false`.
   - Somente quando o usuário confirmar explicitamente no turno seguinte ("Confirmar", "Sim", "Pode enviar"), defina `executar_acao_confirmada=true`.

AÇÕES DISPONÍVEIS NESTE SITE:
{json.dumps(actions_summary, ensure_ascii=False, indent=2)}

CONTEXTO CONSULTIVO ATUAL:
{consultative_context or "Nenhum dado prévio consultado neste turno."}
""".strip()


def _parse_collected_json(raw_json: str, previous: dict[str, Any]) -> dict[str, Any]:
    merged = dict(previous)
    try:
        parsed = json.loads(raw_json)
        if isinstance(parsed, dict):
            for k, v in parsed.items():
                if v is not None and v != "":
                    merged[k] = v
    except Exception:
        pass
    return merged


def _fallback_local_decision(req: BalcRequest, manifest: SiteManifest) -> BalcResponse:
    """Fallback determinístico se nenhum provedor de IA estiver configurado ou todos estiverem ocupados."""
    txt = req.texto_usuario.strip()
    lower = txt.lower()

    if manifest.auth.enabled and ("entrar" in lower or "login" in lower or "conta" in lower):
        return BalcResponse(
            mensagem_balconista=(
                f"Claro! Para entrar na sua conta em {manifest.site_name}, "
                f"qual é {manifest.auth.identifier_label}?"
            ),
            modo_entrada="normal",
            opcoes_botoes=["Cancelar"],
            acao_atual="autenticar",
            dados_coletados=req.dados_coletados,
            origem_motor="fallback_local",
        )

    if req.acao_atual == "autenticar" and not req.usuario_autenticado:
        return BalcResponse(
            mensagem_balconista="Encontrei seu acesso! Agora digite sua senha na caixa segura abaixo. Ela vai direto para o site, sem passar pela IA.",
            modo_entrada="senha_cofre",
            opcoes_botoes=["Cancelar"],
            acao_atual="autenticar",
            identificador_login=txt,
            dados_coletados=req.dados_coletados,
            origem_motor="fallback_local",
        )

    return BalcResponse(
        mensagem_balconista=(
            "Nossos servidores de inteligência estão um pouco ocupados neste segundo. "
            "Pode tentar enviar novamente ou tocar em uma das opções abaixo!"
        ),
        modo_entrada="normal",
        opcoes_botoes=manifest.initial_options or ["Tentar novamente"],
        acao_atual=req.acao_atual,
        dados_coletados=req.dados_coletados,
        origem_motor="fallback_local",
    )


async def process_balc_turn(req: BalcRequest, manifest: SiteManifest) -> BalcResponse:
    is_authenticated = bool(req.token_usuario and req.token_usuario.strip())

    active_action = find_action(manifest, req.acao_atual)
    consultative_context = None
    if active_action:
        consultative_context = await fetch_consultative_context(
            manifest, active_action, req.dados_coletados, req.token_usuario
        )

    system_instruction = _build_system_instruction(manifest, consultative_context)

    recent_history = [f"{t.role}: {t.text}" for t in req.historico[-6:]]
    turn_input = (
        f"ESTADO ATUAL DA SESSÃO:\n"
        f"- usuario_autenticado: {is_authenticated}\n"
        f"- modo_entrada_anterior: {req.modo_entrada_anterior}\n"
        f"- acao_atual: {req.acao_atual}\n"
        f"- dados_coletados: {json.dumps(req.dados_coletados, ensure_ascii=False)}\n"
        f"- historico_recente: {json.dumps(recent_history, ensure_ascii=False)}\n\n"
        f"MENSAGEM ATUAL DO USUÁRIO:\n{req.texto_usuario}"
    )

    decision, provider_used = await _run_llm_cascade(turn_input, system_instruction)
    if decision is None:
        return _fallback_local_decision(req, manifest)

    dados_atualizados = _parse_collected_json(decision.dados_coletados_json, req.dados_coletados)

    target_action = find_action(manifest, decision.acao_atual)

    # Bloqueio determinístico de autenticação para ações protegidas
    if target_action and target_action.requires_auth and not is_authenticated:
        if decision.executar_acao_confirmada or target_action.method == "GET":
            return BalcResponse(
                mensagem_balconista=(
                    f"Para continuar com '{target_action.name}', você precisa entrar na sua conta em "
                    f"{manifest.site_name}. Qual é {manifest.auth.identifier_label}?"
                ),
                modo_entrada="normal",
                opcoes_botoes=["Cancelar"],
                acao_atual="autenticar",
                dados_coletados=dados_atualizados,
                acao_concluida=False,
                itens_catalogo=[],
                origem_motor=provider_used,
            )

    if decision.executar_acao_confirmada and target_action:
        sanitized_dados, missing_labels = sanitize_action_payload(target_action, dados_atualizados)

        # Impede bypass de confirmação (ex: prompt injection ou alucinação da LLM no 1º turno)
        if target_action.method != "GET" and req.modo_entrada_anterior != "confirmacao":
            if missing_labels:
                campos = ", ".join(missing_labels)
                return BalcResponse(
                    mensagem_balconista=f"Antes de confirmar, ainda preciso saber: {campos}.",
                    modo_entrada="normal",
                    opcoes_botoes=["Cancelar"],
                    acao_atual=target_action.id,
                    dados_coletados=sanitized_dados,
                    acao_concluida=False,
                    itens_catalogo=[],
                    origem_motor=provider_used,
                )
            resumo = ", ".join(f"{k}: {v}" for k, v in sanitized_dados.items())
            return BalcResponse(
                mensagem_balconista=(
                    f"Confira os dados antes de concluir ({resumo}). Posso confirmar?"
                ),
                modo_entrada="confirmacao",
                opcoes_botoes=["Confirmar", "Alterar dados", "Cancelar"],
                acao_atual=target_action.id,
                dados_coletados=sanitized_dados,
                acao_concluida=False,
                itens_catalogo=[],
                origem_motor=provider_used,
            )

        ok, itens, feedback = await execute_client_action(
            manifest, target_action, sanitized_dados, req.token_usuario
        )
        return BalcResponse(
            mensagem_balconista=feedback,
            modo_entrada="normal",
            opcoes_botoes=manifest.initial_options or ["Começar de novo"],
            acao_atual=None if ok else decision.acao_atual,
            dados_coletados={} if ok else dados_atualizados,
            acao_concluida=ok,
            itens_catalogo=itens,
            origem_motor=provider_used,
        )

    if target_action and target_action.method == "GET":
        sanitized_dados, missing_labels = sanitize_action_payload(target_action, dados_atualizados)
        if not missing_labels:
            ok, itens, feedback = await execute_client_action(
                manifest, target_action, sanitized_dados, req.token_usuario
            )
            return BalcResponse(
                mensagem_balconista=feedback,
                modo_entrada="normal",
                opcoes_botoes=["Fazer outra busca", "Voltar ao início"],
                acao_atual=None,
                dados_coletados={},
                acao_concluida=ok,
                itens_catalogo=itens,
                origem_motor=provider_used,
            )

    return BalcResponse(
        mensagem_balconista=decision.mensagem_balconista,
        modo_entrada=decision.modo_entrada,
        opcoes_botoes=decision.opcoes_botoes,
        acao_atual=decision.acao_atual,
        dados_coletados=dados_atualizados,
        identificador_login=decision.identificador_login,
        acao_concluida=False,
        itens_catalogo=[],
        origem_motor=provider_used,
    )
