from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from agno.tools.mcp import MCPTools
from secret_env import read_env_value


DEFAULT_FALCON_COMMAND = (
    "docker run -i --rm "
    "-e FALCON_CLIENT_ID "
    "-e FALCON_CLIENT_SECRET "
    "-e FALCON_BASE_URL "
    "-e FALCON_MCP_TRANSPORT=stdio "
    "quay.io/crowdstrike/falcon-mcp:latest"
)

READ_ONLY_FALCON_TOOLS = [
    "falcon_check_connectivity",
    "falcon_list_enabled_modules",
    "falcon_list_modules",
    "falcon_search_kubernetes_containers",
    "falcon_count_kubernetes_containers",
    "falcon_search_images_vulnerabilities",
    "falcon_search_ngsiem",
    "falcon_search_detections",
    "falcon_get_detection_details",
    "falcon_show_crowd_score",
    "falcon_search_incidents",
    "falcon_get_incident_details",
    "falcon_search_behaviors",
    "falcon_get_behavior_details",
    "falcon_search_iocs",
    "falcon_search_scheduled_reports",
    "falcon_search_report_executions",
    "falcon_download_report_execution",
    "falcon_search_vulnerabilities",
    "falcon_search_applications",
    "falcon_search_unmanaged_assets",
    "falcon_search_hosts",
    "falcon_get_host_details",
    "falcon_idp_investigate_entity",
    "falcon_search_actors",
    "falcon_search_indicators",
    "falcon_search_reports",
    "falcon_get_mitre_report",
    "falcon_search_serverless_vulnerabilities",
    "falcon_search_sensor_usage",
]

DEFAULT_QUERY_TOOLSET = [
    "falcon_check_connectivity",
    "falcon_search_hosts",
    "falcon_get_host_details",
    "falcon_search_detections",
    "falcon_get_detection_details",
    "falcon_search_incidents",
    "falcon_get_incident_details",
    "falcon_search_behaviors",
    "falcon_get_behavior_details",
]

QUERY_TOOLSETS: dict[str, list[str]] = {
    "hosts": [
        "falcon_check_connectivity",
        "falcon_search_hosts",
        "falcon_get_host_details",
        "falcon_search_unmanaged_assets",
        "falcon_search_applications",
        "falcon_search_sensor_usage",
    ],
    "detections": [
        "falcon_check_connectivity",
        "falcon_search_detections",
        "falcon_get_detection_details",
        "falcon_search_incidents",
        "falcon_get_incident_details",
        "falcon_search_behaviors",
        "falcon_get_behavior_details",
        "falcon_show_crowd_score",
    ],
    "identity": [
        "falcon_check_connectivity",
        "falcon_idp_investigate_entity",
        "falcon_search_incidents",
        "falcon_search_detections",
        "falcon_search_behaviors",
    ],
    "intelligence": [
        "falcon_check_connectivity",
        "falcon_search_iocs",
        "falcon_search_indicators",
        "falcon_search_actors",
        "falcon_search_reports",
        "falcon_get_mitre_report",
    ],
    "vulnerabilities": [
        "falcon_check_connectivity",
        "falcon_search_vulnerabilities",
        "falcon_search_serverless_vulnerabilities",
        "falcon_search_images_vulnerabilities",
        "falcon_search_applications",
    ],
    "kubernetes": [
        "falcon_check_connectivity",
        "falcon_search_kubernetes_containers",
        "falcon_count_kubernetes_containers",
        "falcon_search_images_vulnerabilities",
        "falcon_search_serverless_vulnerabilities",
    ],
    "reports": [
        "falcon_check_connectivity",
        "falcon_search_scheduled_reports",
        "falcon_search_report_executions",
        "falcon_download_report_execution",
        "falcon_search_reports",
        "falcon_get_mitre_report",
    ],
}


@dataclass(frozen=True)
class FalconMCPConfig:
    enabled: bool
    transport: str
    command: str | None
    url: str | None
    timeout_seconds: int
    include_all_tools: bool

    @property
    def mode(self) -> str:
        return "remote" if self.transport != "stdio" else "local"


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
        parsed = int(raw)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _read_str(name: str, default: str = "") -> str:
    value = read_env_value(name)
    if value is None:
        return default
    return value.strip()


def build_falcon_mcp_config_from_env() -> FalconMCPConfig:
    transport = _read_str("FALCON_MCP_TRANSPORT_MODE", "stdio").lower() or "stdio"
    enabled = _read_bool("FALCON_MCP_ENABLED", True)
    timeout_seconds = _read_int("FALCON_MCP_TIMEOUT_SECONDS", 90, minimum=10, maximum=180)
    command = _read_str("FALCON_MCP_COMMAND", DEFAULT_FALCON_COMMAND) or DEFAULT_FALCON_COMMAND
    url = _read_str("FALCON_MCP_URL") or None

    if transport == "stdio":
        required = ["FALCON_CLIENT_ID", "FALCON_CLIENT_SECRET", "FALCON_BASE_URL"]
        enabled = enabled and all(bool(_read_str(name)) for name in required)
        return FalconMCPConfig(
            enabled=enabled,
            transport="stdio",
            command=command,
            url=None,
            timeout_seconds=timeout_seconds,
            include_all_tools=_read_bool("FALCON_MCP_INCLUDE_ALL_TOOLS", False),
        )

    enabled = enabled and bool(url)
    return FalconMCPConfig(
        enabled=enabled,
        transport=transport,
        command=None,
        url=url,
        timeout_seconds=timeout_seconds,
        include_all_tools=_read_bool("FALCON_MCP_INCLUDE_ALL_TOOLS", False),
    )


