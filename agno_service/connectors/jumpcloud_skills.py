from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .jumpcloud import JumpCloudTool, build_jumpcloud_tool_from_env


# ---------------------------------------------------------------------------
# Public helpers (used by app.py for intent classification / routing)
# ---------------------------------------------------------------------------

def infer_requested_count(message: str, default: int = 10) -> int:
    """Infer how many results the user wants from a natural language message."""
    lowered = f" {message.strip().lower()} "
    if any(token in lowered for token in [" ultimo ", " última ", " ultima ", " latest ", " newest ", " mais recente "]):
        return 1
    match = re.search(r"\b(\d{1,3})\b", lowered)
    if not match:
        return default
    return max(1, min(int(match.group(1)), 100))


def is_password_failure_request(message: str) -> bool:
    """Return True if the message is about password or login failures."""
    return any(token in message.lower() for token in ["senha", "password", "failed", "falha", "erro"])


def infer_operation_plan(message: str) -> tuple[str, dict[str, Any], str]:
    """Map a user message to a JumpCloud operation (name, query args, summary label)."""
    lowered = message.strip().lower()
    limit = infer_requested_count(message, default=10)
    if any(token in lowered for token in ["policy", "policies", "politica", "política"]):
        return "list_policies", {"limit": limit}, "Policies"
    if any(token in lowered for token in ["group", "groups", "grupo", "grupos"]):
        if any(token in lowered for token in ["device", "devices", "system", "systems", "host"]):
            return "list_system_groups", {"limit": limit}, "System groups"
        return "list_user_groups", {"limit": limit}, "User groups"
    if any(token in lowered for token in ["event", "events", "evento", "eventos", "insight", "login", "auth", "mfa", "activity", "atividade", "senha", "password", "failed", "falha", "erro"]):
        query: dict[str, Any] = {"limit": max(limit * 25, 50)}
        if any(token in lowered for token in ["login", "auth", "mfa", "sso", "senha", "password", "failed", "falha", "erro"]):
            query["service"] = "directory"
        return "list_directory_events", query, "Directory Insights"
    if any(token in lowered for token in ["device", "devices", "system", "systems", "host", "hostname", "machine", "computer"]):
        return "list_systems", {"limit": limit}, "Systems"
    return "list_users", {"limit": limit}, "Users"


# ---------------------------------------------------------------------------
# Private event helpers
# ---------------------------------------------------------------------------

def _is_auth_event(item: dict[str, Any]) -> bool:
    event_type = str(item.get("event_type", "")).lower()
    return any(token in event_type for token in ["login", "auth", "sso", "mfa"])


def _is_password_failure_event(item: dict[str, Any]) -> bool:
    event_type = str(item.get("event_type", "")).lower()
    if "login" not in event_type and "auth" not in event_type:
        return False
    if item.get("success") is False:
        return True
    auth_context = item.get("auth_context") if isinstance(item.get("auth_context"), dict) else {}
    auth_methods = auth_context.get("auth_methods") if isinstance(auth_context.get("auth_methods"), dict) else {}
    password_method = auth_methods.get("password") if isinstance(auth_methods.get("password"), dict) else {}
    if password_method.get("success") is False:
        return True
    error_message = str(item.get("error_message", "")).lower()
    message_chain = item.get("message_chain") if isinstance(item.get("message_chain"), dict) else {}
    response_message = str(message_chain.get("response_message", "")).lower() if isinstance(message_chain, dict) else ""
    searchable = f"{error_message} {response_message}"
    return any(token in searchable for token in ["password", "senha", "invalid", "failed", "incorrect"])


