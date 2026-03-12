export function HelpTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-500/70 bg-slate-800 text-[10px] font-semibold text-slate-300"
        aria-label={text}
        title={text}
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 shadow-xl group-hover:block">
        {text}
      </span>
    </span>
  );
}
