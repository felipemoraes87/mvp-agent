from __future__ import annotations

from typing import Any
import yaml
from pathlib import Path


_REQUIRED_FIELDS = {
    "name",
    "objective",
    "preconditions",
    "integrations",
    "agents",
    "steps",
    "success_criteria",
    "output_format",
    "failure_handling",
    "setup_points",
    "match_keywords",
}


def load_workflows(team_key: str) -> list[dict[str, Any]]:
    workflows_dir = Path(__file__).parent.parent / "config" / "workflows"
    all_workflows: list[dict[str, Any]] = []
    for yaml_file in sorted(workflows_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as exc:
            raise RuntimeError(f"YAML invalido em {yaml_file}: {exc}")
        if not isinstance(data, dict):
            raise RuntimeError(f"Esperado dict em {yaml_file}, encontrado: {type(data).__name__}")
        wf_team = data.get("team")
        if isinstance(wf_team, list):
            if team_key not in wf_team:
                continue
        elif wf_team != team_key:
            continue
        missing = _REQUIRED_FIELDS - data.keys()
        if missing:
            name = data.get("name", yaml_file.stem)
            raise RuntimeError(
                f"Workflow '{name}' em {yaml_file} esta faltando campos obrigatorios: {sorted(missing)}"
            )
        all_workflows.append(data)
    return all_workflows


def detect_workflow(message: str, workflows: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[str]]:
    lowered = message.lower()
    best_match: dict[str, Any] | None = None
    matched_keywords: list[str] = []
    for workflow in workflows:
        wf_matches = [kw for kw in workflow.get("match_keywords", []) if kw in lowered]
        if len(wf_matches) > len(matched_keywords):
            best_match = workflow
            matched_keywords = wf_matches
    return best_match, matched_keywords
