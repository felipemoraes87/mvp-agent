from __future__ import annotations

import html
import json
import os
import sys
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from team_engine.change_guard import evaluate_change_safety
from team_engine.coordinator import (
    handle_team_request,
    maybe_build_integration_setup_prompt,
    maybe_build_unavailable_integration_prompt,
)
from team_engine.integration_registry import IntegrationConfigRegistry


REPORT_DIR = Path(__file__).resolve().parents[2] / "docs" / "reports"


@contextmanager
def temporary_env(overrides: dict[str, str], clear_keys: list[str] | None = None):
    clear_keys = clear_keys or []
    previous: dict[str, str | None] = {key: os.environ.get(key) for key in set(overrides) | set(clear_keys)}
    try:
        for key in clear_keys:
            os.environ.pop(key, None)
        for key, value in overrides.items():
            os.environ[key] = value
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def format_json(data: Any) -> str:
    return html.escape(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def render_list(items: list[str]) -> str:
    if not items:
        return '<div class="empty">Nenhum item.</div>'
    return "<ul>" + "".join(f"<li>{html.escape(str(item))}</li>" for item in items) + "</ul>"


def evaluate_response(response: Any, checks: list[tuple[str, bool]]) -> tuple[str, str]:
    passed = sum(1 for _, ok in checks if ok)
    total = len(checks)
    status = "PASS" if total and passed == total else "WARN"
    summary = f"{passed}/{total} verificações atendidas."
    if response is None:
        status = "FAIL"
        summary = "Nenhuma resposta retornada pelo coordinator."
    return status, summary


def build_scenarios() -> list[dict[str, Any]]:
    return [
        {
            "id": "IAM-001",
            "title": "Investigacao aberta com Vision Agent e gaps controlados",
            "goal": "Validar que investigacao de acesso roteia para open_investigation com Vision Agent e registra lacunas de conector.",
            "message": "investigue o acesso do usuario alice ao projeto billing-prod e descubra de onde vem a role",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [],
            "env": {},
            "clear": [
                "VISION_BASE_URL",
                "VISION_API_TOKEN",
                "GITHUB_BASE_URL",
                "GITHUB_PAT",
                "GITHUB_TOKEN",
                "IAM_GITHUB_REPOSITORY",
            ],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("modo open_investigation selecionado", response is not None and response.workflow_mode == "open_investigation"),
                ("Vision Agent participante", response is not None and "Vision Agent" in response.participating_agents),
                ("missing configuration presente", response is not None and bool(response.missing_configuration)),
                ("gaps registram conector nao disponivel", response is not None and any("Conector ainda nao disponivel" in gap for gap in response.diagnostic.gaps)),
                ("change guard permanece read-only", guard_plan.decision.decision == "read_only"),
            ],
        },
        {
            "id": "IAM-002",
            "title": "Knowledge-assisted investigation com RAG",
            "goal": "Validar selecao de workflow de knowledge, resultados de RAG e IAM Knowledge Agent no plano.",
            "message": "use a documentacao para me dizer o procedimento correto e explique se esse acesso e adequado",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [
                {
                    "name": "IAM Baseline",
                    "description": "Procedimento oficial para baseline, aprovacoes, excecoes e revisao de acesso no fluxo de IAM.",
                    "type": "confluence",
                    "url": "https://example.local/wiki/iam-baseline",
                }
            ],
            "env": {},
            "clear": [],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("workflow de knowledge selecionado", response is not None and response.workflow_name in {"Knowledge-Assisted Investigation", "Documentation-Assisted Troubleshooting"}),
                ("knowledge results presentes", response is not None and len(response.knowledge_results) > 0),
                ("IAM Knowledge Agent no plano", response is not None and "IAM Knowledge Agent" in response.participating_agents),
                ("change guard permanece read-only", guard_plan.decision.decision == "read_only"),
            ],
        },
        {
            "id": "IAM-003",
            "title": "Classificacao de intent troubleshooting",
            "goal": "Validar que intent de troubleshooting e identificado corretamente e roteia para investigacao aberta.",
            "message": "analise o risco desse comportamento de autenticacao com multiplos ips, geo inconsistente e falha de senha",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [],
            "env": {},
            "clear": [],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("intent classificado como troubleshooting", response is not None and response.request_type == "troubleshooting"),
                ("modo open_investigation", response is not None and response.workflow_mode == "open_investigation"),
                ("IAM Orchestrator presente no plano", response is not None and "IAM Orchestrator" in response.participating_agents),
                ("change guard permanece read-only", guard_plan.decision.decision == "read_only"),
            ],
        },
        {
            "id": "IAM-004",
            "title": "Proposta de mudanca controlada com guardrails",
            "goal": "Validar bloqueio de escrita sensivel, geracao de change_proposal e exigencia de aprovacao.",
            "message": "aplique a role owner em prod para o usuario bob com aprovacao do gestor",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [],
            "env": {},
            "clear": [],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("change proposal gerado para acao de escrita", response is not None and response.change_proposal is not None),
                ("Vision Agent no plano para operacao write", response is not None and "Vision Agent" in response.participating_agents),
                ("guard decision exige aprovacao", guard_plan.decision.decision == "approval_required"),
            ],
        },
        {
            "id": "IAM-005",
            "title": "Open investigation com Vision configurado",
            "goal": "Validar investigacao aberta quando Vision esta configurado e nao aparece como missing.",
            "message": "tem algo estranho entre grupos, aprovacoes e autenticacoes desse usuario",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [],
            "env": {
                "VISION_BASE_URL": "https://vision.unico.io/api",
                "VISION_API_TOKEN": "redacted-secret",
            },
            "clear": [],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("modo aberto ou workflow aceitavel", response is not None and response.workflow_mode in {"open_investigation", "workflow"}),
                ("sem missing de Vision", response is not None and not any(item.integration_key == "vision" for item in response.missing_configuration)),
                ("Vision Agent participante", response is not None and "Vision Agent" in response.participating_agents),
            ],
        },
        {
            "id": "IAM-006",
            "title": "Diagnostico de provisionamento com lacuna de Vision",
            "goal": "Validar deteccao do workflow de provisionamento e registro de gaps quando Vision nao esta configurado.",
            "message": "o acesso nao provisionou no Vision e nao refletiu no sistema, preciso entender onde falhou",
            "runtime_config": {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}},
            "linked_knowledge": [],
            "env": {},
            "clear": ["VISION_BASE_URL", "VISION_API_TOKEN"],
            "checks": lambda response, setup_prompt, unavailable_prompt, guard_plan: [
                ("workflow de provisionamento selecionado", response is not None and response.workflow_name == "Provisioning / Reconciliation Diagnostic"),
                ("Vision Agent participante", response is not None and "Vision Agent" in response.participating_agents),
                ("gaps registram lacuna de Vision", response is not None and any("Vision" in gap for gap in response.diagnostic.gaps)),
                ("change guard permanece read-only", guard_plan.decision.decision == "read_only"),
            ],
        },
    ]


