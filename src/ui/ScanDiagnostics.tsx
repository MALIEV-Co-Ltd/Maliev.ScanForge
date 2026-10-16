import { ScanToolIcon } from "./ScanToolIcon";
import type { Positions } from "../types";
import { useEffect, useState } from "react";
import { cachedTopologySummary } from "../scan-topology-summary";
import { SCAN_TOPOLOGY_TOLERANCE } from "../scan-topology-tolerance";
import {
  observeScanDiagnostics,
  watchScanDiagnostics,
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
  const [requested, setRequested] = useState<{ positions: Positions }>();
  useEffect(
    () =>
      watchScanDiagnostics(positions, (state) =>
        setResult(state ? { positions, state } : undefined),
      ),
    [positions],
  );

  useEffect(
    () =>
      requested?.positions === positions
        ? observeScanDiagnostics(positions, (state) =>
            setResult({ positions, state }),
          )
        : undefined,
    [positions, requested],
  );
  const state = result?.positions === positions ? result.state : undefined;
  const topology =
    state?.phase === "ready"
      ? state.topology
      : cachedTopologySummary(positions, SCAN_TOPOLOGY_TOLERANCE);
  return (
    <div
      className="scan-diagnostics"
      role="group"
      aria-label="Mesh editing"
      aria-busy={state?.phase === "pending"}
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
              (state?.phase === "error"
                ? "Unavailable"
                : state?.phase === "pending"
                  ? "Calculating…"
                  : "Not calculated")}
          </output>
          <button
            disabled={!onEdit}
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => onEdit?.(section)}
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            Edit…
          </button>
        </div>
      ))}
      {!topology && state?.phase !== "pending" && (
        <button
          className="scan-diagnostics-calculate"
          type="button"
          onClick={() => setRequested({ positions })}
        >
          Calculate mesh information
        </button>
      )}
      {state && state.phase !== "ready" && (
        <small role="status">
          {state?.phase === "error"
            ? state.message
            : state?.phase === "pending"
              ? state.progress
              : "Calculating mesh topology…"}
        </small>
      )}
    </div>
  );
}
