from __future__ import annotations

import unittest
from unittest.mock import patch

from team_engine.coordinator import (
    handle_team_request,
    maybe_build_integration_setup_prompt,
    maybe_build_unavailable_integration_prompt,
)
from team_engine.change_guard import evaluate_change_safety
from team_engine.integration_registry import IntegrationConfigRegistry
from team_engine.knowledge_layer import search_knowledge
from team_engine.schemas import KnowledgeQuery

_IAM_RT = {"iamTeamProfile": {"role": "coordinator", "teamKey": "IAM_IGA"}}


class IAMTeamTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_setup_flow_returns_first_missing_field_in_order(self) -> None:
        registry = IntegrationConfigRegistry()
        prompt = maybe_build_integration_setup_prompt(
            integration_keys=["github"],
            runtime_config=None,
            registry=registry,
        )
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertIn("GitHub", prompt)
        self.assertIn("Base URL", prompt)

    @patch.dict("os.environ", {}, clear=True)
    def test_coordinator_routes_investigation_to_open_mode_with_vision_agent(self) -> None:
        # "de onde vem" → investigation intent; no workflow matches; "acesso" routes Vision Agent
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="investigue o acesso do usuario alice ao projeto billing-prod e descubra de onde vem a role",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.workflow_mode, "open_investigation")
        self.assertIsNone(response.workflow_name)
        self.assertTrue(response.missing_configuration)
        self.assertIn("Vision Agent", response.participating_agents)
        self.assertTrue(any("Conector ainda nao disponivel" in gap for gap in response.diagnostic.gaps))

    def test_unavailable_connector_returns_safe_prompt(self) -> None:
        registry = IntegrationConfigRegistry()
        prompt = maybe_build_unavailable_integration_prompt(
            integration_keys=["github"],
            registry=registry,
        )
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertIn("ainda nao esta disponivel", prompt)
        self.assertIn("GitHub", prompt)

    @patch.dict(
        "os.environ",
        {
            "VISION_BASE_URL": "https://vision.unico.io/api",
            "VISION_API_TOKEN": "secret",
        },
        clear=True,
    )
    def test_open_investigation_without_missing_when_vision_is_configured(self) -> None:
        # "aprovacoes do Vision" routes Vision Agent; with VISION env vars set, no missing config for vision
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="investigue este caso estranho entre groups e aprovacoes do Vision",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIn(response.workflow_mode, {"workflow", "open_investigation"})
        self.assertFalse(any(item.integration_key == "vision" for item in response.missing_configuration))

    @patch.dict("os.environ", {}, clear=True)
    def test_coordinator_selects_workflow_and_returns_knowledge_results(self) -> None:
        # "procedimento" → Documentation-Assisted Troubleshooting; linked_knowledge feeds knowledge_results
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="explique de onde vem esse acesso e se ele e adequado segundo o procedimento oficial",
            linked_knowledge=[{"name": "IAM Baseline", "description": "Procedimento oficial para baseline e excecoes de acesso."}],
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertTrue(response.knowledge_results)
        self.assertEqual(response.workflow_name, "Documentation-Assisted Troubleshooting")
        self.assertIn("IAM Knowledge Agent", response.participating_agents)

    @patch.dict("os.environ", {}, clear=True)
    def test_coordinator_classifies_troubleshooting_intent(self) -> None:
        # "falha" → troubleshooting category; no workflow matches → open_investigation with just orchestrator
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="analise o risco desse comportamento de autenticacao com multiplos ips e falha de senha",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.request_type, "troubleshooting")
        self.assertEqual(response.workflow_mode, "open_investigation")
        self.assertIsNone(response.workflow_name)
        self.assertIn("IAM Orchestrator", response.participating_agents)

    def test_change_guard_blocks_sensitive_write_by_default(self) -> None:
        plan = evaluate_change_safety(message="aplique a role owner em prod para o usuario", requires_write=True)
        self.assertEqual(plan.decision.decision, "approval_required")
        self.assertTrue(plan.decision.approval.approval_required)

    def test_local_knowledge_search_returns_results(self) -> None:
        results = search_knowledge(
            query=KnowledgeQuery(
                query="procedimento de IAM e configuracao de integracoes",
                intent="simple_query",
                domains=["iam"],
            )
        )
        self.assertTrue(results)

    @patch.dict("os.environ", {}, clear=True)
    def test_jira_access_request_triage_returns_business_role(self) -> None:
        # "ticket" → Jira Access Request Triage workflow; github system + acesso → BR_GITHUB_REPOSITORY_READER
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="Leia o ticket IAM-123 do Jira e conceda acesso para o usuario alice no GitHub com a justificativa onboarding do time de engenharia.",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.workflow_name, "Jira Access Request Triage")
        self.assertIsNotNone(response.ticket_triage)
        assert response.ticket_triage is not None
        self.assertEqual(response.ticket_triage.classification, "fulfillable_access_request")
        self.assertEqual(response.ticket_triage.business_role, "BR_GITHUB_REPOSITORY_READER")

    @patch.dict("os.environ", {}, clear=True)
    def test_jira_access_request_triage_requests_guidance_when_missing_fields(self) -> None:
        # "duvida" → has_guidance_language → unclear_request → comment_only
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="Leia a fila do Jira e responda o chamado IAM-456 sobre acesso porque o usuario esta com duvida.",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIsNotNone(response.ticket_triage)
        assert response.ticket_triage is not None
        self.assertEqual(response.ticket_triage.classification, "unclear_request")
        self.assertEqual(response.ticket_triage.jira_action, "comment_only")

    @patch.dict("os.environ", {}, clear=True)
    def test_provisioning_workflow_detected_and_vision_gaps_reported(self) -> None:
        # "nao provisionou" + "nao refletiu" → Provisioning / Reconciliation Diagnostic; vision missing
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="o acesso nao provisionou no Vision e nao refletiu no sistema, preciso entender onde falhou",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.workflow_name, "Provisioning / Reconciliation Diagnostic")
        self.assertIn("Vision Agent", response.participating_agents)
        self.assertTrue(any("Vision" in gap for gap in response.diagnostic.gaps))

    @patch.dict("os.environ", {}, clear=True)
    def test_write_trigger_generates_change_proposal_with_approval(self) -> None:
        # "aplique" is a write_trigger; "aprovacao" routes Vision Agent (can_write); change_proposal generated
        response = handle_team_request(
            team_key="IAM_IGA",
            agent_name="IAM Orchestrator",
            runtime_config=_IAM_RT,
            message="aplique a role owner em prod para o usuario bob com aprovacao do gestor",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIsNotNone(response.change_proposal)
        self.assertIn("Vision Agent", response.participating_agents)
        guard_plan = evaluate_change_safety(
            message="aplique a role owner em prod para o usuario bob",
            requires_write=True,
        )
        self.assertEqual(guard_plan.decision.decision, "approval_required")


if __name__ == "__main__":
    unittest.main()
