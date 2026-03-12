from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request


class JumpCloudToolError(RuntimeError):
    pass


USER_BY_ID_PATH = "/users/{user_id}"
USER_GROUP_BY_ID_PATH = "/usergroups/{group_id}"
SYSTEM_GROUP_BY_ID_PATH = "/systemgroups/{group_id}"
JUMPCLOUD_DEFAULT_BASE_URL = "https://console.jumpcloud.com"


def _parse_json_or_empty(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise JumpCloudToolError(f"Invalid JSON payload: {exc}") from exc
    if not isinstance(parsed, dict):
        raise JumpCloudToolError("JSON payload must be an object.")
    return parsed


@dataclass(frozen=True)
class OperationSpec:
    family: str
    method: str
    path: str
    write: bool = False
    description: str = ""


OPERATION_CATALOG: dict[str, OperationSpec] = {
    "list_users": OperationSpec("v2", "GET", "/users", description="List users"),
    "get_user": OperationSpec("v2", "GET", USER_BY_ID_PATH, description="Get user by id"),
    "create_user": OperationSpec("v2", "POST", "/users", write=True, description="Create user"),
    "replace_user": OperationSpec("v2", "PUT", USER_BY_ID_PATH, write=True, description="Replace user"),
    "patch_user": OperationSpec("v2", "PATCH", USER_BY_ID_PATH, write=True, description="Patch user"),
    "delete_user": OperationSpec("v2", "DELETE", USER_BY_ID_PATH, write=True, description="Delete user"),
    "list_systems": OperationSpec("v2", "GET", "/systems", description="List systems/devices"),
    "get_system": OperationSpec("v2", "GET", "/systems/{system_id}", description="Get system by id"),
    "list_user_groups": OperationSpec("v2", "GET", "/usergroups", description="List user groups"),
    "get_user_group": OperationSpec("v2", "GET", USER_GROUP_BY_ID_PATH, description="Get user group"),
    "create_user_group": OperationSpec("v2", "POST", "/usergroups", write=True, description="Create user group"),
    "patch_user_group": OperationSpec("v2", "PATCH", USER_GROUP_BY_ID_PATH, write=True, description="Patch user group"),
    "delete_user_group": OperationSpec("v2", "DELETE", USER_GROUP_BY_ID_PATH, write=True, description="Delete user group"),
    "list_system_groups": OperationSpec("v2", "GET", "/systemgroups", description="List system groups"),
    "get_system_group": OperationSpec("v2", "GET", SYSTEM_GROUP_BY_ID_PATH, description="Get system group"),
    "create_system_group": OperationSpec("v2", "POST", "/systemgroups", write=True, description="Create system group"),
    "patch_system_group": OperationSpec("v2", "PATCH", SYSTEM_GROUP_BY_ID_PATH, write=True, description="Patch system group"),
    "delete_system_group": OperationSpec("v2", "DELETE", SYSTEM_GROUP_BY_ID_PATH, write=True, description="Delete system group"),
    "list_commands": OperationSpec("v2", "GET", "/commands", description="List commands"),
    "run_command": OperationSpec("v2", "POST", "/commands", write=True, description="Create/Run command"),
    "list_policies": OperationSpec("v2", "GET", "/policies", description="List policies"),
    "list_directory_events": OperationSpec("insights", "GET", "/events", description="Directory Insights events"),
    "raw_organizations": OperationSpec("v1", "GET", "/organizations", description="Fetch organizations"),
}


class JumpCloudTool:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = JUMPCLOUD_DEFAULT_BASE_URL,
        timeout_seconds: int = 30,
        write_enabled: bool = False,
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = max(5, min(120, int(timeout_seconds)))
        self.write_enabled = bool(write_enabled)
        self._family_base = {
            "v1": f"{self.base_url}/api",
            "v2": f"{self.base_url}/api/v2",
            "insights": f"{self.base_url}/insights/directory/v1",
        }

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _assert_write(self, allow_write: bool) -> None:
        if allow_write and not self.write_enabled:
            raise JumpCloudToolError("Write operations are disabled. Set JUMPCLOUD_WRITE_ENABLED=true.")

    def _family_url(self, family: str) -> str:
        key = family.strip().lower()
        if key not in self._family_base:
            raise JumpCloudToolError(f"Unsupported api family: {family}. Use one of: v1, v2, insights.")
        return self._family_base[key]

    def _request(
        self,
        *,
        family: str,
        method: str,
        path: str,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.enabled:
            raise JumpCloudToolError("JumpCloud tool is not configured. Missing JUMPCLOUD_API_KEY.")

        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self._family_url(family)}{normalized_path}"
        if query:
            encoded = parse.urlencode({k: v for k, v in query.items() if v is not None}, doseq=True)
            if encoded:
                url = f"{url}?{encoded}"

        payload = None
        headers = {
            "x-api-key": self.api_key,
            "Accept": "application/json",
        }
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = request.Request(url=url, method=method.upper(), headers=headers, data=payload)
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8", errors="replace")
                if not raw:
                    parsed = None
                else:
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        parsed = raw
                return {
                    "ok": True,
                    "status": response.status,
                    "method": method.upper(),
                    "url": url,
                    "data": parsed,
                }
        except error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            try:
                parsed_error: Any = json.loads(err_body) if err_body else None
            except json.JSONDecodeError:
                parsed_error = err_body
            return {
                "ok": False,
                "status": exc.code,
                "method": method.upper(),
                "url": url,
                "error": parsed_error,
            }
        except error.URLError as exc:
            raise JumpCloudToolError(f"JumpCloud request failed: {exc.reason}") from exc

    def jumpcloud_list_operations(self) -> dict[str, Any]:
        """List built-in JumpCloud operations exposed by this tool."""
        return {
            "operations": {
                name: {
                    "family": spec.family,
                    "method": spec.method,
                    "path": spec.path,
                    "write": spec.write,
                    "description": spec.description,
                }
                for name, spec in OPERATION_CATALOG.items()
            }
        }

    def jumpcloud_execute(
        self,
        operation: str,
        params_json: str = "{}",
        query_json: str = "{}",
        body_json: str = "{}",
        allow_write: bool = False,
    ) -> dict[str, Any]:
        """Execute a named JumpCloud operation from the operation catalog."""
        op = operation.strip()
        if op not in OPERATION_CATALOG:
            raise JumpCloudToolError(f"Unknown operation: {op}")
        spec = OPERATION_CATALOG[op]
        requires_write = bool(spec.write and spec.method.upper() != "GET")
        self._assert_write(bool(allow_write) and requires_write)
        if requires_write and not allow_write:
            raise JumpCloudToolError("Operation requires allow_write=true.")

        params = _parse_json_or_empty(params_json)
        query = _parse_json_or_empty(query_json)
        body = _parse_json_or_empty(body_json)
        path = spec.path.format(**params)

        body_payload = None if spec.method.upper() in {"GET", "DELETE"} and not body else body
        return self._request(family=spec.family, method=spec.method, path=path, query=query, body=body_payload)

    def jumpcloud_raw_request(
        self,
        api_family: str,
        method: str,
        path: str,
        query_json: str = "{}",
        body_json: str = "{}",
        allow_write: bool = False,
    ) -> dict[str, Any]:
        """Execute any JumpCloud API endpoint path (v1, v2, insights)."""
        normalized_method = method.strip().upper()
        is_write = normalized_method not in {"GET", "HEAD", "OPTIONS"}
        if is_write:
            self._assert_write(bool(allow_write))
            if not allow_write:
                raise JumpCloudToolError("Write raw requests require allow_write=true.")
        query = _parse_json_or_empty(query_json)
        body = _parse_json_or_empty(body_json)
        body_payload = None if normalized_method in {"GET", "DELETE"} and not body else body
        return self._request(
            family=api_family,
            method=normalized_method,
            path=path,
            query=query,
            body=body_payload,
        )

    def jumpcloud_directory_events(
        self,
        start_time: str = "",
        end_time: str = "",
        limit: int = 100,
        search_after: str = "",
    ) -> dict[str, Any]:
        """Query Directory Insights events with common pagination/time filters."""
        query: dict[str, Any] = {"limit": max(1, min(1000, int(limit)))}
        if start_time.strip():
            query["start_time"] = start_time.strip()
        if end_time.strip():
            query["end_time"] = end_time.strip()
        if search_after.strip():
            query["search_after"] = search_after.strip()
        return self._request(family="insights", method="GET", path="/events", query=query, body=None)

    def agno_tools(self) -> list[Any]:
        return [
            self.jumpcloud_list_operations,
            self.jumpcloud_execute,
            self.jumpcloud_raw_request,
            self.jumpcloud_directory_events,
        ]


def build_jumpcloud_tool_from_env() -> JumpCloudTool | None:
    enabled = os.getenv("JUMPCLOUD_TOOL_ENABLED", "false").strip().lower() == "true"
    api_key = os.getenv("JUMPCLOUD_API_KEY", "").strip()
    if not enabled or not api_key:
        return None
    base_url = os.getenv("JUMPCLOUD_BASE_URL", JUMPCLOUD_DEFAULT_BASE_URL).strip() or JUMPCLOUD_DEFAULT_BASE_URL
    timeout = int(os.getenv("JUMPCLOUD_TIMEOUT_SECONDS", "30"))
    write_enabled = os.getenv("JUMPCLOUD_WRITE_ENABLED", "false").strip().lower() == "true"
    return JumpCloudTool(
        api_key=api_key,
        base_url=base_url,
        timeout_seconds=timeout,
        write_enabled=write_enabled,
    )
