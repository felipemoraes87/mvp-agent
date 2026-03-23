import { NavLink } from "react-router-dom";
import type { Role } from "../lib/types";

type NavItem = {
  type: "item";
  to: string;
  label: string;
  adminOnly?: boolean;
};

type Divider = { type: "divider" };

type MenuEntry = NavItem | Divider;

const menu: MenuEntry[] = [
  { type: "item", to: "/", label: "Painel" },
  { type: "item", to: "/exec-dashboard", label: "Visao executiva" },
  { type: "divider" },
  { type: "item", to: "/agents", label: "Agentes" },
  { type: "item", to: "/workflows", label: "Workflows" },
  { type: "item", to: "/skills", label: "Skills" },
  { type: "item", to: "/tools", label: "Ferramentas" },
  { type: "item", to: "/knowledge", label: "Conhecimento" },
  { type: "item", to: "/playground", label: "Playground" },
  { type: "item", to: "/graph", label: "Mapa de times" },
  { type: "item", to: "/graph-test", label: "Graph Test" },
  { type: "divider" },
  { type: "item", to: "/channels", label: "Canais" },
  { type: "item", to: "/configuration", label: "Configuracao" },
  { type: "item", to: "/debug", label: "Debug" },
  { type: "item", to: "/logs", label: "Logs" },
  { type: "item", to: "/docs", label: "Docs" },
  { type: "item", to: "/access", label: "Acesso", adminOnly: true },
];

export function Sidebar({ role }: { role?: Role }) {
  const navItems = menu.filter((entry) => entry.type === "divider" || !entry.adminOnly || role === "ADMIN");

  return (
    <aside className="hidden w-72 shrink-0 border-r border-slate-700/70 bg-[var(--bg-elev)] lg:flex lg:flex-col">
      <div className="border-b border-slate-700/70 px-4 py-4">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Navegacao</div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <nav className="space-y-1">
          {navItems.map((entry, idx) => {
            if (entry.type === "divider") {
              return <div key={`divider-${idx}`} className="my-2 border-t border-slate-700/70" />;
            }
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === "/"}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm transition ${
                    isActive ? "bg-indigo-500/20 text-indigo-200" : "text-slate-300 hover:bg-slate-800/70"
                  }`
                }
              >
                {entry.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
