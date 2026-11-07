import { ScanToolIcon } from "./ScanToolIcon";
import type { IndexedMesh, Positions } from "../types";
import { useEffect, useState } from "react";
import { cachedTopologySummary } from "../scan-topology-summary";
import { SCAN_TOPOLOGY_TOLERANCE } from "../scan-topology-tolerance";
import { processMesh } from "../processing-client";
import {
  observeScanDiagnostics,
  watchScanDiagnostics,
  type ScanDiagnostics as DiagnosticState,
} from "../scan-diagnostics";

export function ScanDiagnostics({
  positions,
  sourceIndexed,
  onEdit,
}: {
  positions: Positions;
  sourceIndexed?: IndexedMesh;
  onEdit?: (section: "components" | "holes" | "boundaries") => void;
}) {
  const [result, setResult] = useState<{
    positions: Positions;
    state: DiagnosticState;
  }>();
  const [requested, setRequested] = useState<{ positions: Positions }>();
  const [componentRetry, setComponentRetry] = useState(0);
  const [componentCount, setComponentCount] = useState<{
    positions: Positions;
    sourceIndexed?: IndexedMesh;
    count?: number;
    error?: boolean;
  }>();
  const state = result?.positions === positions ? result.state : undefined;
  const topology =
    state?.phase === "ready"
      ? state.topology
      : cachedTopologySummary(positions, SCAN_TOPOLOGY_TOLERANCE);
  const needsComponentInventory =
    positions.length >= 9 &&
    (!!sourceIndexed || (topology?.degenerateTriangles ?? 0) > 0);
  useEffect(() => {
    if (!needsComponentInventory) return;
    const controller = new AbortController();
    setComponentCount({ positions, sourceIndexed });
    void processMesh(
      {
        kind: "scanEdit",
        action: "inventory",
        inventoryScope: "components",
        positions,
        sourceIndexed,
        tolerance: SCAN_TOPOLOGY_TOLERANCE,
      },
      { signal: controller.signal, reuseTopology: true },
    ).then(
      (result) => {
        if (!controller.signal.aborted)
          setComponentCount({
            positions,
            sourceIndexed,
            count: result.scanEdit?.inventory?.components.length,
            error: !result.scanEdit?.inventory,
          });
      },
      () => {
        if (!controller.signal.aborted)
          setComponentCount({ positions, sourceIndexed, error: true });
      },
    );
    return () => controller.abort();
  }, [positions, sourceIndexed, needsComponentInventory, componentRetry]);
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
  const indexedCount =
    componentCount?.positions === positions &&
    componentCount.sourceIndexed === sourceIndexed
      ? componentCount
      : undefined;
  return (
    <div
      className="scan-diagnostics"
      role="group"
      aria-label="Mesh editing"
      aria-busy={
        state?.phase === "pending" ||
        (needsComponentInventory &&
          indexedCount?.count === undefined &&
          !indexedCount?.error)
      }
    >
      {[
        {
          label: "Individual meshes",
          section: "components" as const,
          value: needsComponentInventory
            ? indexedCount?.count
            : topology?.components,
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
              ((section === "components" &&
                needsComponentInventory &&
                indexedCount?.error) ||
              state?.phase === "error"
                ? "Unavailable"
                : (section === "components" && needsComponentInventory) ||
                    state?.phase === "pending"
                  ? "Calculating…"
                  : "Not calculated")}
          </output>
          {section === "components" &&
          needsComponentInventory &&
          indexedCount?.error ? (
            <button
              type="button"
              aria-label="Retry component count"
              onClick={() => setComponentRetry((retry) => retry + 1)}
            >
              Retry
            </button>
          ) : (
            <button
              disabled={!onEdit}
              title={`Edit ${label.toLowerCase()}`}
              onClick={() => onEdit?.(section)}
              aria-label={`Edit ${label.toLowerCase()}`}
            >
              Edit…
            </button>
          )}
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
