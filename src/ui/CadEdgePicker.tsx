import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { CadInspection } from "../cad/client";
import { runApplicationJobCommand } from "./application-job-command";
import { CadJobCancel } from "./CadJobCancel";

type EdgeReport = CadInspection & { inspectedRevision: number };
export function CadEdgePicker({
  entityId,
  api,
  indices,
  onChange,
  disabled,
}: {
  entityId: string;
  api: Pick<ApplicationApi, "invoke" | "currentRevision">;
  indices: number[];
  onChange: (indices: number[], revision: number) => void;
  disabled: boolean;
}) {
  const [report, setReport] = useState<EdgeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      const run = controller.current;
      controller.current = null;
      run?.abort();
    },
    [entityId, api],
  );
  async function inspect(offset = 0) {
    controller.current?.abort();
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setError("");
    try {
      const next = (await runApplicationJobCommand(
        api,
        "cad_inspect",
        { entityId, edgeOffset: offset, edgeLimit: 32 },
        {
          readOnly: true,
          signal: run.signal,
          cancelledMessage: "Edge inspection cancelled.",
          leaseMessage: "Edge inspection exceeded its time limit.",
        },
      )) as unknown as EdgeReport;
      if (!run.signal.aborted) {
        if (!next.edgeReferences || !Number.isInteger(next.inspectedRevision))
          throw Error("Edge inspection returned no revision-fenced page.");
        setReport(next);
        onChange(indices, next.inspectedRevision);
      }
    } catch (failure) {
      if (!run.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Edge inspection failed.",
        );
    } finally {
      if (controller.current === run) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const page = report?.edgeReferences;
  const stale = !!report && report.inspectedRevision !== api.currentRevision();
  return (
    <section aria-label="Exact CAD edge references">
      <button disabled={disabled || busy} onClick={() => void inspect()}>
        Inspect CAD edges
      </button>
      {busy && (
        <CadJobCancel
          label="Cancel edge inspection"
          onCancel={() => controller.current?.abort()}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {stale && (
        <p role="status">
          Edge references changed. Inspect CAD edges again before applying.
        </p>
      )}
      {page && (
        <>
          <p>
            Edges {page.offset + 1}–{page.offset + page.items.length} of{" "}
            {page.total}. Coordinates and lengths are in mm. Endpoints follow
            curve parameter order; bounds include kernel tolerance.
          </p>
          <div
            role="group"
            aria-label="Discovered CAD edges"
            style={{ maxHeight: 280, overflowY: "auto" }}
          >
            {page.items.map((edge) => (
              <label key={edge.index} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  aria-label={`Edge ${edge.index} ${edge.kind}`}
                  checked={indices.includes(edge.index)}
                  disabled={disabled || busy || stale || edge.degenerate}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...new Set([...indices, edge.index])]
                        : indices.filter((i) => i !== edge.index),
                      report!.inspectedRevision,
                    )
                  }
                />
                Edge {edge.index}: {edge.kind}, {edge.lengthMm.toPrecision(7)}{" "}
                mm
                {edge.degenerate ? " (degenerate)" : ""}
                {edge.endpoints && (
                  <small style={{ display: "block" }}>
                    Endpoints:{" "}
                    {edge.endpoints
                      .map(
                        (p) =>
                          `(${p.map((v) => Number(v.toPrecision(7))).join(", ")})`,
                      )
                      .join(" → ")}
                  </small>
                )}
                {edge.boundsMm && (
                  <small style={{ display: "block" }}>
                    Bounds: (
                    {edge.boundsMm.min
                      .map((v) => Number(v.toPrecision(7)))
                      .join(", ")}
                    ) – (
                    {edge.boundsMm.max
                      .map((v) => Number(v.toPrecision(7)))
                      .join(", ")}
                    )
                  </small>
                )}
              </label>
            ))}
          </div>
          <button
            disabled={disabled || busy || page.offset === 0}
            onClick={() => void inspect(Math.max(0, page.offset - 32))}
          >
            Previous edges
          </button>
          <button
            disabled={disabled || busy || page.nextOffset === null}
            onClick={() => void inspect(page.nextOffset!)}
          >
            Next edges
          </button>
        </>
      )}
    </section>
  );
}
