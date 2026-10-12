import { ScanToolIcon } from "./ScanToolIcon";
import type { Positions } from "../types";
import { useEffect, useState } from "react";
import {
  observeScanDiagnostics,
  type ScanDiagnostics as DiagnosticState,
} from "../scan-diagnostics";

export function ScanDiagnostics({
  positions,
  onEdit,
}: {
  positions: Positions;
  onEdit?: (section: "components" | "holes" | "boundaries") => void;
}) {
  const [result, setResult] = useState<{
    positions: Positions;
    state: DiagnosticState;
  }>();
  useEffect(
    () =>
      observeScanDiagnostics(positions, (state) =>
        setResult({ positions, state }),
      ),
    [positions],
  );
  const state = result?.positions === positions ? result.state : undefined;
  const topology = state?.phase === "ready" ? state.topology : undefined;
  return (
    <div
      className="scan-diagnostics"
      role="group"
      aria-label="Mesh editing"
      aria-busy={!state || state.phase === "pending"}
    >
      {[
        {
          label: "Individual meshes",
          section: "components" as const,
          value: topology?.components,
          help: "Connected components of the current mesh.",
        },
        {
          label: "Holes",
          section: "holes" as const,
          value: topology?.boundaryLoops,
          help: "Closed boundary loops; this includes existing open borders, not just accidental defects.",
        },
        {
          label: "Boundaries",
          section: "boundaries" as const,
          value: topology
            ? topology.boundaryLoops + topology.boundaryChains
            : undefined,
          help: "Closed loops and open chains of boundary edges.",
        },
      ].map(({ label, value, help, section }) => (
        <div key={label}>
          <span title={help}>
            <ScanToolIcon name={section} size={20} />
            {label}
          </span>
          <output aria-label={`${label} count`} title={help}>
            {value?.toLocaleString() ??
              (state?.phase === "error" ? "Unavailable" : "Calculating…")}
          </output>
          <button
            disabled={!topology || !onEdit}
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => onEdit?.(section)}
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            Edit…
          </button>
        </div>
      ))}
      <small role="status">
        {state?.phase === "error"
          ? state.message
          : state?.phase === "pending"
            ? state.progress
            : topology
              ? "Current geometry · 0.001 mm vertex weld tolerance"
              : "Calculating mesh topology…"}
      </small>
    </div>
  );
}
