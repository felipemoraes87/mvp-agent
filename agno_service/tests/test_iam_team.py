from __future__ import annotations

import unittest
from unittest.mock import patch

from iam_team.coordinator import (
    handle_iam_team_request,
    maybe_build_integration_setup_prompt,
    maybe_build_unavailable_integration_prompt,
)
from iam_team.change_guard import evaluate_change_safety
from iam_team.integration_registry import IntegrationConfigRegistry
from iam_team.knowledge_layer import search_knowledge
from iam_team.schemas import KnowledgeQuery


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
    def test_coordinator_selects_workflow_and_reports_missing_config(self) -> None:
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="investigue o acesso do usuario alice ao projeto billing-prod e descubra de onde vem a role",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.workflow_mode, "workflow")
        self.assertEqual(response.workflow_name, "Access Trace Workflow")
        self.assertTrue(response.missing_configuration)
        self.assertEqual(response.participating_agents[1], "JumpCloud Directory Analyst")
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
            "JUMPCLOUD_BASE_URL": "https://console.jumpcloud.com",
            "JUMPCLOUD_API_KEY": "secret",
            "IGA_BASE_URL": "https://iga.example/api",
            "IGA_API_TOKEN": "secret",
        },
        clear=True,
    )
    def test_open_investigation_without_missing_when_integrations_are_present(self) -> None:
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="investigue este caso estranho entre groups e aprovacoes do IGA",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIn(response.workflow_mode, {"workflow", "open_investigation"})
        self.assertFalse(any(item.integration_key in {"jumpcloud", "iga"} for item in response.missing_configuration))

    @patch.dict("os.environ", {}, clear=True)
    def test_coordinator_returns_knowledge_and_entitlement_layers(self) -> None:
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="explique de onde vem esse acesso e se ele e adequado segundo o procedimento oficial",
            linked_knowledge=[{"name": "IAM Baseline", "description": "Procedimento oficial para baseline e excecoes de acesso."}],
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertTrue(response.knowledge_results)
        self.assertIsNotNone(response.entitlement_assessment)
        self.assertIn("IAM Knowledge Agent", response.participating_agents)
        self.assertIn("Entitlement Reasoning Agent", response.participating_agents)

    @patch.dict("os.environ", {}, clear=True)
    def test_coordinator_returns_risk_assessment(self) -> None:
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="analise o risco desse comportamento de autenticacao com multiplos ips e falha de senha",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIsNotNone(response.risk_assessment)
        self.assertIn(response.workflow_name, {"IAM Risk Triage", "Suspicious Authentication Investigation"})
        self.assertIn("IAM Risk Analyst", response.participating_agents)

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
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="Leia o ticket IAM-123 do Jira e conceda acesso para o usuario alice no GitHub com a justificativa onboarding do time de engenharia.",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.workflow_name, "Jira Access Request Intake Workflow")
        self.assertIsNotNone(response.ticket_triage)
        assert response.ticket_triage is not None
        self.assertEqual(response.ticket_triage.classification, "fulfillable_access_request")
        self.assertEqual(response.ticket_triage.business_role, "BR_GITHUB_REPOSITORY_READER")

    @patch.dict("os.environ", {}, clear=True)
    def test_jira_access_request_triage_requests_guidance_when_missing_fields(self) -> None:
        response = handle_iam_team_request(
            agent_name="IAM Orchestrator",
            runtime_config={"iamTeamProfile": {"role": "coordinator"}},
            message="Leia a fila do Jira e responda o chamado IAM-456 sobre acesso porque o usuario esta com duvida.",
        )
        self.assertIsNotNone(response)
        assert response is not None
        self.assertIsNotNone(response.ticket_triage)
        assert response.ticket_triage is not None
        self.assertEqual(response.ticket_triage.classification, "unclear_request")
        self.assertEqual(response.ticket_triage.jira_action, "comment_only")


if __name__ == "__main__":
    unittest.main()
