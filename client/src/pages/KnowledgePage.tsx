import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { AgentWithLinks, KnowledgeSource, Team } from "../lib/types";

type KnowledgeTab = "overview" | "source" | "tags" | "usage";

type KnowledgeForm = {
  name: string;
  url: string;
  tagsCsv: string;
  ownerTeamId: string;
  sourceType: "url" | "pdf" | "docx" | "folder" | "api" | "slack" | "confluence" | "custom";
  sourceConfigJson: string;
  chunkSize: number | "";
  chunkOverlap: number | "";
  chunkStrategy: "fixed" | "semantic" | "markdown" | "code";
  embeddingProvider: string;
  embeddingModel: string;
  vectorStoreProvider: string;
  vectorStoreIndex: string;
  retrievalMode: "agentic" | "references" | "hybrid";
  searchType: "vector" | "hybrid" | "keyword";
  maxResults: number | "";
  rerankerProvider: string;
  rerankerModel: string;
  metadataFilterJson: string;
  contextFormat: "json" | "yaml";
  addContextInstructions: boolean;
  addReferences: boolean;
  visibility: "private" | "shared";
};

const tabs: Array<{ id: KnowledgeTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "source", label: "Source" },
  { id: "tags", label: "Tags" },
  { id: "usage", label: "Usage" },
];

const empty: KnowledgeForm = {
  name: "",
  url: "",
  tagsCsv: "",
  ownerTeamId: "",
  sourceType: "url",
  sourceConfigJson: "{}",
  chunkSize: 1200,
  chunkOverlap: 200,
  chunkStrategy: "semantic",
  embeddingProvider: "vertexai",
  embeddingModel: "text-embedding-004",
  vectorStoreProvider: "vertex-vector-search",
  vectorStoreIndex: "",
  retrievalMode: "hybrid",
  searchType: "hybrid",
  maxResults: 8,
  rerankerProvider: "",
  rerankerModel: "",
  metadataFilterJson: "{}",
  contextFormat: "json",
  addContextInstructions: true,
  addReferences: true,
  visibility: "private",
};

function toForm(item: KnowledgeSource): KnowledgeForm {
  return {
    name: item.name,
    url: item.url,
    tagsCsv: item.tags.join(", "),
    ownerTeamId: item.ownerTeamId,
    sourceType: item.sourceType || "url",
    sourceConfigJson: JSON.stringify(item.sourceConfig || {}, null, 2),
    chunkSize: item.chunkSize ?? 1200,
    chunkOverlap: item.chunkOverlap ?? 200,
    chunkStrategy: item.chunkStrategy || "semantic",
    embeddingProvider: item.embeddingProvider || "vertexai",
    embeddingModel: item.embeddingModel || "text-embedding-004",
    vectorStoreProvider: item.vectorStoreProvider || "vertex-vector-search",
    vectorStoreIndex: item.vectorStoreIndex || "",
    retrievalMode: item.retrievalMode || "hybrid",
    searchType: item.searchType || "hybrid",
    maxResults: item.maxResults ?? 8,
    rerankerProvider: item.rerankerProvider || "",
    rerankerModel: item.rerankerModel || "",
    metadataFilterJson: JSON.stringify(item.metadataFilter || {}, null, 2),
    contextFormat: item.contextFormat || "json",
    addContextInstructions: Boolean(item.addContextInstructions),
    addReferences: item.addReferences ?? true,
    visibility: item.visibility || "private",
  };
}

