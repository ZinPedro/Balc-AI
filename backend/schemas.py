from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class ActionField(BaseModel):
    name: str
    label: str
    type: Literal["string", "number", "boolean"] = "string"
    required: bool = True
    description: str = ""


class SiteAction(BaseModel):
    id: str
    name: str
    description: str
    requires_auth: bool = False
    endpoint: str
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST"
    consultative_endpoint: Optional[str] = None
    consultative_hint: Optional[str] = None
    fields: list[ActionField] = Field(default_factory=list)


class AuthConfig(BaseModel):
    enabled: bool = True
    login_endpoint: str = "/auth/login"
    identifier_field: str = "email"
    identifier_label: str = "seu e-mail ou telefone"
    password_field: str = "password"
    token_response_key: str = "access_token"


class ThemeConfig(BaseModel):
    accent_color: str = "#0b57d0"
    confirm_color: str = "#137333"


class SiteManifest(BaseModel):
    site_id: str
    site_name: str
    api_base_url: str = ""
    simulation_mode: bool = True
    persona: str
    greeting: str
    initial_options: list[str] = Field(default_factory=list)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    actions: list[SiteAction] = Field(default_factory=list)


class PublicSiteConfig(BaseModel):
    """Configuração segura enviada ao frontend do BALC para inicializar o Modo Foco."""

    site_id: str
    site_name: str
    api_base_url: str
    simulation_mode: bool
    greeting: str
    initial_options: list[str]
    theme: ThemeConfig
    auth: AuthConfig


AllowedVoice = Literal[
    "pt-BR-FranciscaNeural",
    "pt-BR-AntonioNeural",
    "pt-BR-ThalitaMultilingualNeural",
]


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(..., min_length=1, max_length=2000)


class BalcRequest(BaseModel):
    site_id: str = Field(default="balc_livre", min_length=1, max_length=64)
    texto_usuario: str = Field(..., min_length=1, max_length=2000)
    acao_atual: Optional[str] = Field(default=None, max_length=64)
    dados_coletados: dict[str, Any] = Field(default_factory=dict)
    historico: list[ConversationTurn] = Field(default_factory=list, max_length=20)
    usuario_autenticado: bool = False
    token_usuario: Optional[str] = Field(default=None, max_length=4096)
    modo_entrada_anterior: Literal["normal", "senha_cofre", "confirmacao"] = "normal"


class LLMDecision(BaseModel):
    """Schema estruturado que a LLM é forçada a retornar (Zero Text-to-SQL)."""

    mensagem_balconista: str = Field(
        description=(
            "Resposta curta, calma e clara em português (máximo 2 a 3 frases). "
            "Faça apenas UMA pergunta ou apresente UMA decisão por vez."
        )
    )
    modo_entrada: Literal["normal", "senha_cofre", "confirmacao"] = Field(
        default="normal",
        description=(
            "Use 'senha_cofre' SOMENTE quando precisar que o usuário digite a senha de login "
            "(nunca peça a senha no chat normal). Use 'confirmacao' quando todos os campos "
            "obrigatórios da ação estiverem preenchidos e prontos para o botão gigante Confirmar."
        ),
    )
    opcoes_botoes: list[str] = Field(
        default_factory=list,
        description="Lista de 2 a 4 botões curtos de escolha rápida para facilitar o toque.",
    )
    acao_atual: Optional[str] = Field(
        default=None,
        description="ID da ação do manifesto em andamento (ou 'autenticar' se estiver fazendo login).",
    )
    dados_coletados_json: str = Field(
        default="{}",
        description=(
            "Objeto JSON em formato string contendo TODOS os campos já coletados até agora "
            "mesclados com os novos dados desta mensagem. Ex: '{\"titulo\": \"Tomate\", \"quantidade\": 50}'."
        ),
    )
    identificador_login: Optional[str] = Field(
        default=None,
        description="E-mail ou telefone informado pelo usuário para login, quando modo_entrada='senha_cofre'.",
    )
    executar_acao_confirmada: bool = Field(
        default=False,
        description=(
            "True SOMENTE se o estado anterior já estava pronto para confirmação e o usuário "
            "confirmou explicitamente nesta mensagem (ex: 'Confirmar', 'Sim, pode publicar')."
        ),
    )


class BalcResponse(BaseModel):
    mensagem_balconista: str
    modo_entrada: Literal["normal", "senha_cofre", "confirmacao"] = "normal"
    opcoes_botoes: list[str] = Field(default_factory=list)
    acao_atual: Optional[str] = None
    dados_coletados: dict[str, Any] = Field(default_factory=dict)
    identificador_login: Optional[str] = None
    acao_concluida: bool = False
    itens_catalogo: list[dict[str, Any]] = Field(default_factory=list)
    origem_motor: Literal["groq", "cerebras", "openrouter", "gemini", "fallback_local"] = "gemini"
