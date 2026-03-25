from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

router = APIRouter()


_MAX_AGENT_LOG_ENTRIES = 600
_agent_run_log: list[dict[str, Any]] = []


def _emit_agent_log(
    event_type: str,
    agent: str,
    session_id: str,
    message: str,
    detail: dict[str, Any] | None = None,
) -> None:
    entry: dict[str, Any] = {
        "id": f"{session_id}-{len(_agent_run_log):05d}",
        "sessionId": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": agent,
        "eventType": event_type,
        "message": message,
        "detail": detail or {},
    }
    _agent_run_log.append(entry)
    if len(_agent_run_log) > _MAX_AGENT_LOG_ENTRIES:
        del _agent_run_log[: len(_agent_run_log) - _MAX_AGENT_LOG_ENTRIES]


@router.get("/agent-logs")
def agent_logs_endpoint(
    agent: str | None = None,
    event_type: str | None = None,
    session_id: str | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = list(reversed(_agent_run_log))
    if agent:
        entries = [e for e in entries if agent.lower() in e["agent"].lower()]
    if event_type:
        entries = [e for e in entries if e["eventType"] == event_type]
    if session_id:
        entries = [e for e in entries if e["sessionId"] == session_id]
    capped = min(max(1, limit), 500)
    return {"logs": entries[:capped], "total": len(_agent_run_log)}
