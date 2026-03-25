from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import yaml
from pathlib import Path

from secret_env import read_env_value

from .schemas import IntegrationRequirement, MissingConfiguration


@dataclass(frozen=True)
class CredentialRequirement:
    key: str
    label: str
    description: str
    env_names: tuple[str, ...]
    secret: bool = False
    example: str | None = None


@dataclass(frozen=True)
class IntegrationDefinition:
    key: str
    label: str
    description: str
    scopes: tuple[str, ...] = ()
    supports_write: bool = False
    runtime_available: bool = False
    requirements: tuple[CredentialRequirement, ...] = ()

    def to_requirement(self, *, required_for: list[str] | None = None) -> IntegrationRequirement:
        return IntegrationRequirement(
            key=self.key,
            label=self.label,
            description=self.description,
            required_for=required_for or [],
            scopes=list(self.scopes),
            supports_write=self.supports_write,
        )


@dataclass
class IntegrationSetupState:
    integration_key: str
    present_fields: dict[str, bool] = field(default_factory=dict)
    missing_fields: list[MissingConfiguration] = field(default_factory=list)


class SecretResolver:
    @staticmethod
    def resolve_from_env(env_names: tuple[str, ...]) -> str | None:
        for env_name in env_names:
            value = read_env_value(env_name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None


def _load_integrations() -> dict[str, IntegrationDefinition]:
    integrations_dir = Path(__file__).parent.parent / "config" / "integrations"
    definitions: dict[str, IntegrationDefinition] = {}
    for yaml_file in sorted(integrations_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                item = yaml.safe_load(f)
        except yaml.YAMLError as exc:
            raise RuntimeError(f"YAML invalido em {yaml_file}: {exc}")
        if not isinstance(item, dict):
            raise RuntimeError(f"Entrada de integracao invalida (esperado dict) em {yaml_file}")
        key = item.get("key")
        if not key:
            raise RuntimeError(f"Integracao sem campo 'key' em {yaml_file}")

        credentials = tuple(
            CredentialRequirement(
                key=cred["key"],
                label=cred["label"],
                description=cred["description"],
                env_names=tuple(cred.get("env_names") or []),
                secret=bool(cred.get("secret", False)),
                example=cred.get("example"),
            )
            for cred in (item.get("credentials") or [])
            if isinstance(cred, dict) and cred.get("key")
        )

        definitions[key] = IntegrationDefinition(
            key=key,
            label=item.get("label", key),
            description=item.get("description", ""),
            scopes=tuple(item.get("scopes") or []),
            supports_write=bool(item.get("supports_write", False)),
            runtime_available=bool(item.get("runtime_available", False)),
            requirements=credentials,
        )

    if not definitions:
        raise RuntimeError(f"Nenhuma integracao encontrada em {integrations_dir}")
    return definitions


class IntegrationConfigRegistry:
    def __init__(self) -> None:
        self._definitions = _load_integrations()

    def get(self, integration_key: str) -> IntegrationDefinition | None:
        return self._definitions.get(integration_key)

    def requirements_for(self, integration_keys: list[str]) -> list[IntegrationRequirement]:
        requirements: list[IntegrationRequirement] = []
        for integration_key in integration_keys:
            definition = self.get(integration_key)
            if definition is None:
                continue
            requirements.append(definition.to_requirement())
        return requirements

    def evaluate_setup_state(
        self,
        integration_key: str,
        runtime_config: dict[str, Any] | None = None,
    ) -> IntegrationSetupState:
        definition = self.get(integration_key)
        if definition is None:
            return IntegrationSetupState(integration_key=integration_key)

        runtime_values = ((runtime_config or {}).get("integrationOverrides") or {}).get(integration_key) or {}
        present_fields: dict[str, bool] = {}
        missing_fields: list[MissingConfiguration] = []
        for requirement in definition.requirements:
            resolved = runtime_values.get(requirement.key)
            if not isinstance(resolved, str) or not resolved.strip():
                resolved = SecretResolver.resolve_from_env(requirement.env_names)
            is_present = bool(isinstance(resolved, str) and resolved.strip())
            present_fields[requirement.key] = is_present
        for requirement in definition.requirements:
            if present_fields.get(requirement.key):
                continue
            remaining = [
                req.label
                for req in definition.requirements
                if req.key != requirement.key and not present_fields.get(req.key, False)
            ]
            missing_fields.append(
                MissingConfiguration(
                    integration_key=definition.key,
                    integration_label=definition.label,
                    field_key=requirement.key,
                    field_label=requirement.label,
                    description=requirement.description,
                    secret=requirement.secret,
                    example=requirement.example,
                    remaining_fields=remaining,
                )
            )
        return IntegrationSetupState(
            integration_key=integration_key,
            present_fields=present_fields,
            missing_fields=missing_fields,
        )

    def find_missing_configuration(
        self,
        integration_keys: list[str],
        runtime_config: dict[str, Any] | None = None,
    ) -> list[MissingConfiguration]:
        missing: list[MissingConfiguration] = []
        for integration_key in integration_keys:
            state = self.evaluate_setup_state(integration_key, runtime_config=runtime_config)
            missing.extend(state.missing_fields)
        return missing

    def next_missing_item(
        self,
        integration_keys: list[str],
        runtime_config: dict[str, Any] | None = None,
    ) -> MissingConfiguration | None:
        missing = self.find_missing_configuration(integration_keys, runtime_config=runtime_config)
        return missing[0] if missing else None
