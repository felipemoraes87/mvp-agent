type SimpleLineChartProps = {
  points: Array<{ label: string; value: number }>;
  stroke?: string;
};

export function SimpleLineChart({ points, stroke = "#6366f1" }: SimpleLineChartProps) {
  if (!points.length) {
    return <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-4 text-sm text-slate-400">Sem dados para exibir.</div>;
  }

  const width = 820;
  const height = 220;
  const padX = 36;
  const padY = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(1, ...points.map((point) => point.value));

  const getX = (index: number) => (points.length === 1 ? padX : padX + (index / (points.length - 1)) * innerW);
  const getY = (value: number) => padY + innerH - (value / max) * innerH;
  const path = points.map((point, index) => `${getX(index)},${getY(point.value)}`).join(" ");

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/35 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 min-w-[760px] w-full">
        <polyline fill="none" stroke={stroke} strokeWidth="3" points={path} />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={getX(index)} cy={getY(point.value)} r="3.5" fill={stroke} />
            {index % Math.max(1, Math.floor(points.length / 10)) === 0 ? (
              <text x={getX(index)} y={height - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {point.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
