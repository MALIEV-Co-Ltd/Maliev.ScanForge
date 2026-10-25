import { useEffect, useRef, useState } from "react";
import { Panel } from "./controls";
import type { AlignmentReferencePage } from "../automation/alignment-operations";

export function AlignmentReferences({
  entityId,
  onRead,
}: {
  entityId: string;
  onRead: (
    offset: number,
    signal: AbortSignal,
  ) => Promise<AlignmentReferencePage>;
}) {
  const [page, setPage] = useState<AlignmentReferencePage | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [entityId]);
  async function load(offset = 0) {
    controller.current?.abort();
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setError("");
    try {
      const result = await onRead(offset, run.signal);
      if (run.signal.aborted) return;
      setPage(result);
      setSelectedId(
        result.references.find((item) => item.kind !== "unsupported")?.id ?? "",
      );
    } catch (failure) {
      if (!run.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not read alignment references.",
        );
    } finally {
      if (controller.current === run) setBusy(false);
    }
  }
  const selected = page?.references.find((item) => item.id === selectedId);
  const coordinates = (values: number[]) =>
    values.map((value) => Number(value.toFixed(6))).join(" · ");
  return (
    <Panel title="Alignment references">
      <button className="wide" disabled={busy} onClick={() => void load()}>
        Read alignment references
      </button>
      {busy && (
        <button className="wide" onClick={() => controller.current?.abort()}>
          Cancel reference inspection
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <p className="muted">{page.total} references · mm</p>
          {page.total === 0 && (
            <p>No supported alignment references on this object.</p>
          )}
          {page.references.length > 0 && (
            <label className="field">
              <span>Reference</span>
              <select
                aria-label="Alignment reference"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">Choose a reference</option>
                {page.references.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.kind === "unsupported"}
                  >
                    {item.source === "cadFace"
                      ? `Face ${(item.faceIndex ?? 0) + 1}`
                      : item.source === "referenceConstruction"
                        ? "Construction reference"
                        : "Fitted primitive"}{" "}
                    · {item.kind}
                    {item.surfaceKind && item.surfaceKind !== item.kind
                      ? ` (${item.surfaceKind})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected && (
            <dl
              data-reference-id={selected.id}
              data-reference-point={JSON.stringify(selected.point)}
              data-reference-direction={JSON.stringify(selected.direction)}
            >
              {selected.point && (
                <>
                  <dt>Point (mm)</dt>
                  <dd>{coordinates(selected.point)}</dd>
                </>
              )}
              {selected.direction && (
                <>
                  <dt>
                    {selected.kind === "plane" ? "Plane normal" : "Direction"}
                  </dt>
                  <dd>{coordinates(selected.direction)}</dd>
                </>
              )}
              {selected.length !== undefined && (
                <>
                  <dt>Length (mm)</dt>
                  <dd>{Number(selected.length.toFixed(6))}</dd>
                </>
              )}
            </dl>
          )}
          {page.references.some((item) => item.kind === "unsupported") && (
            <p className="muted">
              Unsupported surface types are listed but cannot be used as
              references yet.
            </p>
          )}
          {(page.offset > 0 || page.nextOffset !== null) && (
            <div className="display-row">
              <button
                disabled={busy || page.offset === 0}
                onClick={() => void load(Math.max(0, page.offset - 50))}
              >
                Previous references
              </button>
              <button
                disabled={busy || page.nextOffset === null}
                onClick={() => void load(page.nextOffset ?? 0)}
              >
                Next references
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
