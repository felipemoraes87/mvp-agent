import { statusColor } from "../graphUtils";
import type { NodeDetails } from "../types";

export function NodeDetailPanel({ details }: { details: NodeDetails | null }) {
  if (!details) {
    return (
      <aside className="panel h-full p-4">
        <div className="text-sm font-semibold text-slate-100">Node details</div>
        <div className="mt-3 text-sm text-slate-400">Selecione um node para ver metadados, relacoes, ferramentas e sinais operacionais.</div>
      </aside>
    );
  }

  return (
    <aside className="panel h-full p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{details.entityType}</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{details.name}</div>
          {details.teamName ? <div className="mt-1 text-xs text-slate-400">{details.teamName}</div> : null}
        </div>
        <div className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: `${statusColor(details.status)}66`, color: statusColor(details.status) }}>
          {details.status}
        </div>
      </div>

      <div className="mt-4 text-sm leading-6 text-slate-300">{details.description}</div>

      <div className="mt-5 space-y-4">
        <section>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Tags</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {details.tags.map((tag) => <span key={tag} className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] text-slate-300">{tag}</span>)}
          </div>
        </section>
        <section>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Capabilities</div>
          <div className="mt-2 space-y-2">
            {details.capabilities.map((item) => <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">{item}</div>)}
          </div>
        </section>
        <section className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Tools</div>
            <div className="mt-2 space-y-2">
              {details.tools.length ? details.tools.map((item) => <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">{item}</div>) : <div className="text-xs text-slate-500">Nenhuma tool associada.</div>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">MCPs</div>
            <div className="mt-2 space-y-2">
              {details.mcps.length ? details.mcps.map((item) => <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">{item}</div>) : <div className="text-xs text-slate-500">Nenhum MCP associado.</div>}
            </div>
          </div>
        </section>
        <section>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Relations</div>
          <div className="mt-2 space-y-2">
            {details.relations.length ? details.relations.map((relation) => <div key={relation} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">{relation}</div>) : <div className="text-xs text-slate-500">Sem relacoes registradas.</div>}
          </div>
        </section>
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4 text-xs text-slate-500">Last updated: {details.lastUpdated}</div>
    </aside>
  );
}
