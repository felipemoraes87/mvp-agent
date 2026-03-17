from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, parse, request

from secret_env import read_env_value


class JumpCloudToolError(RuntimeError):
    pass


USER_BASE_PATH = "/systemusers"
USER_BY_ID_PATH = f"{USER_BASE_PATH}" + "/{user_id}"
USER_GROUP_BY_ID_PATH = "/usergroups/{group_id}"
SYSTEM_GROUP_BY_ID_PATH = "/systemgroups/{group_id}"
JUMPCLOUD_DEFAULT_BASE_URL = "https://console.jumpcloud.com"
JUMPCLOUD_DEFAULT_INSIGHTS_BASE_URL = "https://api.jumpcloud.com"
JUMPCLOUD_DEFAULT_OAUTH_SCOPES = "api"
JUMPCLOUD_DEFAULT_TOKEN_URL = "https://admin-oauth.id.jumpcloud.com/oauth2/token"
JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_SERVICE = "all"
JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_LOOKBACK_HOURS = 24


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


def _normalize_base_origin(url: str) -> tuple[str, str]:
    parsed = parse.urlparse(url)
    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").lower()
    if scheme != "https" or not hostname:
        raise JumpCloudToolError("JumpCloud base URL must use https and include a valid hostname.")
    return scheme, hostname


@dataclass(frozen=True)
class OperationSpec:
    family: str
    method: str
    path: str
    write: bool = False
    description: str = ""


OPERATION_CATALOG: dict[str, OperationSpec] = {
    "list_users": OperationSpec("v1", "GET", USER_BASE_PATH, description="List users"),
    "get_user": OperationSpec("v1", "GET", USER_BY_ID_PATH, description="Get user by id"),
    "create_user": OperationSpec("v1", "POST", USER_BASE_PATH, write=True, description="Create user"),
    "replace_user": OperationSpec("v1", "PUT", USER_BY_ID_PATH, write=True, description="Replace user"),
    "patch_user": OperationSpec("v1", "PATCH", USER_BY_ID_PATH, write=True, description="Patch user"),
    "delete_user": OperationSpec("v1", "DELETE", USER_BY_ID_PATH, write=True, description="Delete user"),
    "list_systems": OperationSpec("v1", "GET", "/systems", description="List systems/devices"),
    "get_system": OperationSpec("v1", "GET", "/systems/{system_id}", description="Get system by id"),
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
    "list_directory_events": OperationSpec("insights", "POST", "/events", description="Directory Insights events"),
    "raw_organizations": OperationSpec("v1", "GET", "/organizations", description="Fetch organizations"),
}


