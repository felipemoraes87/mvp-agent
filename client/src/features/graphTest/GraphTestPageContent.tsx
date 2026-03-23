import { useMemo, useState } from "react";
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap, ReactFlowProvider, useReactFlow } from "reactflow";
import "reactflow/dist/style.css";
import { graphTestMock } from "./mockData";
import { buildGraphSummary, buildGraphView, buildNodeDetails, statusColor } from "./graphUtils";
import { AgentNodeControl, CoordinatorNode, TeamNode } from "./components/ControlPlaneNode";
import { GraphLegend } from "./components/GraphLegend";
import { GraphMetrics } from "./components/GraphMetrics";
import { GraphToolbar } from "./components/GraphToolbar";
import { NodeDetailPanel } from "./components/NodeDetailPanel";
import type { GraphFilters } from "./types";

const defaultFilters: GraphFilters = {
  search: "",
  showTeams: true,
  showAgents: true,
  coordinatorsOnly: false,
  degradedOnly: false,
  nodeTypes: ["team", "agent", "coordinator"],
};

const nodeTypes = {
  teamNode: TeamNode,
  agentNode: AgentNodeControl,
  coordinatorNode: CoordinatorNode,
};

function GraphTestCanvas() {
  const [filters, setFilters] = useState<GraphFilters>(defaultFilters);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graph = useMemo(() => buildGraphView(graphTestMock, filters), [filters]);
  const summary = useMemo(() => buildGraphSummary(graphTestMock), []);
  const details = useMemo(() => buildNodeDetails(graphTestMock, selectedNodeId), [selectedNodeId]);
  const reactFlow = useReactFlow();

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Graph Test</h2>
            <p className="mt-1 text-sm text-slate-400">Topology view for teams, coordinators and operational agents. Designed as a control-plane style explorer.</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
            Hover, pan, zoom and inspect nodes to understand ownership, orchestration and degraded areas.
          </div>
        </div>
      </section>

      <GraphMetrics summary={summary} />
      <GraphToolbar
        filters={filters}
        onFiltersChange={setFilters}
        onFitGraph={() => reactFlow.fitView({ padding: 0.18, duration: 600 })}
        onResetView={() => {
          setFilters(defaultFilters);
          setSelectedNodeId(null);
          window.setTimeout(() => reactFlow.fitView({ padding: 0.18, duration: 600 }), 10);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel relative h-[720px] overflow-hidden">
          <div className="absolute left-4 top-4 z-20 rounded-2xl border border-slate-700 bg-slate-950/88 px-4 py-3 shadow-xl">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Control plane snapshot</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{graph.nodes.length} nodes visiveis</div>
            <div className="mt-1 text-xs text-slate-400">{graph.edges.length} connections ativas no recorte atual</div>
          </div>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.8}
            onNodeClick={(_, node) => setSelectedNodeId(String(node.id))}
            defaultEdgeOptions={{ animated: false }}
            className="h-full"
          >
            <Background variant={BackgroundVariant.Dots} color="#334155" size={1.4} gap={18} />
            <MiniMap
              pannable
              zoomable
              style={{ background: "#0f172a", border: "1px solid #334155" }}
              nodeColor={(node) => {
                const status = node.data?.status ? statusColor(node.data.status) : "#818cf8";
                return status;
              }}
              maskColor="rgba(15, 23, 42, 0.65)"
            />
            <Controls className="!bg-slate-900 !text-slate-200 !border !border-slate-700" />
          </ReactFlow>
        </section>

        <div className="space-y-4">
          <NodeDetailPanel details={details} />
          <GraphLegend />
        </div>
      </div>
    </div>
  );
}

export function GraphTestPageContent() {
  return (
    <ReactFlowProvider>
      <GraphTestCanvas />
    </ReactFlowProvider>
  );
}