def render_scenario_card(result: dict[str, Any]) -> str:
    checks_html = "<ul>" + "".join(
        f"<li><span class='pill {'pass' if ok else 'warn'}'>{'OK' if ok else 'WARN'}</span> {html.escape(label)}</li>"
        for label, ok in result["checks"]
    ) + "</ul>"
    response_dump = result["response"].model_dump(mode="json") if result["response"] is not None else None
    return f"""
    <section class="card">
      <div class="card-head">
        <div>
          <div class="eyebrow">{html.escape(result["id"])}</div>
          <h2>{html.escape(result["title"])}</h2>
          <p class="goal">{html.escape(result["goal"])}</p>
        </div>
        <div class="status {result["status"].lower()}">{html.escape(result["status"])}</div>
      </div>
      <div class="grid">
        <div>
          <h3>Etapa 1. Input</h3>
          <div class="block"><strong>Prompt:</strong><pre>{html.escape(result["message"])}</pre></div>
          <div class="block"><strong>Runtime config:</strong><pre>{format_json(result["runtime_config"])}</pre></div>
          <div class="block"><strong>Linked knowledge:</strong><pre>{format_json(result["linked_knowledge"])}</pre></div>
        </div>
        <div>
          <h3>Etapa 2. Setup / Disponibilidade</h3>
          <div class="block"><strong>Setup prompt:</strong><pre>{html.escape(result["setup_prompt"] or "Nenhum")}</pre></div>
          <div class="block"><strong>Unavailable prompt:</strong><pre>{html.escape(result["unavailable_prompt"] or "Nenhum")}</pre></div>
          <div class="block"><strong>Guard decision:</strong><pre>{format_json(result["guard_plan"])}</pre></div>
        </div>
      </div>
      <div class="grid">
        <div>
          <h3>Etapa 3. Raciocínio / Decisões</h3>
          <div class="block"><strong>Resumo:</strong><pre>{html.escape(result["summary"])}</pre></div>
          <div class="block"><strong>Checks:</strong>{checks_html}</div>
          <div class="block"><strong>Diagnóstico:</strong>{render_list(result["diagnostic_findings"])}</div>
          <div class="block"><strong>Gaps:</strong>{render_list(result["diagnostic_gaps"])}</div>
        </div>
        <div>
          <h3>Etapa 4. Output estruturado</h3>
          <div class="block"><strong>Decisões principais:</strong>{render_list(result["decisions"])}</div>
          <div class="block"><strong>Próximos passos:</strong>{render_list(result["next_steps"])}</div>
          <div class="block"><strong>Evidence:</strong>{render_list(result["evidence_summaries"])}</div>
        </div>
      </div>
      <div class="block">
        <h3>Payload completo</h3>
        <pre>{format_json(response_dump)}</pre>
      </div>
    </section>
    """


