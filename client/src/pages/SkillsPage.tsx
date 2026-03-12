import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AgentWithLinks, Team } from "../lib/types";

type SkillRecord = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  runbookUrl: string;
  category: "operations" | "analysis" | "compliance" | "custom";
  linkedAgentIds: string[];
  enabled: boolean;
  ownerTeamId: string | null;
  visibility: "private" | "shared";
};

type SkillTab = "overview" | "details" | "linkedAgents";

type SkillForm = Omit<SkillRecord, "id">;

const STORAGE_KEY = "studio.skills.config.v2";

const tabs: Array<{ id: SkillTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "details", label: "Details" },
  { id: "linkedAgents", label: "Linked Agents" },
];

const empty: SkillForm = {
  name: "",
  description: "",
  prompt: "",
  runbookUrl: "",
  category: "operations",
  linkedAgentIds: [],
  enabled: true,
  ownerTeamId: null,
  visibility: "private",
};

function defaultSecuritySkills(): SkillRecord[] {
  return [
    {
      id: "skill-sec-triage",
      name: "Incident Triage",
      description: "Classify alert severity, impacted assets, and first-response path.",
      prompt:
        "You are the incident triage specialist. Normalize incoming alerts, identify impacted assets/users, estimate business impact, classify severity (low/med/high/critical), and produce a first-response checklist. Ask for missing evidence before escalation.",
      runbookUrl: "",
      category: "operations",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-threat-intel",
      name: "Threat Intelligence Correlation",
      description: "Correlate IoCs, campaigns, and actor TTPs across feeds.",
      prompt:
        "You are the threat intelligence correlator. Correlate domains, IPs, hashes, and URLs with known campaigns and ATT&CK techniques. Distinguish confirmed evidence from hypothesis, cite confidence level, and output actionable detections and blocking recommendations.",
      runbookUrl: "",
      category: "analysis",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-vuln-prioritization",
      name: "Vulnerability Prioritization",
      description: "Prioritize vulnerabilities by exploitability, exposure, and business impact.",
      prompt:
        "You are the vulnerability prioritization specialist. Rank findings by exploitability, internet exposure, privilege impact, asset criticality, and compensating controls. Propose remediation order with deadlines and clear owner recommendations.",
      runbookUrl: "",
      category: "analysis",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-phishing-response",
      name: "Phishing Investigation",
      description: "Analyze phishing reports, extract indicators, and propose containment.",
      prompt:
        "You are the phishing analyst. Parse headers and body signals, extract IoCs, identify spoofing patterns, and determine user impact. Provide containment actions (block/sinkhole/quarantine), user communication guidance, and escalation criteria.",
      runbookUrl: "",
      category: "operations",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-ir-timeline",
      name: "Incident Timeline Builder",
      description: "Build forensic timeline with key events, artifacts, and decisions.",
      prompt:
        "You are the incident timeline builder. Reconstruct event chronology from logs and alerts with UTC timestamps, source reliability, and causality links. Highlight gaps in evidence and list next collection steps required for closure.",
      runbookUrl: "",
      category: "operations",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-control-mapping",
      name: "Control Mapping (ISO/NIST)",
      description: "Map findings and gaps to security controls and compliance obligations.",
      prompt:
        "You are the control mapping specialist. Map security findings to ISO 27001 and NIST CSF control families, identify compliance impact, and recommend corrective actions with measurable acceptance criteria for audit readiness.",
      runbookUrl: "",
      category: "compliance",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
    {
      id: "skill-sec-post-incident",
      name: "Post-Incident Review",
      description: "Generate lessons learned, corrective actions, and prevention backlog.",
      prompt:
        "You are the post-incident reviewer. Produce a blameless retrospective with root cause, contributing factors, response quality analysis, and a prioritized prevention backlog. Include owners, target dates, and verification metrics.",
      runbookUrl: "",
      category: "operations",
      linkedAgentIds: [],
      enabled: true,
      ownerTeamId: null,
      visibility: "shared",
    },
  ];
}

function loadSkills(): SkillRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSecuritySkills();
    const parsed = JSON.parse(raw) as Array<Partial<SkillRecord>>;
    if (!Array.isArray(parsed) || !parsed.length) return defaultSecuritySkills();
    return parsed.map((item, index) => ({
      id: item.id || `skill-${Date.now()}-${index}`,
      name: item.name || "Unnamed Skill",
      description: item.description || "",
      prompt: item.prompt || "",
      runbookUrl: item.runbookUrl || "",
      category: item.category || "custom",
      linkedAgentIds: Array.isArray(item.linkedAgentIds) ? item.linkedAgentIds : [],
      enabled: item.enabled !== false,
      ownerTeamId: item.ownerTeamId || null,
      visibility: item.visibility === "shared" ? "shared" : "private",
    }));
  } catch {
    return defaultSecuritySkills();
  }
}

