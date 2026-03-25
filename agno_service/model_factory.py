from __future__ import annotations

import inspect
import json
import urllib.request
from pathlib import Path
from typing import Any

from agno.agent import Agent
from agno.models.ollama import Ollama
from agno.models.openai import OpenAIChat

from models import AdvancedOptions
from secret_env import read_env_value

APP_DIR = Path(__file__).resolve().parent


def resolve_provider(advanced: AdvancedOptions | None) -> str:
    provider = (
        (advanced.modelProvider if advanced and advanced.modelProvider else None)
        or read_env_value("AGNO_MODEL_PROVIDER", default="ollama")
    ).strip().lower()
    if provider == "openai":
        return "openrouter"
    return provider if provider in {"ollama", "openrouter", "vertexai"} else "ollama"


def resolve_model_id(provider: str, advanced: AdvancedOptions | None) -> str:
    if advanced and advanced.modelId:
        return advanced.modelId
    if provider == "openrouter":
        return read_env_value("AGNO_OPENROUTER_MODEL", "AGNO_OPENAI_MODEL", default="openai/gpt-4o-mini")
    if provider == "vertexai":
        return read_env_value("AGNO_VERTEX_MODEL", default="gemini-2.5-flash")
    return read_env_value("AGNO_OLLAMA_MODEL", default="qwen2.5:3b")


def find_vertex_credentials_path() -> Path | None:
    candidates = [
        read_env_value("VERTEX_AI_CREDENTIALS_PATH"),
        read_env_value("GOOGLE_APPLICATION_CREDENTIALS"),
        read_env_value("GOOGLE_SERVICE_ACCOUNT_JSON"),
    ]
    for candidate in candidates:
        if candidate:
            path = Path(candidate).expanduser()
            if path.is_file():
                return path

    preferred_names = (
        "*vertex*.json",
        "*google*.json",
        "*gcp*.json",
        "*service*.json",
        "*.json",
    )
    for pattern in preferred_names:
        matches = sorted(path for path in APP_DIR.glob(pattern) if path.is_file())
        if matches:
            return matches[0]
    return None