def build_report_html(results: list[dict[str, Any]]) -> str:
    total = len(results)
    passed = sum(1 for item in results if item["status"] == "PASS")
    warned = sum(1 for item in results if item["status"] == "WARN")
    generated_at = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    cards = "\n".join(render_scenario_card(item) for item in results)
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>IAM Team Test Report</title>
  <style>
    :root {{
      --bg: #0b1220;
      --panel: #111a2c;
      --panel-2: #16233a;
      --border: #2a3b5f;
      --text: #e5eefc;
      --muted: #95a6c6;
      --pass: #22c55e;
      --warn: #f59e0b;
      --fail: #ef4444;
      --accent: #38bdf8;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Segoe UI, Arial, sans-serif;
      background:
        radial-gradient(circle at top right, rgba(56,189,248,0.15), transparent 28%),
        linear-gradient(180deg, #08101d 0%, var(--bg) 100%);
      color: var(--text);
      line-height: 1.45;
    }}
    .wrap {{ max-width: 1360px; margin: 0 auto; padding: 28px; }}
    .hero {{
      background: linear-gradient(135deg, rgba(17,26,44,0.96), rgba(22,35,58,0.96));
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.22);
    }}
    h1, h2, h3, p {{ margin-top: 0; }}
    h1 {{ font-size: 32px; margin-bottom: 10px; }}
    h2 {{ font-size: 22px; margin-bottom: 8px; }}
    h3 {{ font-size: 15px; color: #c8d7f5; margin-bottom: 10px; }}
    .muted {{ color: var(--muted); }}
    .summary {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 20px;
    }}
    .metric, .card, .block {{
      background: rgba(17,26,44,0.94);
      border: 1px solid var(--border);
      border-radius: 18px;
    }}
    .metric {{ padding: 16px; }}
    .metric .value {{ font-size: 26px; font-weight: 700; }}
    .metric .label {{ font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }}
    .cards {{ display: grid; gap: 18px; margin-top: 24px; }}
    .card {{ padding: 22px; }}
    .card-head {{
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 18px;
    }}
    .status {{
      min-width: 84px;
      text-align: center;
      padding: 8px 12px;
      border-radius: 999px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }}
    .status.pass {{ background: rgba(34,197,94,0.16); color: #86efac; }}
    .status.warn {{ background: rgba(245,158,11,0.16); color: #fcd34d; }}
    .status.fail {{ background: rgba(239,68,68,0.16); color: #fca5a5; }}
    .eyebrow {{ color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 8px; }}
    .goal {{ color: var(--muted); max-width: 72ch; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }}
    .block {{ padding: 14px; margin-bottom: 12px; }}
    pre {{
      margin: 8px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: rgba(8,16,29,0.88);
      border: 1px solid #20304f;
      border-radius: 12px;
      padding: 12px;
      color: #d9e7ff;
      font-size: 12px;
      overflow: auto;
    }}
    ul {{ margin: 8px 0 0; padding-left: 20px; }}
    li {{ margin-bottom: 6px; color: #d8e2f3; }}
    .pill {{
      display: inline-block;
      min-width: 42px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      margin-right: 8px;
    }}
    .pill.pass {{ background: rgba(34,197,94,0.16); color: #86efac; }}
    .pill.warn {{ background: rgba(245,158,11,0.16); color: #fcd34d; }}
    .empty {{ color: var(--muted); font-size: 13px; }}
    .footer {{ margin: 22px 0 8px; color: var(--muted); font-size: 12px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="eyebrow">MVP Agent · IAM Team</div>
      <h1>Plano executado de testes do IAM Team</h1>
      <p class="muted">Relatório gerado automaticamente com cenários cobrindo coordinator, workflows, setup sequencial, knowledge layer, entitlement reasoning, risk triage e change guard.</p>
      <div class="summary">
        <div class="metric"><div class="label">Gerado em</div><div class="value" style="font-size:18px">{html.escape(generated_at)}</div></div>
        <div class="metric"><div class="label">Cenários</div><div class="value">{total}</div></div>
        <div class="metric"><div class="label">Pass</div><div class="value" style="color:#86efac">{passed}</div></div>
        <div class="metric"><div class="label">Warn</div><div class="value" style="color:#fcd34d">{warned}</div></div>
      </div>
    </section>
    <div class="cards">
      {cards}
    </div>
    <div class="footer">Fonte: execução local via funções internas do IAM Team no ambiente do MVP Agent.</div>
  </div>
</body>
</html>"""


def main() -> None:
    registry = IntegrationConfigRegistry()
    results: list[dict[str, Any]] = []
    for scenario in build_scenarios():
        with temporary_env(scenario["env"], clear_keys=scenario["clear"]):
            response = handle_team_request(
                team_key=scenario["runtime_config"].get("iamTeamProfile", {}).get("teamKey", "IAM_IGA"),
                agent_name="IAM Orchestrator",
                runtime_config=scenario["runtime_config"],
                message=scenario["message"],
                linked_knowledge=scenario["linked_knowledge"],
            )
            setup_prompt = None
            unavailable_prompt = None
            if response is not None:
                plan_integrations = list(
                    dict.fromkeys(
                        [item.integration_key for item in response.missing_configuration]
                        + [integration for step in response.plan_steps for integration in step.integration_keys]
                    )
                )
                if plan_integrations:
                    setup_prompt = maybe_build_integration_setup_prompt(
                        integration_keys=plan_integrations,
                        runtime_config=scenario["runtime_config"],
                        registry=registry,
                    )
                    unavailable_prompt = maybe_build_unavailable_integration_prompt(
                        integration_keys=plan_integrations,
                        registry=registry,
                    )
            guard_plan = evaluate_change_safety(
                message=scenario["message"],
                requires_write=any(token in scenario["message"].lower() for token in ["aplique", "mude", "altere", "execute", "grave", "proposta de mudanca"]),
            )
            checks = scenario["checks"](response, setup_prompt, unavailable_prompt, guard_plan)
            status, summary = evaluate_response(response, checks)
            results.append(
                {
                    "id": scenario["id"],
                    "title": scenario["title"],
                    "goal": scenario["goal"],
                    "message": scenario["message"],
                    "runtime_config": scenario["runtime_config"],
                    "linked_knowledge": scenario["linked_knowledge"],
                    "setup_prompt": setup_prompt,
                    "unavailable_prompt": unavailable_prompt,
                    "guard_plan": guard_plan.model_dump(mode="json"),
                    "response": response,
                    "checks": checks,
                    "status": status,
                    "summary": summary,
                    "diagnostic_findings": list(response.diagnostic.findings) if response and response.diagnostic else [],
                    "diagnostic_gaps": list(response.diagnostic.gaps) if response and response.diagnostic else [],
                    "next_steps": list(response.next_steps) if response else [],
                    "decisions": [
                        f"workflow_mode={response.workflow_mode}" if response else "workflow_mode=none",
                        f"workflow_name={response.workflow_name}" if response else "workflow_name=none",
                        f"entitlement={response.entitlement_assessment.classification}" if response and response.entitlement_assessment else "entitlement=none",
                        f"risk={response.risk_assessment.overall_severity}" if response and response.risk_assessment else "risk=none",
                        f"guard={guard_plan.decision.decision}",
                    ],
                    "evidence_summaries": [item.summary for item in response.evidence[:6]] if response else [],
                }
            )

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    report_path = REPORT_DIR / f"iam-team-test-report-{timestamp}.html"
    latest_path = REPORT_DIR / "iam-team-test-report-latest.html"
    report_html = build_report_html(results)
    report_path.write_text(report_html, encoding="utf-8")
    latest_path.write_text(report_html, encoding="utf-8")
    print(str(report_path))


if __name__ == "__main__":
    main()