def _parse_event_timestamp(item: dict[str, Any]) -> datetime | None:
    raw = str(item.get("timestamp") or item.get("server_timestamp") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fetch_failure_events(
    *,
    tool: JumpCloudTool,
    requested_count: int,
    service: str = "directory",
    page_limit: int = 100,
    max_pages: int = 5,
    lookback_days: int = 7,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    end_time = ""
    start_time = (
        datetime.now(timezone.utc) - timedelta(days=lookback_days)
    ).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    pages_scanned = 0

    for _ in range(max_pages):
        response = tool.jumpcloud_directory_events(
            service=service,
            start_time=start_time,
            end_time=end_time,
            limit=page_limit,
        )
        pages_scanned += 1
        data = response.get("data")
        if not isinstance(data, list) or not data:
            break
        batch = [item for item in data if isinstance(item, dict)]
        batch = sorted(
            batch,
            key=lambda item: str(item.get("timestamp") or item.get("server_timestamp") or ""),
            reverse=True,
        )
        for item in batch:
            event_id = str(item.get("id") or "").strip()
            if event_id and event_id in seen_ids:
                continue
            if event_id:
                seen_ids.add(event_id)
            if _is_password_failure_event(item):
                matches.append(item)
                if len(matches) >= requested_count:
                    return matches, {
                        "service": service,
                        "start_time": start_time,
                        "limit": page_limit,
                        "pages_scanned": pages_scanned,
                    }
        oldest = _parse_event_timestamp(batch[-1])
        if oldest is None:
            break
        end_time = (oldest - timedelta(seconds=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    return matches, {
        "service": service,
        "start_time": start_time,
        "limit": page_limit,
        "pages_scanned": pages_scanned,
    }


# ---------------------------------------------------------------------------
# Private formatters
# ---------------------------------------------------------------------------

def _fmt_users(data: dict[str, Any], requested_count: int) -> str:
    results = data.get("results")
    total_count = data.get("totalCount")
    if not isinstance(results, list):
        return ""
    lines = [
        f"Total retornado nesta consulta: {len(results)}"
        + (f" de {total_count}" if total_count is not None else "")
    ]
    for item in results[:requested_count]:
        if not isinstance(item, dict):
            continue
        username = item.get("username") or "-"
        email = item.get("email") or "-"
        state = item.get("state") or "-"
        mfa = item.get("mfaEnrollment", {}).get("overallStatus") if isinstance(item.get("mfaEnrollment"), dict) else None
        lines.append(f"- {username} | {email} | state={state} | mfa={mfa or '-'}")
    return "\n".join(lines)


def _fmt_systems(data: dict[str, Any], requested_count: int) -> str:
    results = data.get("results")
    total_count = data.get("totalCount")
    if not isinstance(results, list):
        return ""
    lines = [
        f"Total retornado nesta consulta: {len(results)}"
        + (f" de {total_count}" if total_count is not None else "")
    ]
    for item in results[:requested_count]:
        if not isinstance(item, dict):
            continue
        hostname = item.get("hostname") or item.get("displayName") or "-"
        os_name = item.get("os") or "-"
        active = item.get("active")
        last_contact = item.get("lastContact") or "-"
        lines.append(f"- {hostname} | os={os_name} | active={active} | lastContact={last_contact}")
    return "\n".join(lines)


def _fmt_groups(data: list[Any], requested_count: int) -> str:
    lines = [f"Total retornado nesta consulta: {len(data)}"]
    for item in data[:requested_count]:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or "-"
        group_id = item.get("id") or "-"
        description = item.get("description") or ""
        lines.append(f"- {name} | id={group_id}" + (f" | {description}" if description else ""))
    return "\n".join(lines)


def _fmt_policies(data: list[Any], requested_count: int) -> str:
    lines = [f"Total retornado nesta consulta: {len(data)}"]
    for item in data[:requested_count]:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or "-"
        template = item.get("template") if isinstance(item.get("template"), dict) else {}
        template_name = template.get("displayName") or template.get("name") or "-"
        os_family = template.get("osMetaFamily") or "-"
        lines.append(f"- {name} | template={template_name} | os={os_family}")
    return "\n".join(lines)


def _fmt_events(data: list[Any], message: str, requested_count: int) -> str:
    lowered = message.lower()
    filtered = [item for item in data if isinstance(item, dict)]
    if any(token in lowered for token in ["login", "auth", "mfa", "sso", "senha", "password", "failed", "falha", "erro"]):
        filtered = [item for item in filtered if _is_auth_event(item)]
    if is_password_failure_request(message):
        filtered = [item for item in filtered if _is_password_failure_event(item)]
    filtered = sorted(
        filtered,
        key=lambda item: str(item.get("timestamp") or item.get("server_timestamp") or ""),
        reverse=True,
    )
    displayed = filtered[:requested_count]
    lines = [
        f"Eventos retornados: {len(displayed)}"
        + (f" de {len(filtered)} considerados no lote" if len(filtered) > len(displayed) else "")
    ]
    for item in displayed:
        event_type = item.get("event_type") or "-"
        service = item.get("service") or "-"
        timestamp = item.get("timestamp") or item.get("server_timestamp") or "-"
        success = item.get("success")
        initiated_by = item.get("initiated_by") if isinstance(item.get("initiated_by"), dict) else {}
        actor = initiated_by.get("email") or initiated_by.get("username") or initiated_by.get("id") or "-"
        resource = item.get("resource") if isinstance(item.get("resource"), dict) else {}
        target = (
            resource.get("username")
            or resource.get("hostname")
            or resource.get("displayName")
            or resource.get("id")
            or "-"
        )
        lines.append(f"- {timestamp} | {event_type} | service={service} | success={success} | actor={actor} | target={target}")
    if len(lines) == 1:
        return "Nenhum evento aderente ao filtro local foi encontrado no lote retornado."
    return "\n".join(lines)


def _summarize_result(operation_name: str, result: dict[str, Any], message: str) -> str:
    data = result.get("data")
    requested_count = infer_requested_count(message)

    if operation_name == "list_users" and isinstance(data, dict):
        summary = _fmt_users(data, requested_count)
        if summary:
            return summary

    if operation_name == "list_systems" and isinstance(data, dict):
        summary = _fmt_systems(data, requested_count)
        if summary:
            return summary

    if operation_name in {"list_user_groups", "list_system_groups"} and isinstance(data, list):
        return _fmt_groups(data, requested_count)

    if operation_name == "list_policies" and isinstance(data, list):
        return _fmt_policies(data, requested_count)

    if operation_name == "list_directory_events" and isinstance(data, list):
        return _fmt_events(data, message, requested_count)

    return json.dumps(result, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# JumpCloudSkills — semantic agent-facing layer
# ---------------------------------------------------------------------------

class JumpCloudSkills:
    """Semantic skill layer over JumpCloudTool for use by agno agents."""

    def __init__(self, tool: JumpCloudTool) -> None:
        self._tool = tool

    @property
    def enabled(self) -> bool:
        return self._tool.enabled

    def __bool__(self) -> bool:
        return self.enabled

    # -- semantic skills exposed to agents --

    def jc_find_user(self, identifier: str | None = "") -> str:
        """Find a JumpCloud user by email, username, or user ID.

        Args:
            identifier: Email address, username, or JumpCloud user ID to search for.

        Returns:
            User details including state, MFA status, and associated attributes.
        """
        result = self._tool.jumpcloud_execute(
            operation="list_users",
            query_json=json.dumps(
                {"search": {"fields": ["username", "email"], "searchTerm": identifier or ""}, "limit": 5}
            ),
        )
        data = result.get("data")
        if isinstance(data, dict):
            return _fmt_users(data, 5) or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    def jc_list_users(self, limit: int | None = 10, search_term: str | None = "") -> str:
        """List JumpCloud users, optionally filtering by a search term.

        Args:
            limit: Maximum number of users to return (1-100).
            search_term: Optional term to filter users by username or email.

        Returns:
            List of users with username, email, state, and MFA status.
        """
        limit = max(1, min(100, limit or 10))
        query: dict[str, Any] = {"limit": limit}
        if (search_term or "").strip():
            query["search"] = {"fields": ["username", "email"], "searchTerm": search_term.strip()}
        result = self._tool.jumpcloud_execute(operation="list_users", query_json=json.dumps(query))
        data = result.get("data")
        if isinstance(data, dict):
            return _fmt_users(data, limit) or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    def jc_get_user_groups(self, limit: int | None = 20) -> str:
        """List JumpCloud user groups.

        Args:
            limit: Maximum number of groups to return (1-100).

        Returns:
            List of user groups with name, ID, and description.
        """
        result = self._tool.jumpcloud_execute(
            operation="list_user_groups",
            query_json=json.dumps({"limit": max(1, min(100, limit or 20))}),
        )
        data = result.get("data")
        if isinstance(data, list):
            return _fmt_groups(data, limit)
        return json.dumps(result, ensure_ascii=False)

    def jc_list_user_groups(self, limit: int | None = 20) -> str:
        """List JumpCloud user groups (alias for jc_get_user_groups).

        Args:
            limit: Maximum number of groups to return (1-100).

        Returns:
            List of user groups with name, ID, and description.
        """
        return self.jc_get_user_groups(limit=limit)

    def jc_list_devices(self, limit: int | None = 10) -> str:
        """List JumpCloud managed devices (systems).

        Args:
            limit: Maximum number of devices to return (1-100).

        Returns:
            List of devices with hostname, OS, active status, and last contact date.
        """
        result = self._tool.jumpcloud_execute(
            operation="list_systems",
            query_json=json.dumps({"limit": max(1, min(100, limit or 10))}),
        )
        data = result.get("data")
        if isinstance(data, dict):
            return _fmt_systems(data, limit or 10) or json.dumps(result, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    def jc_list_policies(self, limit: int | None = 20) -> str:
        """List JumpCloud device policies.

        Args:
            limit: Maximum number of policies to return (1-100).

        Returns:
            List of policies with name, template, and OS family.
        """
        result = self._tool.jumpcloud_execute(
            operation="list_policies",
            query_json=json.dumps({"limit": max(1, min(100, limit or 20))}),
        )
        data = result.get("data")
        if isinstance(data, list):
            return _fmt_policies(data, limit or 20)
        return json.dumps(result, ensure_ascii=False)

    def jc_get_auth_events(self, limit: int | None = 20, service: str | None = "directory") -> str:
        """Retrieve recent authentication and directory events from JumpCloud Insights.

        Args:
            limit: Number of events to retrieve (1-200). Use higher values when filtering is needed.
            service: JumpCloud Insights service to query (e.g. 'directory', 'all').

        Returns:
            Recent events with timestamp, event type, service, success flag, actor, and target.
        """
        result = self._tool.jumpcloud_directory_events(service=service or "directory", limit=max(1, min(200, limit or 20)))
        data = result.get("data")
        if isinstance(data, list):
            return _fmt_events(data, "", limit)
        return json.dumps(result, ensure_ascii=False)

    def jc_get_auth_failures(self, limit: int | None = 10, lookback_days: int | None = 7) -> str:
        """Find recent authentication / password failure events in JumpCloud Directory Insights.

        Scans multiple pages of events to surface actual failures (login errors, wrong password, etc.).

        Args:
            limit: Number of failure events to return (1-50).
            lookback_days: How many days back to search (1-30).

        Returns:
            List of authentication failure events with timestamp, actor, target, and error context.
        """
        events, meta = _fetch_failure_events(
            tool=self._tool,
            requested_count=max(1, limit or 10),
            service="directory",
            page_limit=100,
            lookback_days=max(1, min(30, lookback_days or 7)),
        )
        if not events:
            return (
                f"Nenhuma falha de autenticacao encontrada nos ultimos {lookback_days} dias "
                f"(pages_scanned={meta.get('pages_scanned', 0)})."
            )
        return _fmt_events(events, "failed password", len(events))

    # -- prefetch pipeline used by app.py --

    def run_prefetch(
        self,
        operation_name: str,
        operation_args: dict[str, Any],
        prefetch_summary: str,
        message: str,
    ) -> str:
        """Execute a classified JumpCloud lookup and return a formatted context block.

        Args:
            operation_name: The JumpCloud operation to run (e.g. 'list_users').
            operation_args: Query arguments for the operation.
            prefetch_summary: Human-readable label for the data source.
            message: Original user message (used for post-filtering and summarization).

        Returns:
            Structured markdown context block ready to be injected into the agent prompt.
        """
        if operation_name == "list_directory_events":
            operation_args = {
                **operation_args,
                "limit": max(int(operation_args.get("limit", 50) or 50), 50),
            }

        if operation_name == "list_directory_events" and is_password_failure_request(message):
            requested_count = infer_requested_count(message, default=1)
            failure_events, search_meta = _fetch_failure_events(
                tool=self._tool,
                requested_count=requested_count,
                service=str(operation_args.get("service", "directory") or "directory"),
                page_limit=max(int(operation_args.get("limit", 50) or 50), 50),
            )
            jumpcloud_result: dict[str, Any] = {
                "ok": True,
                "status": 200,
                "method": "POST",
                "url": "jumpcloud_directory_events_search",
                "data": failure_events,
                "meta": search_meta,
            }
            operation_args = {**operation_args, **search_meta}
        else:
            jumpcloud_result = self._tool.jumpcloud_execute(
                operation=operation_name,
                query_json=json.dumps(operation_args, ensure_ascii=True),
            )

        summarized_result = _summarize_result(operation_name, jumpcloud_result, message)
        return (
            f"## Resumo Executivo\n"
            f"Consultei o JumpCloud antes de responder.\n\n"
            f"## O que foi observado\n"
            f"Fonte: {prefetch_summary}\n"
            f"Operacao: {operation_name}\n"
            f"Argumentos: {json.dumps(operation_args, ensure_ascii=True)}\n\n"
            f"{summarized_result}\n\n"
            f"## Interpretacao tecnica\n"
            f"Os dados acima foram buscados diretamente na console JumpCloud para esta pergunta.\n\n"
            f"## Lacunas / incertezas\n"
            f"Se precisar, eu posso aplicar filtros mais especificos ou detalhar um item retornado.\n\n"
            f"## Proximos passos recomendados\n"
            f"Posso agora aprofundar em um usuario, device, grupo, policy ou evento especifico.\n\n"
            f"## Nivel de confianca\nAlto"
        )

    def _fetch_user_page(self, skip: int, page_size: int) -> tuple[list[dict], int | None]:
        result = self._tool.jumpcloud_execute(
            operation="list_users",
            query_json=json.dumps({"limit": page_size, "skip": skip}),
        )
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, dict):
            return [], None
        total = data.get("totalCount") or 0
        return data.get("results") or [], total

    def jc_count_users_by_state(self) -> str:
        """Count JumpCloud users grouped by state (ACTIVATED, SUSPENDED, etc).

        Paginates through all users and returns a count per state.
        Use this whenever the user asks how many active, suspended, or total users exist.

        Returns:
            Summary with total count and breakdown by state (ACTIVATED, SUSPENDED, etc).
        """
        counts: dict[str, int] = {}
        skip = 0
        page_size = 100
        total_count: int | None = None
        while True:
            users, page_total = self._fetch_user_page(skip, page_size)
            if total_count is None:
                total_count = page_total
            if not users:
                break
            for u in users:
                state = str(u.get("state") or "UNKNOWN").upper()
                counts[state] = counts.get(state, 0) + 1
            skip += len(users)
            if len(users) < page_size:
                break
        if not counts:
            return "Nenhum usuario encontrado ou erro na consulta."
        total = sum(counts.values())
        state_labels = {"ACTIVATED": "Ativos", "SUSPENDED": "Suspensos"}
        lines = [f"**Total de usuarios no diretorio:** {total_count or total}"]
        for state, n in sorted(counts.items(), key=lambda x: -x[1]):
            lines.append(f"- {state_labels.get(state, state)} ({state}): {n}")
        lines.append(f"\n_Fonte: list_users com paginacao completa ({skip} usuarios processados)_")
        return "\n".join(lines)

    def agno_tools(self) -> list[Any]:
        """Return semantic skill methods to be registered as agno agent tools."""
        return [
            self.jc_count_users_by_state,
            self.jc_find_user,
            self.jc_list_users,
            self.jc_get_user_groups,
            self.jc_list_devices,
            self.jc_list_policies,
            self.jc_get_auth_events,
            self.jc_get_auth_failures,
        ]


def build_jumpcloud_skills_from_env() -> JumpCloudSkills | None:
    """Build JumpCloudSkills from environment variables. Returns None if not configured."""
    tool = build_jumpcloud_tool_from_env()
    if tool is None:
        return None
    return JumpCloudSkills(tool)


async def infer_jumpcloud_plan_with_skill(
    *,
    message: str,
    linked_skills: list[dict[str, Any]],
    runtime_planner: dict[str, Any] | None,
    advanced: Any,
) -> tuple[str, dict[str, Any], str] | None:
    """Use a lightweight LLM classifier to map a user message to a JumpCloud operation plan.

    Falls back to runtime_planner task catalog when available. Returns (operation, query, summary)
    or None if classification fails.
    """
    from model_factory import build_agent_instance
    from utils import parse_json_block, to_text

    enabled_skills = [skill for skill in linked_skills if skill.get("enabled", True)]
    skill_prompt = "\n".join(
        f"- {skill.get('name')}: {skill.get('prompt')}"
        for skill in enabled_skills
        if isinstance(skill.get("prompt"), str) and skill.get("prompt")
    )
    instructions = [
        "You classify JumpCloud user requests into a fixed execution plan.",
        "Use the JumpCloud skill guidance and runtime planner task catalog to infer the most appropriate factual lookup.",
        "Return strict JSON only with fields: taskId, operation, query, summary.",
        "operation must be one of: list_users, list_systems, list_user_groups, list_system_groups, list_policies, list_directory_events.",
        "query must be a JSON object.",
        "summary must be a short label.",
        "For requests about failed password/login/authentication, choose list_directory_events with service=directory and a generous limit.",
        "For requests about users, choose list_users unless the request is clearly about authentication events.",
        "Do not invent unsupported operations or filters.",
    ]
    if skill_prompt:
        instructions.append(f"JumpCloud operational skill guidance:\n{skill_prompt}")
    if runtime_planner:
        planner_tasks = runtime_planner.get("tasks") if isinstance(runtime_planner.get("tasks"), list) else []
        task_catalog = "\n".join(
            [
                f"- id={task.get('id')} name={task.get('name')} operation={task.get('operation')} summary={task.get('summary')} when={task.get('when')}"
                for task in planner_tasks
                if isinstance(task, dict)
            ]
        )
        if task_catalog:
            instructions.append(f"Runtime planner tasks:\n{task_catalog}")
    classifier = build_agent_instance(
        name="JumpCloud Intent Classifier",
        instructions=instructions,
        advanced=advanced,
        tools=[],
        overrides={
            "markdown": False,
            "show_tool_calls": False,
            "add_history_to_context": False,
            "num_history_sessions": 0,
            "add_session_state_to_context": False,
            "reasoning": False,
            "reasoning_min_steps": 1,
            "reasoning_max_steps": 1,
        },
    )
    raw = to_text(await classifier.arun(f"User request:\n{message}\n")).strip()
    parsed = parse_json_block(raw)
    task_id = str(parsed.get("taskId", "")).strip()
    operation = str(parsed.get("operation", "")).strip()
    summary = str(parsed.get("summary", "")).strip() or "JumpCloud"
    query = parsed.get("query")
    allowed_operations = {
        "list_users",
        "list_systems",
        "list_user_groups",
        "list_system_groups",
        "list_policies",
        "list_directory_events",
    }
    if runtime_planner:
        planner_tasks = runtime_planner.get("tasks") if isinstance(runtime_planner.get("tasks"), list) else []
        selected_task = next(
            (
                task
                for task in planner_tasks
                if isinstance(task, dict) and str(task.get("id", "")).strip() == task_id
            ),
            None,
        )
        if isinstance(selected_task, dict):
            selected_operation = str(selected_task.get("operation", "")).strip()
            selected_summary = str(selected_task.get("summary", "")).strip() or summary
            selected_query = selected_task.get("query")
            if selected_operation in allowed_operations and isinstance(selected_query, dict):
                merged_query = dict(selected_query)
                if "limit" in merged_query:
                    requested_limit = infer_requested_count(
                        message,
                        default=int(merged_query.get("limit", 10) or 10),
                    )
                    if selected_operation == "list_directory_events":
                        merged_query["limit"] = max(requested_limit * 25, 50)
                    else:
                        merged_query["limit"] = requested_limit
                return selected_operation, merged_query, selected_summary
    if operation not in allowed_operations or not isinstance(query, dict):
        return None
    return operation, query, summary