class JumpCloudTool:
    def __init__(
        self,
        api_key: str = "",
        *,
        client_id: str = "",
        client_secret: str = "",
        base_url: str = JUMPCLOUD_DEFAULT_BASE_URL,
        timeout_seconds: int = 30,
        write_enabled: bool = False,
    ) -> None:
        self.api_key = api_key.strip()
        self.client_id = client_id.strip()
        self.client_secret = client_secret.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = max(5, min(120, int(timeout_seconds)))
        self.write_enabled = bool(write_enabled)
        self._base_scheme, self._base_hostname = _normalize_base_origin(self.base_url)
        insights_base_url = (
            read_env_value("JUMPCLOUD_INSIGHTS_BASE_URL", default=JUMPCLOUD_DEFAULT_INSIGHTS_BASE_URL)
            or JUMPCLOUD_DEFAULT_INSIGHTS_BASE_URL
        ).strip() or JUMPCLOUD_DEFAULT_INSIGHTS_BASE_URL
        self._insights_base_url = insights_base_url.rstrip("/")
        self._insights_scheme, self._insights_hostname = _normalize_base_origin(self._insights_base_url)
        self._oauth_scopes = (read_env_value("JUMPCLOUD_OAUTH_SCOPES", default=JUMPCLOUD_DEFAULT_OAUTH_SCOPES) or JUMPCLOUD_DEFAULT_OAUTH_SCOPES).strip()
        self._token_url = (read_env_value("JUMPCLOUD_TOKEN_URL", default=JUMPCLOUD_DEFAULT_TOKEN_URL) or JUMPCLOUD_DEFAULT_TOKEN_URL).strip()
        self._default_directory_service = (
            read_env_value("JUMPCLOUD_DIRECTORY_EVENTS_SERVICE", default=JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_SERVICE)
            or JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_SERVICE
        ).strip()
        self._default_directory_lookback_hours = max(
            1,
            int(
                read_env_value(
                    "JUMPCLOUD_DIRECTORY_EVENTS_LOOKBACK_HOURS",
                    default=str(JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_LOOKBACK_HOURS),
                )
                or str(JUMPCLOUD_DEFAULT_DIRECTORY_EVENTS_LOOKBACK_HOURS)
            ),
        )
        self._cached_access_token = ""
        self._cached_access_token_expiry = 0.0
        self._cached_org_id = ""
        self._family_base = {
            "v1": f"{self.base_url}/api",
            "v2": f"{self.base_url}/api/v2",
            "insights": f"{self._insights_base_url}/insights/directory/v1",
        }
        self._family_origin = {
            "v1": (self._base_scheme, self._base_hostname),
            "v2": (self._base_scheme, self._base_hostname),
            "insights": (self._insights_scheme, self._insights_hostname),
        }

    @property
    def enabled(self) -> bool:
        return bool(self.api_key) or (bool(self.client_id) and bool(self.client_secret))

    @property
    def auth_mode(self) -> str:
        if self.api_key:
            return "api_key"
        if self.client_id and self.client_secret:
            return "oauth_client_credentials"
        return "disabled"

    def _assert_write(self, allow_write: bool) -> None:
        if allow_write and not self.write_enabled:
            raise JumpCloudToolError("Write operations are disabled. Set JUMPCLOUD_WRITE_ENABLED=true.")

    def _family_url(self, family: str) -> str:
        key = family.strip().lower()
        if key not in self._family_base:
            raise JumpCloudToolError(f"Unsupported api family: {family}. Use one of: v1, v2, insights.")
        return self._family_base[key]

    def _validate_request_url(self, family: str, url: str) -> None:
        parsed_url = parse.urlparse(url)
        scheme = (parsed_url.scheme or "").lower()
        hostname = (parsed_url.hostname or "").lower()
        expected_scheme, expected_hostname = self._family_origin[family]
        if scheme != expected_scheme:
            raise JumpCloudToolError("JumpCloud request blocked: invalid URL scheme.")
        if hostname != expected_hostname:
            raise JumpCloudToolError("JumpCloud request blocked: hostname mismatch.")

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
            raise JumpCloudToolError(
                "JumpCloud tool is not configured. Provide JUMPCLOUD_API_KEY or JUMPCLOUD_CLIENT_ID/JUMPCLOUD_CLIENT_SECRET."
            )

        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self._family_url(family)}{normalized_path}"
        if query:
            encoded = parse.urlencode({k: v for k, v in query.items() if v is not None}, doseq=True)
            if encoded:
                url = f"{url}?{encoded}"
        self._validate_request_url(family, url)

        payload = None
        headers = {
            "Accept": "application/json",
        }
        if self.auth_mode == "api_key":
            headers["x-api-key"] = self.api_key
        elif self.auth_mode == "oauth_client_credentials":
            headers["Authorization"] = f"Bearer {self._get_access_token()}"
            org_id = self._get_org_id()
            if org_id:
                headers["x-org-id"] = org_id
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = request.Request(url=url, method=method.upper(), headers=headers, data=payload)
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
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

    def _get_access_token(self) -> str:
        if self.auth_mode != "oauth_client_credentials":
            raise JumpCloudToolError("OAuth token requested, but JumpCloud OAuth client credentials are not configured.")

        now = time.time()
        if self._cached_access_token and now < (self._cached_access_token_expiry - 60):
            return self._cached_access_token

        token_url = self._token_url
        basic_auth = f"{self.client_id}:{self.client_secret}"
        basic_auth_header = base64.b64encode(basic_auth.encode("utf-8")).decode("ascii")
        payload = parse.urlencode(
            {
                "grant_type": "client_credentials",
                "scope": self._oauth_scopes,
            }
        ).encode("utf-8")
        req = request.Request(
            url=token_url,
            method="POST",
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "Authorization": f"Basic {basic_auth_header}",
            },
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise JumpCloudToolError(f"JumpCloud OAuth token request failed with status {exc.code}: {err_body}") from exc
        except error.URLError as exc:
            raise JumpCloudToolError(f"JumpCloud OAuth token request failed: {exc.reason}") from exc

        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError as exc:
            raise JumpCloudToolError(f"JumpCloud OAuth token response was not valid JSON: {exc}") from exc

        access_token = str(parsed.get("access_token", "")).strip()
        if not access_token:
            raise JumpCloudToolError("JumpCloud OAuth token response did not include access_token.")
        expires_in = int(parsed.get("expires_in", 300) or 300)
        self._cached_access_token = access_token
        self._cached_access_token_expiry = now + max(60, expires_in)
        return access_token

    def _get_org_id(self) -> str:
        if self.auth_mode != "oauth_client_credentials":
            return ""
        if self._cached_org_id:
            return self._cached_org_id

        url = f"{self._family_base['v1']}{USER_BASE_PATH}?limit=1"
        self._validate_request_url("v1", url)
        req = request.Request(
            url=url,
            method="GET",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self._get_access_token()}",
            },
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise JumpCloudToolError(f"JumpCloud org lookup failed with status {exc.code}: {err_body}") from exc
        except error.URLError as exc:
            raise JumpCloudToolError(f"JumpCloud org lookup failed: {exc.reason}") from exc

        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError as exc:
            raise JumpCloudToolError(f"JumpCloud org lookup response was not valid JSON: {exc}") from exc

        results = parsed.get("results") if isinstance(parsed, dict) else None
        if isinstance(results, list) and results:
            org_id = str(results[0].get("organization", "")).strip()
            if org_id:
                self._cached_org_id = org_id
                return org_id
        raise JumpCloudToolError("JumpCloud org lookup did not return an organization id.")

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
        if op == "list_directory_events":
            service = str(query.get("service", "") or body.get("service", "")).strip()
            start_time = str(query.get("start_time", "") or body.get("start_time", "")).strip()
            end_time = str(query.get("end_time", "") or body.get("end_time", "")).strip()
            search_after = str(query.get("search_after", "") or body.get("search_after", "")).strip()
            limit_value = query.get("limit", body.get("limit", 100))
            return self.jumpcloud_directory_events(
                service=service,
                start_time=start_time,
                end_time=end_time,
                limit=int(limit_value or 100),
                search_after=search_after,
            )
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
        service: str = "",
        start_time: str = "",
        end_time: str = "",
        limit: int = 100,
        search_after: str = "",
    ) -> dict[str, Any]:
        """Query Directory Insights events with common pagination/time filters."""
        requested_service = service.strip() or self._default_directory_service
        if not requested_service:
            raise JumpCloudToolError(
                "Directory Insights requires a service value. Set the service parameter or JUMPCLOUD_DIRECTORY_EVENTS_SERVICE."
            )
        effective_start_time = start_time.strip()
        if not effective_start_time:
            effective_start_time = (
                datetime.now(timezone.utc) - timedelta(hours=self._default_directory_lookback_hours)
            ).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        body: dict[str, Any] = {
            "service": [requested_service],
            "start_time": effective_start_time,
            "limit": max(1, min(1000, int(limit))),
        }
        if end_time.strip():
            body["end_time"] = end_time.strip()
        if search_after.strip():
            body["search_after"] = search_after.strip()
        return self._request(family="insights", method="POST", path="/events", query=None, body=body)

    def agno_tools(self) -> list[Any]:
        return [
            self.jumpcloud_list_operations,
            self.jumpcloud_execute,
            self.jumpcloud_raw_request,
            self.jumpcloud_directory_events,
        ]