def load_vertex_credentials() -> tuple[Any | None, str | None, Path | None]:
    credentials_path = find_vertex_credentials_path()
    if not credentials_path:
        return None, read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID"), None

    try:
        from google.oauth2.service_account import Credentials
    except ImportError as exc:
        raise RuntimeError("google-auth is required when modelProvider=vertexai") from exc

    credentials = Credentials.from_service_account_file(
        str(credentials_path),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project_id = (
        read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID")
        or getattr(credentials, "project_id", None)
    )
    return credentials, project_id, credentials_path


def make_model(advanced: AdvancedOptions | None) -> Any:
    import logging
    logger = logging.getLogger("agno_service")

    provider = resolve_provider(advanced)
    model_id = resolve_model_id(provider, advanced)

    if provider == "openrouter":
        openrouter_key = read_env_value("OPENROUTER_API_KEY", "OPENAI_API_KEY").strip()
        if not openrouter_key:
            raise RuntimeError("OPENROUTER_API_KEY is required when modelProvider=openrouter")

        raw_kwargs: dict[str, Any] = {
            "id": model_id,
            "api_key": openrouter_key,
            "base_url": read_env_value("OPENROUTER_BASE_URL", "OPENAI_BASE_URL", default="https://openrouter.ai/api/v1"),
            "extra_headers": {
                "HTTP-Referer": read_env_value("OPENROUTER_HTTP_REFERER", default="http://localhost:5173"),
                "X-Title": read_env_value("OPENROUTER_APP_TITLE", default="MVP Agent"),
            },
            "temperature": float(advanced.temperature) if advanced and advanced.temperature is not None else None,
            "max_tokens": int(advanced.maxTokens) if advanced and advanced.maxTokens is not None else None,
        }
        supported = set(inspect.signature(OpenAIChat.__init__).parameters.keys())
        kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
        return OpenAIChat(**kwargs)

    if provider == "vertexai":
        try:
            from agno.models.google import Gemini
        except ImportError as exc:
            raise RuntimeError("google-genai is required when modelProvider=vertexai") from exc

        credentials, project_id, credentials_path = load_vertex_credentials()
        if not project_id:
            raise RuntimeError(
                "GOOGLE_CLOUD_PROJECT or a service-account JSON with project_id is required when modelProvider=vertexai"
            )

        location = read_env_value("GOOGLE_CLOUD_LOCATION", "VERTEX_AI_LOCATION", default="us-central1")
        raw_kwargs = {
            "id": model_id,
            "vertexai": True,
            "project_id": project_id,
            "location": location,
            "credentials": credentials,
            "temperature": float(advanced.temperature) if advanced and advanced.temperature is not None else None,
            "max_output_tokens": int(advanced.maxTokens) if advanced and advanced.maxTokens is not None else None,
        }
        supported = set(inspect.signature(Gemini.__init__).parameters.keys())
        kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
        if credentials_path:
            logger.info("vertex_credentials_loaded", extra={"path": str(credentials_path)})
        return Gemini(**kwargs)

    ollama_host = read_env_value("AGNO_OLLAMA_HOST", "OLLAMA_HOST")
    options: dict[str, Any] = {}
    if advanced and advanced.temperature is not None:
        options["temperature"] = float(advanced.temperature)
    if advanced and advanced.maxTokens is not None:
        options["num_predict"] = int(advanced.maxTokens)

    raw_kwargs = {
        "id": model_id,
        "host": ollama_host,
        "options": options or None,
    }
    supported = set(inspect.signature(Ollama.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
    return Ollama(**kwargs)


def build_agent_instance(
    *,
    name: str,
    instructions: list[str],
    advanced: AdvancedOptions | None,
    tools: list[Any],
    overrides: dict[str, Any] | None = None,
) -> Agent:
    raw_kwargs = {
        "name": name,
        "model": make_model(advanced),
        "instructions": instructions,
        "tools": tools,
        "markdown": bool(advanced.markdown) if advanced else True,
        "show_tool_calls": bool(advanced.showToolCalls) if advanced else False,
        "add_history_to_context": bool(advanced.addHistoryToContext) if advanced else True,
        "num_history_sessions": int(advanced.historySessions) if advanced and advanced.historySessions else 3,
        "add_session_state_to_context": bool(advanced.addStateToContext) if advanced else True,
        "reasoning": bool(advanced.reasoning) if advanced else True,
        "reasoning_min_steps": int(advanced.reasoningMinSteps) if advanced and advanced.reasoningMinSteps else 1,
        "reasoning_max_steps": int(advanced.reasoningMaxSteps) if advanced and advanced.reasoningMaxSteps else 6,
    }
    if overrides:
        raw_kwargs.update(overrides)

    supported = set(inspect.signature(Agent.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported}
    return Agent(**kwargs)


def fetch_ollama_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_OLLAMA_MODEL", default="qwen2.5:3b")
    host = (read_env_value("AGNO_OLLAMA_HOST", "OLLAMA_HOST", default="http://localhost:11434")).rstrip("/")
    url = f"{host}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        models = payload.get("models") if isinstance(payload, dict) else []
        model_ids = [item.get("name") for item in models if isinstance(item, dict) and isinstance(item.get("name"), str)]
        unique_ids = sorted({model_id.strip() for model_id in model_ids if model_id and model_id.strip()})
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids or [default_model], "runtime"
    except Exception:
        return [default_model], "fallback"


def fetch_openrouter_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_OPENROUTER_MODEL", "AGNO_OPENAI_MODEL", default="openai/gpt-4o-mini")
    fallback_models = [
        default_model,
        "openai/gpt-4.1-mini",
        "anthropic/claude-3.5-haiku",
        "google/gemini-2.0-flash-001",
    ]
    api_key = read_env_value("OPENROUTER_API_KEY", "OPENAI_API_KEY").strip()
    if not api_key:
        return fallback_models, "fallback"

    base_url = read_env_value("OPENROUTER_BASE_URL", "OPENAI_BASE_URL", default="https://openrouter.ai/api/v1").rstrip("/")
    url = f"{base_url}/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": read_env_value("OPENROUTER_HTTP_REFERER", default="http://localhost:5173"),
            "X-Title": read_env_value("OPENROUTER_APP_TITLE", default="MVP Agent"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data") if isinstance(payload, dict) else []
        model_ids = [item.get("id") for item in data if isinstance(item, dict) and isinstance(item.get("id"), str)]
        preferred_prefixes = ("openai/", "anthropic/", "google/", "meta-llama/")
        preferred = [model_id for model_id in model_ids if model_id.startswith(preferred_prefixes)]
        unique_ids = sorted({model_id.strip() for model_id in preferred if model_id and model_id.strip()})
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids[:25] or [default_model], "runtime"
    except Exception:
        return fallback_models, "fallback"


def fetch_vertex_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_VERTEX_MODEL", default="gemini-2.5-flash")
    fallback_models = [default_model, "gemini-2.5-pro", "gemini-2.0-flash"]
    try:
        from google import genai
    except ImportError:
        return fallback_models, "fallback"

    try:
        credentials, project_id, _ = load_vertex_credentials()
        project = project_id or read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID")
        location = read_env_value("GOOGLE_CLOUD_LOCATION", "VERTEX_AI_LOCATION", default="us-central1")
        if not project:
            return fallback_models, "fallback"
        client_kwargs: dict[str, Any] = {
            "vertexai": True,
            "project": project,
            "location": location,
        }
        if credentials is not None:
            client_kwargs["credentials"] = credentials
        client = genai.Client(**client_kwargs)
        models = client.models.list()
        model_ids: list[str] = []
        for model in models:
            model_name = getattr(model, "name", None) or getattr(model, "display_name", None)
            if not isinstance(model_name, str):
                continue
            normalized = model_name.split("/")[-1].strip()
            if normalized.startswith("gemini"):
                model_ids.append(normalized)
        unique_ids = sorted(set(model_ids))
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids[:25] or fallback_models, "runtime"
    except Exception:
        return fallback_models, "fallback"
