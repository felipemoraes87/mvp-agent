export function DocsPage() {
  const docs = [
    { label: "OpenClaw CLI", url: "https://docs.openclaw.ai/cli" },
    { label: "OpenClaw FAQ", url: "https://docs.openclaw.ai/faq" },
    { label: "OpenClaw Troubleshooting", url: "https://docs.openclaw.ai/troubleshooting" },
    { label: "Agno Introduction", url: "https://docs.agno.com/introduction" },
    { label: "Agno + Ollama", url: "https://docs.agno.com/cookbook/models/local/ollama" },
  ];

  const localDocs = [
    { label: "README (MVP Agent)", path: "MVP Agent/README.md" },
    { label: "PROJECT_CONTEXT", path: "MVP Agent/PROJECT_CONTEXT.md" },
    { label: "GUI Guide", path: "MVP Agent/GUI_GUIDE_PTBR.md" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Docs</h2>
        <p className="text-sm text-slate-400">Referências oficiais e documentação local usada pelo portal.</p>
      </div>

      <div className="panel p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Online References</div>
        <div className="space-y-2">
          {docs.map((doc) => (
            <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer" className="block rounded-md border border-slate-700 bg-slate-900/35 px-3 py-2 text-sm text-indigo-300 hover:bg-slate-800/60 hover:underline">
              {doc.label}
            </a>
          ))}
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Local Project Docs</div>
        <ul className="space-y-2 text-sm text-slate-200">
          {localDocs.map((doc) => (
            <li key={doc.path} className="rounded-md border border-slate-700 bg-slate-900/35 px-3 py-2">
              <div className="font-semibold">{doc.label}</div>
              <div className="text-xs text-slate-400">{doc.path}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