def build_jumpcloud_tool_from_env() -> JumpCloudTool | None:
    enabled = (read_env_value("JUMPCLOUD_TOOL_ENABLED", default="false") or "false").strip().lower() == "true"
    api_key = (read_env_value("JUMPCLOUD_API_KEY") or "").strip()
    client_id = (read_env_value("JUMPCLOUD_CLIENT_ID") or "").strip()
    client_secret = (read_env_value("JUMPCLOUD_CLIENT_SECRET") or "").strip()
    if not enabled or (not api_key and not (client_id and client_secret)):
        return None
    base_url = (read_env_value("JUMPCLOUD_BASE_URL", default=JUMPCLOUD_DEFAULT_BASE_URL) or JUMPCLOUD_DEFAULT_BASE_URL).strip() or JUMPCLOUD_DEFAULT_BASE_URL
    timeout = int(read_env_value("JUMPCLOUD_TIMEOUT_SECONDS", default="30") or "30")
    write_enabled = (read_env_value("JUMPCLOUD_WRITE_ENABLED", default="false") or "false").strip().lower() == "true"
    return JumpCloudTool(
        api_key=api_key,
        client_id=client_id,
        client_secret=client_secret,
        base_url=base_url,
        timeout_seconds=timeout,
        write_enabled=write_enabled,
    )
