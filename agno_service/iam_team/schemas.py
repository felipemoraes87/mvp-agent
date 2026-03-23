from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


IntentCategory = Literal[
    "simple_query",
    "investigation",
    "comparison",
    "troubleshooting",
    "audit",
    "operational_action",
    "access_request",
    "workflow_known",
    "ambiguous",
]

WorkflowMode = Literal["workflow", "open_investigation"]
AccessMode = Literal["read_only", "write_guarded", "write_allowed", "approval_required"]


class ToolRequirement(BaseModel):
    name: str
    integration_key: str
    access_mode: AccessMode = "read_only"
    purpose: str


class AgentCapability(BaseModel):
    agent_name: str
    role: str
    summary: str
    domains: list[str] = Field(default_factory=list)
    tools: list[ToolRequirement] = Field(default_factory=list)
    can_write: bool = False
    reuse_existing_agent: bool = False


class IntegrationRequirement(BaseModel):
    key: str
    label: str
    description: str
    required_for: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    supports_write: bool = False


class MissingConfiguration(BaseModel):
    integration_key: str
    integration_label: str
    field_key: str
    field_label: str
    description: str
    secret: bool = False
    example: str | None = None
    remaining_fields: list[str] = Field(default_factory=list)


class ExecutionStep(BaseModel):
    id: str
    title: str
    description: str
    agent_name: str
    integration_keys: list[str] = Field(default_factory=list)
    access_mode: AccessMode = "read_only"
    status: Literal["pending", "ready", "blocked", "completed"] = "pending"


class EvidenceItem(BaseModel):
    source_type: str
    source_name: str
    summary: str
    confidence: Literal["low", "medium", "high"] = "medium"
    details: dict[str, Any] = Field(default_factory=dict)


class ChangeProposal(BaseModel):
    title: str
    summary: str
    impact: str
    validations: list[str] = Field(default_factory=list)
    manual_steps: list[str] = Field(default_factory=list)
    suggested_pr: str | None = None


class DiagnosticResult(BaseModel):
    summary: str
    findings: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class UserIntent(BaseModel):
    request: str
    category: IntentCategory
    entities: list[str] = Field(default_factory=list)
    requires_write: bool = False
    confidence: float = 0.5
    rationale: list[str] = Field(default_factory=list)


class WorkflowDecision(BaseModel):
    workflow_name: str | None = None
    mode: WorkflowMode
    reason: str
    matched_keywords: list[str] = Field(default_factory=list)


class InvestigationPlan(BaseModel):
    workflow: WorkflowDecision
    participating_agents: list[str] = Field(default_factory=list)
    required_integrations: list[IntegrationRequirement] = Field(default_factory=list)
    steps: list[ExecutionStep] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    failure_handling: list[str] = Field(default_factory=list)


class FinalResponse(BaseModel):
    request_type: IntentCategory
    workflow_mode: WorkflowMode
    workflow_name: str | None = None
    summary: str
    evidence: list[EvidenceItem] = Field(default_factory=list)
    diagnostic: DiagnosticResult | None = None
    missing_configuration: list[MissingConfiguration] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    change_proposal: ChangeProposal | None = None
    knowledge_results: list["KnowledgeResult"] = Field(default_factory=list)
    entitlement_assessment: "EntitlementAssessment | None" = None
    risk_assessment: "RiskAssessment | None" = None
    guarded_action_plan: "GuardedActionPlan | None" = None
    ticket_triage: "TicketTriageResult | None" = None
    participating_agents: list[str] = Field(default_factory=list)
    plan_steps: list[ExecutionStep] = Field(default_factory=list)


class KnowledgeQuery(BaseModel):
    query: str
    intent: str
    domains: list[str] = Field(default_factory=list)
    source_hints: list[str] = Field(default_factory=list)
    limit: int = 5


class KnowledgeResult(BaseModel):
    title: str
    source_name: str
    source_type: str
    snippet: str
    reference: str | None = None
    score: float = 0.0
    tags: list[str] = Field(default_factory=list)


AccessClassification = Literal[
    "expected_access",
    "justified_exception",
    "overprivileged_access",
    "orphaned_access",
    "undocumented_access",
    "potential_sod_conflict",
    "insufficient_evidence",
]


class EntitlementAssessment(BaseModel):
    classification: AccessClassification
    summary: str
    rationale: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    access_path: list[str] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"] = "medium"
    recommended_actions: list[str] = Field(default_factory=list)


class RiskFinding(BaseModel):
    title: str
    severity: Literal["low", "medium", "high", "critical"]
    confidence: Literal["low", "medium", "high"]
    summary: str
    rationale: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    suggested_next_steps: list[str] = Field(default_factory=list)


class RiskAssessment(BaseModel):
    overall_severity: Literal["low", "medium", "high", "critical"]
    confidence: Literal["low", "medium", "high"]
    summary: str
    findings: list[RiskFinding] = Field(default_factory=list)
    hypotheses: list[str] = Field(default_factory=list)
    recommended_next_steps: list[str] = Field(default_factory=list)


class ApprovalRequirement(BaseModel):
    approval_required: bool
    approver_role: str | None = None
    reason: str
    blocking_checks: list[str] = Field(default_factory=list)


class ChangeSafetyDecision(BaseModel):
    decision: Literal["read_only", "propose_only", "approval_required", "safe_to_execute"]
    risk_summary: str
    rationale: list[str] = Field(default_factory=list)
    approval: ApprovalRequirement


class GuardedActionPlan(BaseModel):
    decision: ChangeSafetyDecision
    proposed_actions: list[str] = Field(default_factory=list)
    manual_steps: list[str] = Field(default_factory=list)
    audit_notes: list[str] = Field(default_factory=list)


class InvestigationMemoryEntry(BaseModel):
    id: str
    created_at: str
    query: str
    workflow_name: str | None = None
    participants: list[str] = Field(default_factory=list)
    findings: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


TicketRequestClassification = Literal[
    "fulfillable_access_request",
    "unclear_request",
    "not_access_request",
]


class AccessRequestContext(BaseModel):
    issue_key: str | None = None
    requester: str | None = None
    target_user: str | None = None
    system: str | None = None
    request_type: str | None = None
    requested_access: str | None = None
    justification: str | None = None


class TicketTriageResult(BaseModel):
    classification: TicketRequestClassification
    summary: str
    confidence: Literal["low", "medium", "high"] = "medium"
    business_role: str | None = None
    guidance_comment: str | None = None
    jira_action: str | None = None
    iga_action: str | None = None
    extracted_context: AccessRequestContext = Field(default_factory=AccessRequestContext)
    rationale: list[str] = Field(default_factory=list)
    recommended_steps: list[str] = Field(default_factory=list)