def build_falcon_mcp_env() -> dict[str, str]:
    return {
        "FALCON_CLIENT_ID": read_env_value("FALCON_CLIENT_ID"),
        "FALCON_CLIENT_SECRET": read_env_value("FALCON_CLIENT_SECRET"),
        "FALCON_BASE_URL": read_env_value("FALCON_BASE_URL"),
        "FALCON_MCP_TRANSPORT": "stdio",
    }


def agent_should_use_falcon_mcp(
    *,
    agent_name: str,
    agent_description: str,
    agent_prompt: str,
    team_key: str | None,
    tags: Any,
) -> bool:
    normalized_tags = {str(tag).strip().lower() for tag in tags} if isinstance(tags, list) else set()
    blob = " ".join(
        [
            agent_name.strip().lower(),
            agent_description.strip().lower(),
            agent_prompt.strip().lower(),
            (team_key or "").strip().lower(),
            " ".join(sorted(normalized_tags)),
        ]
    )
    signals = {
        "falcon",
        "crowdstrike",
        "edr",
        "hunting",
        "hunt",
        "dnr",
        "detection",
        "response",
    }
    return any(signal in blob for signal in signals)


def build_falcon_response_instructions() -> list[str]:
    return [
        "Voce e um analista senior de EDR focado em CrowdStrike Falcon.",
        "Atue em modo somente leitura: investigacao, triagem, hunting e recomendacao.",
        "Nunca execute contencao, kill, quarantine, isolamento ou qualquer acao destrutiva.",
        "Priorize incidentes ativos, deteccoes criticas, persistence, privilege escalation, credential access, lateral movement, beaconing e sinais de ransomware.",
        "Nao afirme que consultou dados se nenhuma tool tiver sido usada.",
        "Separe claramente fatos observados, inferencias, hipoteses e recomendacoes.",
        "Quando houver lacunas, declare explicitamente a incerteza.",
        "Responda em portugues do Brasil com as secoes: ## Resumo Executivo, ## O que foi observado, ## Interpretacao tecnica, ## Lacunas / incertezas, ## Proximos passos recomendados, ## Nivel de confianca.",
    ]


def select_falcon_tool_names(message: str, *, include_all_tools: bool) -> list[str] | None:
    if include_all_tools:
        return None

    lowered = message.strip().lower()
    if not lowered:
        return DEFAULT_QUERY_TOOLSET

    selected: list[str] = []

    def include(group: str) -> None:
        for tool_name in QUERY_TOOLSETS[group]:
            if tool_name not in selected:
                selected.append(tool_name)

    if any(token in lowered for token in ["host", "hostname", "endpoint", "sensor", "asset", "console"]):
        include("hosts")
    if any(token in lowered for token in ["detection", "detecc", "incident", "alert", "behavior", "ransom", "malware", "lateral", "persistence", "credential", "beacon"]):
        include("detections")
    if any(token in lowered for token in ["user", "usuario", "identity", "identidade", "login", "idp"]):
        include("identity")
    if any(token in lowered for token in ["ioc", "indicator", "actor", "threat intel", "mitre", "report"]):
        include("intelligence")
    if any(token in lowered for token in ["vuln", "vulnerability", "cve", "patch", "application"]):
        include("vulnerabilities")
    if any(token in lowered for token in ["kubernetes", "container", "image", "serverless", "cluster"]):
        include("kubernetes")

    if not selected:
        selected.extend(DEFAULT_QUERY_TOOLSET)
    return selected


def resolve_allowed_falcon_tool_names(config: FalconMCPConfig, *, message: str) -> list[str]:
    selected = select_falcon_tool_names(message, include_all_tools=config.include_all_tools)
    return READ_ONLY_FALCON_TOOLS if selected is None else selected


def serialize_falcon_tool_result(result: Any) -> str:
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return json.dumps(structured, ensure_ascii=True, indent=2)

    content = getattr(result, "content", None)
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            text = getattr(item, "text", None)
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
        if chunks:
            return "\n".join(chunks)

    return str(result)


def build_falcon_mcp_tools(config: FalconMCPConfig, *, message: str = "") -> MCPTools | None:
    if not config.enabled:
        return None
    include_tools = select_falcon_tool_names(message, include_all_tools=config.include_all_tools)
    if config.transport == "stdio":
        return MCPTools(
            command=config.command or DEFAULT_FALCON_COMMAND,
            env=build_falcon_mcp_env(),
            transport="stdio",
            timeout_seconds=config.timeout_seconds,
            include_tools=include_tools,
        )
    return MCPTools(
        url=config.url,
        transport=config.transport,
        timeout_seconds=config.timeout_seconds,
        include_tools=include_tools,
    )
