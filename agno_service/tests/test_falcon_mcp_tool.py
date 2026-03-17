from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from falcon_mcp_tool import (
    READ_ONLY_FALCON_TOOLS,
    agent_should_use_falcon_mcp,
    build_falcon_mcp_config_from_env,
    resolve_allowed_falcon_tool_names,
    select_falcon_tool_names,
)


class FalconMCPToolTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_remote_config_disabled_without_url(self) -> None:
        with patch.dict(
            os.environ,
            {
                "FALCON_MCP_ENABLED": "true",
                "FALCON_MCP_TRANSPORT_MODE": "streamable-http",
            },
            clear=True,
        ):
            config = build_falcon_mcp_config_from_env()
        self.assertFalse(config.enabled)
        self.assertEqual(config.transport, "streamable-http")

    @patch.dict(os.environ, {}, clear=True)
    def test_remote_config_enabled_with_url(self) -> None:
        with patch.dict(
            os.environ,
            {
                "FALCON_MCP_ENABLED": "true",
                "FALCON_MCP_TRANSPORT_MODE": "streamable-http",
                "FALCON_MCP_URL": "http://falcon-mcp:8000/mcp",
                "FALCON_MCP_TIMEOUT_SECONDS": "999",
            },
            clear=True,
        ):
            config = build_falcon_mcp_config_from_env()
        self.assertTrue(config.enabled)
        self.assertEqual(config.timeout_seconds, 180)

    def test_agent_detection_uses_name_prompt_team_and_tags(self) -> None:
        enabled = agent_should_use_falcon_mcp(
            agent_name="Falcon EDR Analyst",
            agent_description="Analista de detection and response",
            agent_prompt="Investigue incidentes no CrowdStrike Falcon",
            team_key="DNR",
            tags=["edr", "falcon"],
        )
        self.assertTrue(enabled)

    def test_select_falcon_tool_names_for_hosts_query(self) -> None:
        selected = select_falcon_tool_names("liste hostnames e endpoints da console", include_all_tools=False)
        self.assertIsNotNone(selected)
        assert selected is not None
        self.assertIn("falcon_search_hosts", selected)
        self.assertIn("falcon_get_host_details", selected)

    def test_resolve_allowed_tools_returns_full_readonly_set_when_include_all_tools(self) -> None:
        with patch.dict(
            os.environ,
            {
                "FALCON_MCP_ENABLED": "true",
                "FALCON_MCP_TRANSPORT_MODE": "streamable-http",
                "FALCON_MCP_URL": "http://falcon-mcp:8000/mcp",
                "FALCON_MCP_INCLUDE_ALL_TOOLS": "true",
            },
            clear=True,
        ):
            config = build_falcon_mcp_config_from_env()
        resolved = resolve_allowed_falcon_tool_names(config, message="qualquer pergunta")
        self.assertEqual(resolved, READ_ONLY_FALCON_TOOLS)


if __name__ == "__main__":
    unittest.main()
