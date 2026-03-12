import { type EdgeProps, getBezierPath } from "reactflow";

export function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const highlighted = Boolean((data as { highlighted?: boolean } | undefined)?.highlighted);

  return (
    <g>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={highlighted ? "#a5b4fc" : "#64748b"}
        strokeWidth={highlighted ? 2.6 : 1.9}
        strokeLinecap="round"
        markerEnd={markerEnd}
        style={{
          opacity: highlighted ? 1 : 0.66,
          transition: "stroke 180ms ease, opacity 180ms ease",
          strokeDasharray: highlighted ? "0" : "3 4",
        }}
      />
    </g>
  );
}
