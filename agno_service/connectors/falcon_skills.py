from __future__ import annotations

import json
import re
from typing import Any

from utils import extract_structured_result_items


def requires_falcon_console_lookup(message: str) -> bool:
    """Return True if the message is about Falcon/CrowdStrike console data."""
    lowered = message.strip().lower()
    return any(
        token in lowered
        for token in [
            "falcon",
            "crowdstrike",
            "edr",
            "endpoint",
            "hostname",
            "host",
            "sensor",
            "detection",
            "detecc",
            "incident",
            "behavior",
            "ioc",
            "indicator",
            "actor",
            "mitre",
            "vuln",
            "cve",
        ]
    )


def infer_hostname_list_limit(message: str) -> int | None:
    """Return the requested hostname list limit, or None if this is not a hostname list request."""
    lowered = message.strip().lower()
    if not any(token in lowered for token in ["hostname", "hostnames", "host name", "hosts", "endpoints"]):
        return None
    if not any(token in lowered for token in ["liste", "listar", "mostre", "mostrar", "traga", "quais", "me de", "me dê"]):
        return None
    match = re.search(r"\b(\d{1,3})\b", lowered)
    if match:
        return max(1, min(int(match.group(1)), 100))
    return 10


def is_direct_host_count_request(message: str) -> bool:
    """Return True if the message is asking for a host/endpoint count."""
    lowered = message.strip().lower()
    if not any(token in lowered for token in ["host", "hostname", "endpoint", "asset", "sensor"]):
        return False
    return any(
        token in lowered
        for token in [
            "quantos",
            "quantidade",
            "count",
            "total de",
            "numero de",
            "número de",
        ]
    )


def infer_falcon_prefetch_operation(
    message: str,
    allowed_tool_names: list[str],
) -> tuple[str, dict[str, Any], str] | None:
    """Map a user message to a Falcon MCP prefetch operation.

    Returns (operation_name, arguments, summary_label) or None if no usable operation is available.
    """
    lowered = message.strip().lower()
    operation = "falcon_search_detections"
    arguments: dict[str, Any] = {"limit": 10}
    summary = "Deteccoes"

    if any(token in lowered for token in ["host", "hostname", "endpoint", "sensor", "asset"]):
        operation = "falcon_search_hosts"
        arguments = {"limit": 10, "sort": "hostname.asc"}
        summary = "Inventario de hosts"
    elif any(token in lowered for token in ["detection", "detecc", "alert"]):
        operation = "falcon_search_detections"
        arguments = {"limit": 10}
        summary = "Deteccoes"
    elif any(token in lowered for token in ["incident"]):
        operation = "falcon_search_incidents"
        arguments = {"limit": 10}
        summary = "Incidentes"
    elif any(token in lowered for token in ["behavior", "comportamento"]):
        operation = "falcon_search_behaviors"
        arguments = {"limit": 10}
        summary = "Behaviors"
    elif any(token in lowered for token in ["ioc", "indicator", "actor", "mitre", "intel", "threat"]):
        operation = "falcon_search_iocs" if "falcon_search_iocs" in allowed_tool_names else "falcon_search_reports"
        arguments = {"limit": 10}
        summary = "Threat intelligence"
    elif any(token in lowered for token in ["vuln", "vulnerability", "cve", "patch", "application"]):
        operation = "falcon_search_vulnerabilities"
        arguments = {"limit": 10}
        summary = "Vulnerabilidades"
    elif any(token in lowered for token in ["report", "relatorio", "relatório"]):
        operation = "falcon_search_reports"
        arguments = {"limit": 10}
        summary = "Relatorios"

    if operation not in allowed_tool_names:
        fallback = next((name for name in allowed_tool_names if name != "falcon_check_connectivity"), None)
        if fallback:
            return fallback, {"limit": 10}, f"Consulta Falcon via {fallback}"
        if "falcon_search_incidents" in allowed_tool_names:
            return "falcon_search_incidents", {"limit": 10}, "Incidentes"
        if "falcon_search_hosts" in allowed_tool_names:
            return "falcon_search_hosts", {"limit": 10, "sort": "hostname.asc"}, "Inventario de hosts"
        if "falcon_check_connectivity" in allowed_tool_names:
            return "falcon_check_connectivity", {}, "Conectividade do Falcon"
        return None
    return operation, arguments, summary


def make_falcon_agent_tools(
    mcp_tools: Any,
    serialize_fn: Any,
    allowed_tool_names: list[str],
) -> list[Any]:
    """Build the list of Falcon agno tool functions for the current MCP session.

    The returned functions capture mcp_tools and allowed_tool_names from the current context,
    so they must be rebuilt for each agent invocation.
    """

    async def falcon_list_available_operations() -> str:
        """Lista as operacoes read-only do Falcon disponiveis para esta pergunta."""
        return "\n".join(allowed_tool_names)

    async def falcon_count_hosts() -> str:
        """Conta hosts retornados pelo Falcon usando consulta ampla de inventario."""
        result = await mcp_tools.session.call_tool(  # type: ignore[union-attr]
            "falcon_search_hosts",
            {
                "limit": 5000,
                "sort": "hostname.asc",
            },
        )
        hosts = extract_structured_result_items(result)
        count = len(hosts)
        if count >= 5000:
            return (
                f"Foram retornados {count} hosts na consulta atual. "
                "Isso pode indicar 5000 ou mais hosts no ambiente."
            )
        return f"Foram retornados {count} hosts na consulta atual."

    async def falcon_list_hostnames(limit: int = 20) -> str:
        """Lista hostnames unicos do Falcon para consultas de inventario."""
        safe_limit = max(1, min(int(limit), 100))
        result = await mcp_tools.session.call_tool(  # type: ignore[union-attr]
            "falcon_search_hosts",
            {
                "limit": safe_limit,
                "sort": "hostname.asc",
            },
        )
        hosts = extract_structured_result_items(result)
        hostnames: list[str] = []
        seen: set[str] = set()
        for host in hosts:
            hostname = host.get("hostname")
            if isinstance(hostname, str) and hostname and hostname not in seen:
                seen.add(hostname)
                hostnames.append(hostname)
        return "\n".join(hostnames) if hostnames else "Nenhum hostname encontrado."

    async def falcon_execute_read_only(operation: str, arguments_json: str = "{}") -> str:
        """Executa uma operacao read-only do Falcon MCP e retorna JSON resumido.

        Use primeiro falcon_list_available_operations para descobrir operacoes validas.
        """
        normalized_operation = operation.strip()
        if normalized_operation not in allowed_tool_names:
            return (
                "Operacao nao permitida para esta pergunta. "
                "Use falcon_list_available_operations para listar opcoes validas."
            )
        try:
            parsed_args = json.loads(arguments_json) if arguments_json.strip() else {}
        except json.JSONDecodeError as exc:
            return f"JSON invalido em arguments_json: {exc}"
        if not isinstance(parsed_args, dict):
            return "arguments_json deve representar um objeto JSON."
        result = await mcp_tools.session.call_tool(normalized_operation, parsed_args)  # type: ignore[union-attr]
        return serialize_fn(result)

    return [
        falcon_list_available_operations,
        falcon_count_hosts,
        falcon_list_hostnames,
        falcon_execute_read_only,
    ]
