from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .schemas import KnowledgeQuery, KnowledgeResult

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"


def _tokenize(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9_]{3,}", text.lower())}


def _chunk_document(path: Path) -> list[tuple[str, str]]:
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return []
    chunks: list[tuple[str, str]] = []
    current_title = path.stem
    current_lines: list[str] = []
    for line in content.splitlines():
        if line.startswith("#"):
            if current_lines:
                chunks.append((current_title, "\n".join(current_lines).strip()))
                current_lines = []
            current_title = line.lstrip("#").strip() or path.stem
            continue
        current_lines.append(line)
    if current_lines:
        chunks.append((current_title, "\n".join(current_lines).strip()))
    return [(title, body) for title, body in chunks if body]


def _score_chunk(query_tokens: set[str], title: str, body: str) -> float:
    body_tokens = _tokenize(f"{title}\n{body}")
    if not body_tokens:
        return 0.0
    overlap = query_tokens & body_tokens
    if not overlap:
        return 0.0
    heading_boost = 0.2 if query_tokens & _tokenize(title) else 0.0
    return round((len(overlap) / max(len(query_tokens), 1)) + heading_boost, 4)


def search_knowledge(
    *,
    query: KnowledgeQuery,
    linked_knowledge: list[dict[str, Any]] | None = None,
) -> list[KnowledgeResult]:
    query_tokens = _tokenize(f"{query.query} {' '.join(query.domains)} {' '.join(query.source_hints)}")
    results: list[KnowledgeResult] = []
    if DOCS_DIR.exists():
        for path in DOCS_DIR.glob("*.md"):
            for title, body in _chunk_document(path):
                score = _score_chunk(query_tokens, title, body)
                if score <= 0:
                    continue
                snippet = body[:320].replace("\n", " ").strip()
                results.append(
                    KnowledgeResult(
                        title=title,
                        source_name=path.name,
                        source_type="local_docs",
                        snippet=snippet,
                        reference=str(path.relative_to(DOCS_DIR.parent)),
                        score=score,
                        tags=["rag", "docs"],
                    )
                )
    for item in linked_knowledge or []:
        title = str(item.get("name") or item.get("title") or "Linked Knowledge").strip()
        description = str(item.get("description") or "").strip()
        if not description:
            continue
        score = _score_chunk(query_tokens, title, description)
        if score <= 0:
            continue
        results.append(
            KnowledgeResult(
                title=title,
                source_name=title,
                source_type=str(item.get("type") or "linked_knowledge"),
                snippet=description[:320],
                reference=str(item.get("url") or item.get("id") or ""),
                score=score,
                tags=["linked_knowledge"],
            )
        )
    results.sort(key=lambda item: item.score, reverse=True)
    return results[: max(1, query.limit)]
