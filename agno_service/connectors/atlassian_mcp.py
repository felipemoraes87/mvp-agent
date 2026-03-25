from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

from agno.tools.mcp import MCPTools
from agno.tools.mcp.params import StreamableHTTPClientParams
from secret_env import read_env_value

ATLASSIAN_MCP_ENDPOINT = "https://mcp.atlassian.com/v1/mcp"

# Prefixos de nomes de tools que implicam escrita — usados para filtro defensivo
# quando ATLASSIAN_MCP_ALLOW_WRITE=false (default)
_WRITE_TOOL_PATTERNS = (
    "create_",
    "update_",
    "delete_",
    "remove_",
    "edit_",
    "add_",
    "transition_",
    "assign_",
    "bulk_",
    "move_",
    "archive_",
    "restore_",
)


@dataclass(frozen=True)
class AtlassianMCPConfig:
    enabled: bool
    url: str
    auth_header: str          # valor completo do header Authorization
    timeout_seconds: int
    allow_write: bool


def _read_bool(name: str, default: bool) -> bool:
    raw = read_env_value(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _read_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = read_env_value(name)
    if raw is None:
        return default
    try:
        return max(minimum, min(maximum, int(raw)))
    except (TypeError, ValueError):
        return default


def build_atlassian_mcp_config_from_env() -> AtlassianMCPConfig:
    """Constroi a configuracao do Atlassian MCP a partir de variaveis de ambiente.

    Ordem de preferencia para autenticacao:
    1. ATLASSIAN_MCP_TOKEN  → Bearer token direto (OAuth 2.1 ou API token via Bearer)
    2. ATLASSIAN_EMAIL + ATLASSIAN_API_TOKEN → Basic auth (base64 email:token)
    """
    token = (read_env_value("ATLASSIAN_MCP_TOKEN") or "").strip()

    if token:
        auth_header = f"Bearer {token}"
    else:
        email = (read_env_value("ATLASSIAN_EMAIL") or "").strip()
        api_token = (read_env_value("ATLASSIAN_API_TOKEN") or "").strip()
        if email and api_token:
            encoded = base64.b64encode(f"{email}:{api_token}".encode()).decode()
            auth_header = f"Basic {encoded}"
        else:
            auth_header = ""

    enabled = bool(auth_header)
    allow_write = _read_bool("ATLASSIAN_MCP_ALLOW_WRITE", False)
    timeout = _read_int("ATLASSIAN_MCP_TIMEOUT_SECONDS", 60, minimum=10, maximum=180)
    url = (read_env_value("ATLASSIAN_MCP_URL") or ATLASSIAN_MCP_ENDPOINT).strip()

    return AtlassianMCPConfig(
        enabled=enabled,
        url=url,
        auth_header=auth_header,
        timeout_seconds=timeout,
        allow_write=allow_write,
    )


def is_write_tool(tool_name: str) -> bool:
    """Retorna True se o nome da tool indica operacao de escrita."""
    lowered = tool_name.strip().lower()
    return any(lowered.startswith(p) for p in _WRITE_TOOL_PATTERNS)


def filter_atlassian_tools(
    discovered_tools: list[Any],
    *,
    allow_write: bool,
) -> list[str]:
    """Retorna a lista de nomes de tools permitidos com base na politica de escrita."""
    names: list[str] = []
    for tool in discovered_tools:
        name = getattr(tool, "name", None) or str(tool)
        if allow_write or not is_write_tool(name):
            names.append(name)
    return names


def build_atlassian_mcp_tools(config: AtlassianMCPConfig) -> MCPTools | None:
    """Cria o MCPTools para o Atlassian Remote MCP Server.

    Usa StreamableHTTP (endpoint remoto oficial da Atlassian).
    O MCPTools descobre as tools disponiveis em runtime via list_tools.
    """
    if not config.enabled:
        return None

    return MCPTools(
        transport="streamable-http",
        server_params=StreamableHTTPClientParams(
            url=config.url,
            headers={"Authorization": config.auth_header},
        ),
        timeout_seconds=config.timeout_seconds,
    )


def agent_should_use_atlassian_mcp(
    *,
    agent_name: str,
    agent_description: str,
    agent_prompt: str,
    team_key: str | None,
    tags: Any,
) -> bool:
    """Retorna True se o agente deve ter acesso ao Atlassian MCP."""
    normalized_tags = {str(t).strip().lower() for t in tags} if isinstance(tags, list) else set()
    blob = " ".join([
        agent_name.strip().lower(),
        agent_description.strip().lower(),
        agent_prompt.strip().lower(),
        (team_key or "").strip().lower(),
        " ".join(sorted(normalized_tags)),
    ])
    signals = {
        "jira", "confluence", "atlassian", "rovo",
        "ticket", "chamado", "issue", "sprint", "backlog",
        "wiki", "page", "space",
        "compass", "component", "dependency",
        "appsec", "cloudsec", "corpsec",
    }
    return any(signal in blob for signal in signals)


def build_atlassian_response_instructions(*, allow_write: bool = False) -> list[str]:
    base = [
        "Voce tem acesso ao Atlassian MCP Server que integra Jira, Confluence e Compass.",
        "Para perguntas sobre tickets, issues, sprints, backlogs ou projetos, consulte o Jira antes de responder.",
        "Para perguntas sobre documentacao, paginas, wikis ou espacos, consulte o Confluence antes de responder.",
        "Nao afirme que consultou dados se nenhuma tool tiver sido usada.",
        "Separe claramente fatos observados de inferencias.",
    ]
    if allow_write:
        base.append(
            "Voce pode criar e atualizar issues no Jira e paginas no Confluence quando solicitado, "
            "mas confirme com o usuario antes de executar qualquer acao de escrita."
        )
    else:
        base.append(
            "Voce esta em modo somente leitura: apenas consultas, buscas e leitura de dados sao permitidas. "
            "Nao crie, atualize ou delete nenhum recurso."
        )
    return base