export function KnowledgePage() { // NOSONAR
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<KnowledgeTab>("overview");

  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<KnowledgeForm>(empty);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [k, t, a] = await Promise.all([
        apiGet<{ knowledgeSources: KnowledgeSource[] }>("/api/knowledge-sources"),
        apiGet<{ teams: Team[] }>("/api/teams"),
        apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      ]);
      setItems(k.knowledgeSources);
      setTeams(t.teams);
      setAgents(a.agents);
      const fallbackId = k.knowledgeSources[0]?.id || "";
      setSelectedId((current) => (k.knowledgeSources.some((item) => item.id === current) ? current : fallbackId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed loading knowledge sources.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  useEffect(() => {
    if (selected) {
      setForm(toForm(selected));
      return;
    }
    setForm({ ...empty, ownerTeamId: teams[0]?.id || "" });
  }, [selected?.id, teams]);

  const linkedAgents = useMemo(() => {
    if (!selected) return [];
    return agents.filter((agent) => (agent.knowledgeLinks || []).some((link) => link.knowledgeSourceId === selected.id));
  }, [agents, selected]);

  const save = async () => {
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        tags: form.tagsCsv.split(",").map((x) => x.trim()).filter(Boolean),
        ownerTeamId: form.ownerTeamId,
        sourceType: form.sourceType,
        sourceConfig: JSON.parse(form.sourceConfigJson || "{}"),
        chunkSize: form.chunkSize === "" ? null : Number(form.chunkSize),
        chunkOverlap: form.chunkOverlap === "" ? null : Number(form.chunkOverlap),
        chunkStrategy: form.chunkStrategy,
        embeddingProvider: form.embeddingProvider.trim() || null,
        embeddingModel: form.embeddingModel.trim() || null,
        vectorStoreProvider: form.vectorStoreProvider.trim() || null,
        vectorStoreIndex: form.vectorStoreIndex.trim() || null,
        retrievalMode: form.retrievalMode,
        searchType: form.searchType,
        maxResults: form.maxResults === "" ? null : Number(form.maxResults),
        rerankerProvider: form.rerankerProvider.trim() || null,
        rerankerModel: form.rerankerModel.trim() || null,
        metadataFilter: JSON.parse(form.metadataFilterJson || "{}"),
        contextFormat: form.contextFormat,
        addContextInstructions: form.addContextInstructions,
        addReferences: form.addReferences,
        visibility: form.visibility,
      };
      if (!payload.name || !payload.url || !payload.ownerTeamId) {
        setStatus("Name, URL and Team are required.");
        return;
      }

      if (selected) {
        const updated = await apiPut<{ knowledgeSource: KnowledgeSource }>(`/api/knowledge-sources/${selected.id}`, payload);
        setStatus("Knowledge source updated.");
        await load();
        setSelectedId(updated.knowledgeSource.id);
      } else {
        const created = await apiPost<{ knowledgeSource: KnowledgeSource }>("/api/knowledge-sources", payload);
        setStatus("Knowledge source created.");
        await load();
        setSelectedId(created.knowledgeSource.id);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed saving knowledge source.");
    }
  };

  const syncSelected = async () => {
    if (!selected) return;
    try {
      await apiPost(`/api/knowledge-sources/${selected.id}/sync`, {});
      await load();
      setStatus("Knowledge index synced.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed syncing knowledge source.");
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete knowledge source "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/knowledge-sources/${selected.id}`);
      setStatus("Knowledge source removed.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed removing knowledge source.");
    }
  };

  const startCreate = () => {
    setSelectedId("");
    setForm({ ...empty, ownerTeamId: teams[0]?.id || "" });
    setTab("source");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Knowledge Sources</h2>
          <p className="text-sm text-slate-400">Knowledge layer: configure ingestion and retrieval (RAG) for agents.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
          <button className="btn-primary" onClick={startCreate}>New Source</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Sources</div>
              <div className="text-xs text-slate-400">{items.length} configured.</div>
            </div>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void load()}>Refresh</button>
          </div>

          {loading ? <div className="text-xs text-slate-400">Loading...</div> : null}

          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === item.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="font-semibold text-slate-100">{item.name}</div>
                <div className="truncate text-xs text-slate-400">{item.visibility} | {item.url}</div>
              </button>
            ))}
            {!items.length ? <div className="text-xs text-slate-400">No knowledge sources created yet.</div> : null}
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
              <div className="text-sm font-semibold text-slate-100">Source Settings</div>
              <div className="flex gap-2">
                {selected ? <button className="btn-ghost" onClick={() => void syncSelected()}>Sync Index</button> : null}
                {selected ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeSelected()}>Delete</button> : null}
              </div>
            </div>

            {tab === "overview" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Ownership, retrieval profile and indexing status.</div>
                {selected ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><div className="text-xs text-slate-400">Name</div><div className="text-sm text-slate-100">{selected.name}</div></div>
                    <div><div className="text-xs text-slate-400">Owner Team</div><div className="text-sm text-slate-100">{teams.find((team) => team.id === selected.ownerTeamId)?.key || "-"}</div></div>
                    <div><div className="text-xs text-slate-400">Visibility</div><div className="text-sm text-slate-100">{selected.visibility}</div></div>
                    <div><div className="text-xs text-slate-400">Linked Agents</div><div className="text-sm text-slate-100">{linkedAgents.length}</div></div>
                    <div><div className="text-xs text-slate-400">Source Type</div><div className="text-sm text-slate-100">{selected.sourceType || "url"}</div></div>
                    <div><div className="text-xs text-slate-400">Retrieval Mode</div><div className="text-sm text-slate-100">{selected.retrievalMode || "hybrid"}</div></div>
                    <div><div className="text-xs text-slate-400">Search Type</div><div className="text-sm text-slate-100">{selected.searchType || "hybrid"}</div></div>
                    <div><div className="text-xs text-slate-400">Sync Status</div><div className="text-sm text-slate-100">{selected.syncStatus || "idle"}</div></div>
                    <div><div className="text-xs text-slate-400">Indexed Docs</div><div className="text-sm text-slate-100">{selected.indexedDocuments ?? 0}</div></div>
                    <div><div className="text-xs text-slate-400">Last Sync</div><div className="text-sm text-slate-100">{selected.lastSyncedAt || "-"}</div></div>
                    <div className="md:col-span-3"><div className="text-xs text-slate-400">URL</div><div className="truncate text-sm text-slate-100">{selected.url}</div></div>
                    {selected.lastSyncError ? <div className="md:col-span-3 text-xs text-rose-300">Last error: {selected.lastSyncError}</div> : null}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">Create a new source in Source tab.</div>
                )}
              </div>
            ) : null}

            {tab === "source" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input-dark" placeholder="Name" value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} />
                <select className="input-dark" value={form.ownerTeamId} onChange={(e) => setForm((state) => ({ ...state, ownerTeamId: e.target.value }))}>
                  <option value="">Select team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <select className="input-dark" value={form.visibility} onChange={(e) => setForm((state) => ({ ...state, visibility: e.target.value as KnowledgeForm["visibility"] }))}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <input className="input-dark md:col-span-2" placeholder="URL" value={form.url} onChange={(e) => setForm((state) => ({ ...state, url: e.target.value }))} />
                <select className="input-dark" value={form.sourceType} onChange={(e) => setForm((state) => ({ ...state, sourceType: e.target.value as KnowledgeForm["sourceType"] }))}>
                  <option value="url">url</option>
                  <option value="pdf">pdf</option>
                  <option value="docx">docx</option>
                  <option value="folder">folder</option>
                  <option value="api">api</option>
                  <option value="slack">slack</option>
                  <option value="confluence">confluence</option>
                  <option value="custom">custom</option>
                </select>
                <select className="input-dark" value={form.chunkStrategy} onChange={(e) => setForm((state) => ({ ...state, chunkStrategy: e.target.value as KnowledgeForm["chunkStrategy"] }))}>
                  <option value="semantic">semantic</option>
                  <option value="fixed">fixed</option>
                  <option value="markdown">markdown</option>
                  <option value="code">code</option>
                </select>
                <input className="input-dark" type="number" placeholder="chunk size" value={form.chunkSize} onChange={(e) => setForm((state) => ({ ...state, chunkSize: e.target.value === "" ? "" : Number(e.target.value) }))} />
                <input className="input-dark" type="number" placeholder="chunk overlap" value={form.chunkOverlap} onChange={(e) => setForm((state) => ({ ...state, chunkOverlap: e.target.value === "" ? "" : Number(e.target.value) }))} />
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-slate-400">Source config (JSON)</div>
                  <textarea className="input-dark min-h-24 font-mono text-xs" value={form.sourceConfigJson} onChange={(e) => setForm((state) => ({ ...state, sourceConfigJson: e.target.value }))} />
                </div>
                <div className="md:col-span-2"><button className="btn-primary" onClick={() => void save()}>{selected ? "Save" : "Create"}</button></div>
              </div>
            ) : null}

            {tab === "tags" ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-slate-400">Tags (comma-separated)</div>
                  <input className="input-dark" placeholder="policy, incident, cloud" value={form.tagsCsv} onChange={(e) => setForm((state) => ({ ...state, tagsCsv: e.target.value }))} />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input className="input-dark" placeholder="Embedding provider" value={form.embeddingProvider} onChange={(e) => setForm((state) => ({ ...state, embeddingProvider: e.target.value }))} />
                  <input className="input-dark" placeholder="Embedding model" value={form.embeddingModel} onChange={(e) => setForm((state) => ({ ...state, embeddingModel: e.target.value }))} />
                  <input className="input-dark" placeholder="Vector store provider" value={form.vectorStoreProvider} onChange={(e) => setForm((state) => ({ ...state, vectorStoreProvider: e.target.value }))} />
                  <input className="input-dark" placeholder="Vector index" value={form.vectorStoreIndex} onChange={(e) => setForm((state) => ({ ...state, vectorStoreIndex: e.target.value }))} />
                  <select className="input-dark" value={form.retrievalMode} onChange={(e) => setForm((state) => ({ ...state, retrievalMode: e.target.value as KnowledgeForm["retrievalMode"] }))}>
                    <option value="agentic">agentic</option>
                    <option value="references">references</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                  <select className="input-dark" value={form.searchType} onChange={(e) => setForm((state) => ({ ...state, searchType: e.target.value as KnowledgeForm["searchType"] }))}>
                    <option value="vector">vector</option>
                    <option value="hybrid">hybrid</option>
                    <option value="keyword">keyword</option>
                  </select>
                  <input className="input-dark" type="number" placeholder="max results" value={form.maxResults} onChange={(e) => setForm((state) => ({ ...state, maxResults: e.target.value === "" ? "" : Number(e.target.value) }))} />
                  <select className="input-dark" value={form.contextFormat} onChange={(e) => setForm((state) => ({ ...state, contextFormat: e.target.value as KnowledgeForm["contextFormat"] }))}>
                    <option value="json">json</option>
                    <option value="yaml">yaml</option>
                  </select>
                  <input className="input-dark" placeholder="Reranker provider" value={form.rerankerProvider} onChange={(e) => setForm((state) => ({ ...state, rerankerProvider: e.target.value }))} />
                  <input className="input-dark" placeholder="Reranker model" value={form.rerankerModel} onChange={(e) => setForm((state) => ({ ...state, rerankerModel: e.target.value }))} />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.addContextInstructions} onChange={(e) => setForm((state) => ({ ...state, addContextInstructions: e.target.checked }))} />Add context instructions</label>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.addReferences} onChange={(e) => setForm((state) => ({ ...state, addReferences: e.target.checked }))} />Add references</label>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Metadata filter (JSON)</div>
                  <textarea className="input-dark min-h-24 font-mono text-xs" value={form.metadataFilterJson} onChange={(e) => setForm((state) => ({ ...state, metadataFilterJson: e.target.value }))} />
                </div>
                <button className="btn-primary" onClick={() => void save()}>{selected ? "Save Retrieval" : "Create Source"}</button>
              </div>
            ) : null}

            {tab === "usage" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Agents currently linked to this source.</div>
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  {selected ? (
                    linkedAgents.length ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {linkedAgents.map((agent) => (
                          <div key={agent.id} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">{agent.name}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">No agents linked to this source.</div>
                    )
                  ) : (
                    <div className="text-sm text-slate-400">Select or create a source to inspect usage.</div>
                  )}
                </div>
                {selected ? <button className="btn-primary" onClick={() => void syncSelected()}>Run Index Sync</button> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
