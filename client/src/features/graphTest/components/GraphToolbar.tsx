import type { GraphEntityType, GraphFilters } from "../types";

type Props = {
  filters: GraphFilters;
  onFiltersChange: (next: GraphFilters) => void;
  onFitGraph: () => void;
  onResetView: () => void;
};

const ENTITY_TYPES: GraphEntityType[] = ["team", "agent", "coordinator"];

export function GraphToolbar({ filters, onFiltersChange, onFitGraph, onResetView }: Props) {
  const toggleType = (type: GraphEntityType) => {
    const active = filters.nodeTypes.includes(type);
    onFiltersChange({
      ...filters,
      nodeTypes: active ? filters.nodeTypes.filter((entry) => entry !== type) : [...filters.nodeTypes, type],
    });
  };

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input-dark max-w-xs"
          placeholder="Buscar teams, agents ou capacidades..."
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        />
        <button className={`btn-ghost ${filters.showTeams ? "border-sky-400/50 text-sky-100" : ""}`} onClick={() => onFiltersChange({ ...filters, showTeams: !filters.showTeams })}>
          Teams
        </button>
        <button className={`btn-ghost ${filters.showAgents ? "border-violet-400/50 text-violet-100" : ""}`} onClick={() => onFiltersChange({ ...filters, showAgents: !filters.showAgents })}>
          Agents
        </button>
        <button className={`btn-ghost ${filters.coordinatorsOnly ? "border-indigo-400/50 text-indigo-100" : ""}`} onClick={() => onFiltersChange({ ...filters, coordinatorsOnly: !filters.coordinatorsOnly })}>
          So coordinators
        </button>
        <button className={`btn-ghost ${filters.degradedOnly ? "border-rose-400/50 text-rose-100" : ""}`} onClick={() => onFiltersChange({ ...filters, degradedOnly: !filters.degradedOnly })}>
          So degraded
        </button>
        {ENTITY_TYPES.map((type) => (
          <button
            key={type}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${filters.nodeTypes.includes(type) ? "border-slate-500 bg-slate-800/90 text-slate-100" : "border-slate-700 bg-slate-900/60 text-slate-400"}`}
            onClick={() => toggleType(type)}
          >
            {type}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost" onClick={onFitGraph}>Fit graph</button>
          <button className="btn-primary" onClick={onResetView}>Reset filtros</button>
        </div>
      </div>
    </div>
  );
}
