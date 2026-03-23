from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

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


class IntegrationConfigRegistry:
    def __init__(self) -> None:
        self._definitions = {
            definition.key: definition
            for definition in [
                IntegrationDefinition(
                    key="jumpcloud",
                    label="JumpCloud",
                    description="Directory, grupos, dispositivos e eventos de autenticacao.",
                    scopes=("users:read", "groups:read", "systems:read", "insights:read"),
                    requirements=(
                        CredentialRequirement("base_url", "Base URL", "Base URL da API do JumpCloud.", ("JUMPCLOUD_BASE_URL",), example="https://console.jumpcloud.com"),
                        CredentialRequirement("api_key", "API Key", "API key com acesso somente leitura ao JumpCloud.", ("JUMPCLOUD_API_KEY",), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="github",
                    label="GitHub",
                    description="Repositorios IAM/GCP, manifests, PRs e historico.",
                    scopes=("contents:read", "pull_requests:read"),
                    requirements=(
                        CredentialRequirement("base_url", "Base URL", "URL da API GitHub ou GitHub Enterprise.", ("GITHUB_BASE_URL",), example="https://api.github.com"),
                        CredentialRequirement("token", "Token", "Token de acesso com leitura em repositorios e pull requests.", ("GITHUB_PAT", "GITHUB_TOKEN"), secret=True),
                        CredentialRequirement("repository", "Repositorio", "Repositorio principal que concentra roles e mappings.", ("IAM_GITHUB_REPOSITORY",), example="org/repo-iam"),
                    ),
                ),
                IntegrationDefinition(
                    key="iga",
                    label="IGA",
                    description="API, webhooks ou backend de governanca de identidades.",
                    scopes=("requests:read", "roles:read", "approvals:read"),
                    supports_write=True,
                    requirements=(
                        CredentialRequirement("base_url", "Base URL", "Endpoint base do IGA ou gateway n8n.", ("IGA_BASE_URL", "IGA_WEBHOOK_BASE_URL"), example="https://iga.example/api"),
                        CredentialRequirement("token", "Token", "Token ou chave para consultar o IGA.", ("IGA_API_TOKEN", "IGA_WEBHOOK_TOKEN"), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="bigquery",
                    label="BigQuery",
                    description="Consultas analiticas e correlacao de eventos de IAM/Sec.",
                    scopes=("bigquery.jobs.create", "bigquery.tables.getData"),
                    supports_write=True,
                    requirements=(
                        CredentialRequirement("project_id", "Project ID", "Projeto GCP onde as consultas serao executadas.", ("BIGQUERY_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"), example="company-sec-prd"),
                        CredentialRequirement("dataset", "Dataset", "Dataset principal com tabelas de IAM/Security.", ("BIGQUERY_DATASET",), example="iam_security"),
                        CredentialRequirement("credentials", "Credentials JSON/Path", "Arquivo de service account ou JSON inline.", ("GOOGLE_APPLICATION_CREDENTIALS", "BIGQUERY_CREDENTIALS_JSON"), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="jira",
                    label="Jira",
                    description="Tickets, filas, requests e mudancas relacionadas a IAM.",
                    scopes=("read:jira-work",),
                    requirements=(
                        CredentialRequirement("base_url", "Base URL", "URL base da instancia Jira.", ("JIRA_BASE_URL",), example="https://company.atlassian.net"),
                        CredentialRequirement("username", "Username/Email", "Usuario tecnico ou email da integracao Jira.", ("JIRA_USERNAME", "JIRA_EMAIL"), example="iam-bot@company.com"),
                        CredentialRequirement("token", "API Token", "Token de API para leitura de tickets e filas.", ("JIRA_API_TOKEN",), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="confluence",
                    label="Confluence",
                    description="Documentacao operacional, runbooks e procedimentos.",
                    scopes=("read:confluence-content",),
                    requirements=(
                        CredentialRequirement("base_url", "Base URL", "URL base do Confluence.", ("CONFLUENCE_BASE_URL",), example="https://company.atlassian.net/wiki"),
                        CredentialRequirement("username", "Username/Email", "Usuario tecnico ou email da integracao Confluence.", ("CONFLUENCE_USERNAME", "CONFLUENCE_EMAIL"), example="iam-bot@company.com"),
                        CredentialRequirement("token", "API Token", "Token de API com acesso de leitura.", ("CONFLUENCE_API_TOKEN",), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="slack",
                    label="Slack",
                    description="Contexto operacional recente em canais e discussoes.",
                    scopes=("channels:history", "search:read"),
                    requirements=(
                        CredentialRequirement("bot_token", "Bot Token", "Token do bot do Slack para leitura de canais autorizados.", ("SLACK_BOT_TOKEN",), secret=True),
                        CredentialRequirement("workspace", "Workspace", "Workspace ou dominio principal do Slack.", ("SLACK_WORKSPACE",), example="company.slack.com"),
                    ),
                ),
                IntegrationDefinition(
                    key="google_drive",
                    label="Google Drive/Docs",
                    description="Leitura complementar de documentos operacionais fora do Confluence.",
                    scopes=("drive.readonly", "documents.readonly"),
                    requirements=(
                        CredentialRequirement("credentials", "Credentials JSON/Path", "Credenciais Google para leitura de Drive e Docs.", ("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_DRIVE_CREDENTIALS_JSON"), secret=True),
                        CredentialRequirement("shared_drive", "Shared Drive/Folder", "Drive, pasta ou escopo principal de documentos.", ("GOOGLE_DRIVE_SHARED_DRIVE", "GOOGLE_DRIVE_FOLDER_ID"), example="iam-ops-drive"),
                    ),
                ),
                IntegrationDefinition(
                    key="gcp_asset",
                    label="GCP Asset Inventory",
                    description="Inventario de recursos e politicas IAM no GCP.",
                    scopes=("cloudasset.assets.searchAllResources", "cloudasset.assets.searchAllIamPolicies"),
                    requirements=(
                        CredentialRequirement("project_id", "Project ID", "Projeto principal ou organizacao alvo.", ("GOOGLE_CLOUD_PROJECT", "GCP_ASSET_PROJECT_ID"), example="company-sec-prd"),
                        CredentialRequirement("credentials", "Credentials JSON/Path", "Credenciais para consultar Asset Inventory.", ("GOOGLE_APPLICATION_CREDENTIALS", "GCP_ASSET_CREDENTIALS_JSON"), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="cloud_logging",
                    label="GCP Cloud Logging",
                    description="Logs operacionais e de seguranca no GCP para investigacoes IAM.",
                    scopes=("logging.read",),
                    requirements=(
                        CredentialRequirement("project_id", "Project ID", "Projeto principal dos logs.", ("GOOGLE_CLOUD_PROJECT", "CLOUD_LOGGING_PROJECT_ID"), example="company-sec-prd"),
                        CredentialRequirement("credentials", "Credentials JSON/Path", "Credenciais para leitura de logs.", ("GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_LOGGING_CREDENTIALS_JSON"), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="iam_analyzer",
                    label="GCP IAM Analyzer",
                    description="Analise adicional de bindings e impacto no IAM do GCP.",
                    scopes=("cloudasset.analyzeIamPolicy",),
                    requirements=(
                        CredentialRequirement("project_id", "Project ID", "Projeto ou organizacao de referencia para analise IAM.", ("GOOGLE_CLOUD_PROJECT", "IAM_ANALYZER_PROJECT_ID"), example="company-sec-prd"),
                        CredentialRequirement("credentials", "Credentials JSON/Path", "Credenciais para IAM Analyzer.", ("GOOGLE_APPLICATION_CREDENTIALS", "IAM_ANALYZER_CREDENTIALS_JSON"), secret=True),
                    ),
                ),
                IntegrationDefinition(
                    key="findings_store",
                    label="Findings Store",
                    description="Armazenamento estruturado de findings e memoria investigativa.",
                    scopes=("findings:write", "findings:read"),
                    supports_write=True,
                    requirements=(
                        CredentialRequirement("storage_path", "Storage Path", "Diretorio ou backend para persistencia de findings.", ("IAM_FINDINGS_STORE_PATH",), example="./agno_service/runtime"),
                    ),
                ),
            ]
        }

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
