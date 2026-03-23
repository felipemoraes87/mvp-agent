import { type EdgeProps, getBezierPath } from "reactflow";

export function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const highlighted = Boolean((data as { highlighted?: boolean } | undefined)?.highlighted);
  const labelText = typeof label === "string" ? label : "";

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
      {labelText ? (
        <foreignObject
          x={labelX - 90}
          y={labelY - 18}
          width={180}
          height={40}
          style={{ overflow: "visible" }}
          requiredExtensions="http://www.w3.org/1999/xhtml"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                maxWidth: "180px",
                padding: "4px 8px",
                borderRadius: "999px",
                background: highlighted ? "rgba(99,102,241,0.18)" : "rgba(15,23,42,0.9)",
                border: highlighted ? "1px solid rgba(165,180,252,0.55)" : "1px solid rgba(71,85,105,0.9)",
                color: highlighted ? "#e0e7ff" : "#cbd5e1",
                fontSize: "10px",
                lineHeight: 1.2,
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {labelText}
            </div>
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}
