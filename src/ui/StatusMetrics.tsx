import { useEffect, useState } from "react";
import "./StatusMetrics.css";

export function reportedHeapBytes(source: unknown): number | undefined {
  const value = (
    source as { memory?: { usedJSHeapSize?: unknown } } | undefined
  )?.memory?.usedJSHeapSize;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function StatusMetrics({
  facets,
  points,
  reference,
}: {
  facets?: number;
  points?: number;
  reference?: { points: number; lines: number };
}) {
  const [heap, setHeap] = useState(() =>
    reportedHeapBytes(globalThis.performance),
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setHeap(reportedHeapBytes(globalThis.performance)),
      5000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="status-metrics">
      <span
        title={
          reference
            ? "Semantic reference objects; no sampled mesh facets or scan points."
            : points !== undefined
              ? "Total scan points including hidden points."
              : "Total mesh facets of the selected object, including hidden facets. CAD objects show display tessellation facets."
        }
      >
        {reference
          ? reference.lines
            ? `Reference lines: ${reference.lines.toLocaleString()}`
            : `Reference points: ${reference.points.toLocaleString()}`
          : points !== undefined
            ? `Points: ${points.toLocaleString()}`
            : `Facets: ${facets === undefined ? "\u2014" : facets.toLocaleString()}`}
      </span>
      <span
        title={
          heap === undefined
            ? "This browser does not report JavaScript heap usage."
            : "Browser-reported JavaScript heap estimate, refreshed every 5 seconds. It is not total application RAM and may omit workers, CAD kernel and GPU memory."
        }
      >
        JS heap:{" "}
        {heap === undefined ? "—" : `${(heap / 1048576).toFixed(1)} MiB`}
      </span>
    </div>
  );
}
