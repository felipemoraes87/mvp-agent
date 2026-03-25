from __future__ import annotations

import json
import re
from typing import Any

from fastapi import Request


def normalize_tokens(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", text.lower(), flags=re.UNICODE)
    return [t for t in clean.split() if len(t) > 2]


def normalize_tag_values(tags: Any) -> list[str]:
    if not isinstance(tags, list):
        return []
    return [str(tag).strip().lower() for tag in tags if str(tag).strip()]


def normalize_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(item).strip().lower() for item in values if str(item).strip()]


def score_agent_match(
    *,
    name: str,
    description: str,
    prompt: str,
    tags: Any,
    message: str,
) -> float:
    msg_tokens = set(normalize_tokens(message))
    if not msg_tokens:
        return 0.0

    catalog_tokens = set(
        normalize_tokens(
            " ".join(
                [
                    name,
                    description,
                    prompt,
                    " ".join(normalize_tag_values(tags)),
                ]
            )
        )
    )
    score = float(len(msg_tokens.intersection(catalog_tokens)))
    lowered = message.lower()
    if "falcon" in lowered or "crowdstrike" in lowered:
        if "falcon" in catalog_tokens or "crowdstrike" in catalog_tokens:
            score += 2.0
    if "edr" in lowered and "edr" in catalog_tokens:
        score += 1.5
    if "detection" in lowered and "detection" in catalog_tokens:
        score += 1.0
    return score


def to_text(run_output: Any) -> str:
    if run_output is None:
        return ""
    content = getattr(run_output, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(run_output, str):
        return run_output
    return str(content or run_output)


def extract_structured_result_items(tool_result: Any) -> list[dict[str, Any]]:
    structured = getattr(tool_result, "structuredContent", None)
    if isinstance(structured, dict):
        result = structured.get("result")
        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]
    return []


def truncate_text(value: str, limit: int = 4000) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 15].rstrip() + "\n...[truncated]"


def compact_json(value: Any, limit: int = 5000) -> str:
    return truncate_text(json.dumps(value, ensure_ascii=False, indent=2), limit=limit)


def extract_agent_runtime_planner(runtime_config: Any, domain: str) -> dict[str, Any] | None:
    if not isinstance(runtime_config, dict):
        return None
    planner = runtime_config.get("domainPlanner")
    if not isinstance(planner, dict):
        return None
    if str(planner.get("domain", "")).strip().lower() != domain.lower():
        return None
    if planner.get("enabled") is False:
        return None
    tasks = planner.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return None
    return planner


def parse_json_block(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < 0 or end <= start:
            return {}
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return {}


def extract_reply_from_text(text: str) -> str:
    clean = text.strip()
    if not clean:
        return ""

    # Accept simple "reply: ..." format when model misses strict JSON.
    for line in clean.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("reply:"):
            _, _, value = stripped.partition(":")
            candidate = value.strip()
            if candidate:
                return candidate

    parsed = parse_json_block(clean)
    reply = parsed.get("reply") if isinstance(parsed, dict) else None
    if isinstance(reply, str):
        return reply.strip()

    return ""


def get_correlation_id(request: Request | None) -> str:
    if request is None:
        return "none"
    return request.headers.get("x-correlation-id", "none")


def format_runtime_response(reply: str, reasoning_summary: list[str] | None = None) -> str:
    return json.dumps(
        {
            "reply": reply,
            "reasoning_summary": reasoning_summary or ["Execution plan prepared.", "Awaiting the next safe step."],
        },
        ensure_ascii=True,
    )


def format_iam_team_reply(response: Any) -> str:
    lines = [
        f"Resumo: {response.summary}",
        f"Modo: {response.workflow_mode}",
    ]
    if response.workflow_name:
        lines.append(f"Workflow: {response.workflow_name}")
    if response.participating_agents:
        lines.append(f"Agentes: {', '.join(response.participating_agents)}")
    if response.missing_configuration:
        next_missing = response.missing_configuration[0]
        lines.extend(
            [
                "",
                "Configuracao pendente:",
                f"- Integracao: {next_missing.integration_label}",
                f"- Campo: {next_missing.field_label}",
                f"- Motivo: {next_missing.description}",
            ]
        )
    if response.next_steps:
        lines.extend(["", "Proximos passos:"] + [f"- {step}" for step in response.next_steps[:4]])
    if getattr(response, "entitlement_assessment", None) is not None:
        lines.extend(
            [
                "",
                "Entitlement reasoning:",
                f"- Classificacao: {response.entitlement_assessment.classification}",
                f"- Resumo: {response.entitlement_assessment.summary}",
            ]
        )
    if getattr(response, "risk_assessment", None) is not None:
        lines.extend(
            [
                "",
                "Risk assessment:",
                f"- Severidade: {response.risk_assessment.overall_severity}",
                f"- Resumo: {response.risk_assessment.summary}",
            ]
        )
    if getattr(response, "guarded_action_plan", None) is not None and response.guarded_action_plan.decision.decision != "read_only":
        lines.extend(
            [
                "",
                "Change guard:",
                f"- Decisao: {response.guarded_action_plan.decision.decision}",
                f"- Risco: {response.guarded_action_plan.decision.risk_summary}",
            ]
        )
    return "\n".join(lines)
