import type { ReactNode } from "react";

type ChartContainerProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function ChartContainer({ title, subtitle, children }: ChartContainerProps) {
  return (
    <section className="panel p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}
