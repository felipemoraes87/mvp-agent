from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .schemas import InvestigationMemoryEntry

MEMORY_FILE = Path(__file__).resolve().parents[1] / "runtime" / "iam_investigation_memory.jsonl"


class InvestigationMemoryStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or MEMORY_FILE
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(
        self,
        *,
        query: str,
        workflow_name: str | None,
        participants: list[str],
        findings: list[str],
        evidence_refs: list[str],
        tags: list[str],
    ) -> InvestigationMemoryEntry:
        entry = InvestigationMemoryEntry(
            id=str(uuid4()),
            created_at=datetime.now(UTC).isoformat(),
            query=query,
            workflow_name=workflow_name,
            participants=participants,
            findings=findings,
            evidence_refs=evidence_refs,
            tags=tags,
        )
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(entry.model_dump_json() + "\n")
        return entry
