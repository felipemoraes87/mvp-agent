from __future__ import annotations

from dataclasses import dataclass

from agno.tools.mcp import MCPTools
from agno.tools.mcp.params import StreamableHTTPClientParams
from secret_env import read_env_value

JUMPCLOUD_MCP_ENDPOINT = "https://mcp.jumpcloud.com/v1"

READ_ONLY_JUMPCLOUD_TOOLS = [
    "users_list",
    "user_get",
    "user_group_membership",
    "user_groups_list",
    "devices_list",
    "device_get",
    "applications_list",
    "application_get",
    "admins_list",
    "di_events_get",
]


@dataclass(frozen=True)
class JumpCloudMCPConfig:
    enabled: bool
    url: str
    api_key: str
    timeout_seconds: int


def build_jumpcloud_mcp_config_from_env() -> JumpCloudMCPConfig:
    api_key = (read_env_value("JUMPCLOUD_ADMIN_API_KEY") or "").strip()
    enabled = bool(api_key)
    return JumpCloudMCPConfig(
        enabled=enabled,
        url=JUMPCLOUD_MCP_ENDPOINT,
        api_key=api_key,
        timeout_seconds=60,
    )


def build_jumpcloud_mcp_tools(config: JumpCloudMCPConfig) -> MCPTools | None:
    if not config.enabled:
        return None
    return MCPTools(
        transport="streamable-http",
        server_params=StreamableHTTPClientParams(
            url=config.url,
            headers={"Authorization": f"Bearer {config.api_key}"},
        ),
        timeout_seconds=config.timeout_seconds,
        include_tools=READ_ONLY_JUMPCLOUD_TOOLS,
    )