function saveSkills(skills: SkillRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
}

function toForm(skill: SkillRecord): SkillForm {
  return {
    name: skill.name,
    description: skill.description,
    prompt: skill.prompt,
    runbookUrl: skill.runbookUrl,
    category: skill.category,
    linkedAgentIds: skill.linkedAgentIds,
    enabled: skill.enabled,
    ownerTeamId: skill.ownerTeamId,
    visibility: skill.visibility,
  };
}

export function SkillsPage() { // NOSONAR
  const { user } = useAuth();
  const [tab, setTab] = useState<SkillTab>("overview");
  const [status, setStatus] = useState("");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>(() => loadSkills());
  const [selectedId, setSelectedId] = useState(() => loadSkills()[0]?.id || "");
  const [form, setForm] = useState<SkillForm>(empty);

  useEffect(() => {
    void Promise.all([
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ teams: Team[] }>("/api/teams"),
    ])
      .then(([agentRes, teamRes]) => {
        setAgents(agentRes.agents);
        setTeams(teamRes.teams);
      })
      .catch(() => {
        setAgents([]);
        setTeams([]);
      });
  }, []);

  const visibleSkills = useMemo(() => {
    if (!user) return skills;
    if (user.role === "ADMIN" || user.role === "OPERATOR") return skills;
    return skills.filter((skill) => skill.visibility === "shared" || skill.ownerTeamId === user.teamId);
  }, [skills, user]);

  useEffect(() => {
    saveSkills(skills);
    setSelectedId((current) => (visibleSkills.some((skill) => skill.id === current) ? current : (visibleSkills[0]?.id || "")));
  }, [skills, visibleSkills]);

  const selected = useMemo(() => visibleSkills.find((skill) => skill.id === selectedId) || null, [visibleSkills, selectedId]);

  useEffect(() => {
    if (!selected) {
      setForm(empty);
      return;
    }
    setForm(toForm(selected));
  }, [selected?.id]);

  const linkedAgentList = useMemo(() => {
    return agents.filter((agent) => form.linkedAgentIds.includes(agent.id));
  }, [agents, form.linkedAgentIds]);

  const startCreate = () => {
    setSelectedId("");
    setForm({ ...empty, ownerTeamId: user?.teamId || teams[0]?.id || null });
    setTab("details");
  };

  const save = () => {
    const payload: SkillRecord = {
      id: selected?.id || `skill-${Date.now()}`,
      name: form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      runbookUrl: form.runbookUrl.trim(),
      category: form.category,
      linkedAgentIds: form.linkedAgentIds,
      enabled: form.enabled,
      ownerTeamId: form.ownerTeamId,
      visibility: form.visibility,
    };

    if (!payload.name) {
      setStatus("Skill name is required.");
      return;
    }

    if (selected) {
      setSkills((prev) => prev.map((item) => (item.id === selected.id ? payload : item)));
      setStatus("Skill updated.");
    } else {
      setSkills((prev) => [payload, ...prev]);
      setSelectedId(payload.id);
      setStatus("Skill created.");
    }
  };

  const removeSelected = () => {
    if (!selected) return;
    if (!window.confirm(`Delete skill "${selected.name}"?`)) return;
    setSkills((prev) => prev.filter((item) => item.id !== selected.id));
    setStatus("Skill removed.");
  };

  const setLinkedAgentChecked = (agentId: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      linkedAgentIds: checked
        ? [...prev.linkedAgentIds, agentId]
        : prev.linkedAgentIds.filter((id) => id !== agentId),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Skills</h2>
          <p className="text-sm text-slate-400">Capability layer: reusable operational behaviors linked to agents.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setSkills(loadSkills())}>Reload</button>
          <button className="btn-primary" onClick={startCreate}>New Skill</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Skills</div>
          <div className="space-y-2">
            {visibleSkills.map((skill) => (
              <button
                key={skill.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === skill.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedId(skill.id)}
              >
                <div className="font-semibold text-slate-100">{skill.name}</div>
                <div className="text-xs text-slate-400">{skill.category} | {skill.enabled ? "enabled" : "disabled"}</div>
              </button>
            ))}
            {!skills.length ? <div className="text-xs text-slate-400">No skills created yet.</div> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button key={item.id} className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>

          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">Skill Settings</div>
              {selected ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={removeSelected}>Delete</button> : null}
            </div>

            {tab === "overview" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Summary and current assignment footprint.</div>
                {selected ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><div className="text-xs text-slate-400">Name</div><div className="text-sm text-slate-100">{selected.name}</div></div>
                    <div><div className="text-xs text-slate-400">Category</div><div className="text-sm text-slate-100">{selected.category}</div></div>
                    <div><div className="text-xs text-slate-400">Status</div><div className="text-sm text-slate-100">{selected.enabled ? "enabled" : "disabled"}</div></div>
                    <div><div className="text-xs text-slate-400">Visibility</div><div className="text-sm text-slate-100">{selected.visibility}</div></div>
                    <div><div className="text-xs text-slate-400">Linked Agents</div><div className="text-sm text-slate-100">{selected.linkedAgentIds.length}</div></div>
                    <div className="md:col-span-2"><div className="text-xs text-slate-400">Runbook</div><div className="truncate text-sm text-slate-100">{selected.runbookUrl || "-"}</div></div>
                    <div className="md:col-span-3"><div className="text-xs text-slate-400">Prompt</div><div className="text-sm text-slate-100">{selected.prompt || "-"}</div></div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">Create a skill in Details tab.</div>
                )}
              </div>
            ) : null}

            {tab === "details" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input-dark" placeholder="Skill name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                <select className="input-dark" value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value as SkillForm["category"] }))}>
                  <option value="operations">operations</option>
                  <option value="analysis">analysis</option>
                  <option value="compliance">compliance</option>
                  <option value="custom">custom</option>
                </select>
                <select className="input-dark" value={form.ownerTeamId || ""} onChange={(e) => setForm((s) => ({ ...s, ownerTeamId: e.target.value || null }))}>
                  <option value="">No owner team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <select className="input-dark" value={form.visibility} onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as SkillForm["visibility"] }))}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <input className="input-dark md:col-span-2" placeholder="Runbook URL (optional)" value={form.runbookUrl} onChange={(e) => setForm((s) => ({ ...s, runbookUrl: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-24" placeholder="Description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-32" placeholder="Prompt / operational instruction" value={form.prompt} onChange={(e) => setForm((s) => ({ ...s, prompt: e.target.value }))} />
                <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))} />Enabled</label>
                <div className="md:col-span-2"><button className="btn-primary" onClick={save}>{selected ? "Save" : "Create"}</button></div>
              </div>
            ) : null}

            {tab === "linkedAgents" ? (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Select linked agents</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={form.linkedAgentIds.includes(agent.id)}
                          onChange={(e) => setLinkedAgentChecked(agent.id, e.target.checked)}
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Current links</div>
                  {linkedAgentList.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {linkedAgentList.map((agent) => (
                        <div key={agent.id} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">{agent.name}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">No linked agents.</div>
                  )}
                </div>
                <button className="btn-primary" onClick={save}>{selected ? "Save Links" : "Create Skill"}</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
