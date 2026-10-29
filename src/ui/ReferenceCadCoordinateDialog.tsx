import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type {
  CadReferenceCoordinateSelection,
  CadReferenceFeatureFamily,
  CadReferenceFeatureRow,
} from "../cad/client";
import type { Entity, Vec3 } from "../types";
import { isSampledScan } from "../scan-source";
import { decodeReferenceGeometry } from "../reference-construction-values";
import { AppSelect } from "./AppSelect";

type Coordinate = {
  entityId: string;
  position: Vec3;
  revision: number;
  acquisitionJobId?: string;
};
type FeaturePage = {
  entityId: string;
  sourceRevision: number;
  total: number;
  nextOffset: number | null;
  rows: CadReferenceFeatureRow[];
};
type OwnedRequest = {
  controller: AbortController;
  jobId?: string;
  closeWhenSettled?: boolean;
};

export function ReferenceCadCoordinateDialog({
  api,
  entities,
  pickSurface,
  onPick,
  onCancel,
}: {
  api: ApplicationApi;
  entities: Entity[];
  pickSurface?(signal: AbortSignal, entityId: string): Promise<Coordinate>;
  onPick(value: Coordinate & { acquisitionJobId: string }): void;
  onCancel(): void;
}) {
  const sources = entities.filter(
    (source) =>
      source.visible &&
      !source.locked &&
      source.selectable !== false &&
      (source.kernelId
        ? !!source.brep
        : source.kind === "mesh" && !isSampledScan(source.scanSource)),
  );
  const [sourceId, setSourceId] = useState(() => sources[0]?.id ?? "");
  const source = sources.find((row) => row.id === sourceId);
  const [family, setFamily] = useState<CadReferenceFeatureFamily>("vertices");
  const [page, setPage] = useState<FeaturePage>();
  const [featureIndex, setFeatureIndex] = useState<number>();
  const [edgeLocation, setEdgeLocation] = useState<
    "start" | "end" | "fraction"
  >("start");
  const [fraction, setFraction] = useState<number | undefined>(0.5);
  const [busy, setBusy] = useState(false);
  const [surfacePicking, setSurfacePicking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<OwnedRequest | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = active.current;
      request?.controller.abort();
      if (request?.jobId)
        void api.invoke("job_cancel", { jobId: request.jobId });
    };
  }, [api]);

  async function job<T>(
    request: OwnedRequest,
    command: string,
    args: Record<string, unknown>,
  ): Promise<{ jobId: string; result: T }> {
    request.controller.signal.throwIfAborted();
    const admission = await api.invoke(command, args);
    if (!admission.ok) throw Error(admission.error.message);
    const { jobId } = admission.result as { jobId: string };
    if (!jobId) throw Error("Coordinate query did not return an owned job.");
    request.jobId = jobId;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      void api.invoke("job_cancel", { jobId });
    };
    request.controller.signal.addEventListener("abort", cancel, {
      once: true,
    });
    if (request.controller.signal.aborted) cancel();
    try {
      const expires = Date.now() + 95_000;
      while (Date.now() < expires) {
        const receipt = await api.invoke("job_get", { jobId });
        if (!receipt.ok) throw Error(receipt.error.message);
        const row = receipt.result as {
          status: string;
          result?: T;
          error?: { message: string };
        };
        if (row.status !== "running") {
          request.controller.signal.throwIfAborted();
          if (row.status !== "succeeded" || row.result === undefined)
            throw Error(row.error?.message ?? "Coordinate query cancelled.");
          return { jobId, result: row.result };
        }
        // Cancellation waits for the owned shared job to settle before leaving.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      cancel();
      throw Error(
        "Coordinate query timed out. Cancellation was requested; wait for the job to finish before retrying.",
      );
    } finally {
      request.controller.signal.removeEventListener("abort", cancel);
    }
  }

  async function run(work: (request: OwnedRequest) => Promise<void>) {
    if (active.current) return;
    const request: OwnedRequest = { controller: new AbortController() };
    active.current = request;
    setBusy(true);
    setError("");
    try {
      await work(request);
    } catch (failure) {
      if (mounted.current && !request.controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current === request) active.current = undefined;
      if (mounted.current) {
        setBusy(false);
        setSurfacePicking(false);
        if (request.closeWhenSettled) onCancel();
      }
    }
  }

  function cancel() {
    const request = active.current;
    if (request) {
      request.closeWhenSettled = true;
      setClosing(true);
      request.controller.abort();
    } else onCancel();
  }

  useEffect(() => {
    if (!surfacePicking) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [surfacePicking]);

  async function load(offset: number) {
    if (!source) return;
    const entityId = source.id;
    const revision = api.currentRevision();
    await run(async (request) => {
      const { result } = await job<FeaturePage>(
        request,
        "reference_construction_features",
        { entityId, family, offset, limit: 50 },
      );
      request.controller.signal.throwIfAborted();
      if (
        result.entityId !== entityId ||
        result.sourceRevision !== revision ||
        api.currentRevision() !== revision
      )
        throw Error("The source changed. Load its features again.");
      if (mounted.current) {
        setPage(result);
        setFeatureIndex(undefined);
      }
    });
  }

  const feature = page?.rows.find((row) => row.index === featureIndex);
  async function acquire() {
    if (!source || !page || !feature?.eligible || family === "faces") return;
    const entityId = source.id;
    const revision = page.sourceRevision;
    let selection: CadReferenceCoordinateSelection;
    if (family === "vertices")
      selection = { kind: "vertex", vertexIndex: feature.index };
    else if (edgeLocation === "fraction") {
      if (
        fraction === undefined ||
        !Number.isFinite(fraction) ||
        fraction < 0 ||
        fraction > 1
      ) {
        setError("Enter a curve parameter fraction from 0 to 1.");
        return;
      }
      selection = {
        kind: "edge-fraction",
        edgeIndex: feature.index,
        fraction,
      };
    } else
      selection = {
        kind: "edge-endpoint",
        edgeIndex: feature.index,
        endpoint: edgeLocation,
      };
    await run(async (request) => {
      if (api.currentRevision() !== revision)
        throw Error("The source changed. Load its features again.");
      const { jobId, result } = await job<{
        entityId: string;
        sourceRevision: number;
        positionEncoding: Parameters<typeof decodeReferenceGeometry>[0];
      }>(request, "reference_construction_acquire", {
        entityId,
        selection,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
      });
      request.controller.signal.throwIfAborted();
      if (
        result.entityId !== entityId ||
        result.sourceRevision !== revision ||
        api.currentRevision() !== revision
      )
        throw Error("The source changed. Acquire the coordinate again.");
      const geometry = decodeReferenceGeometry(result.positionEncoding);
      if (geometry.kind !== "point")
        throw Error("Coordinate acquisition returned invalid geometry.");
      if (mounted.current)
        onPick({
          entityId,
          position: [...geometry.position],
          revision,
          acquisitionJobId: jobId,
        });
    });
  }

  async function surface() {
    if (!source || !pickSurface) return;
    const entityId = source.id;
    await run(async (request) => {
      setSurfacePicking(true);
      const result = await pickSurface(request.controller.signal, entityId);
      request.controller.signal.throwIfAborted();
      if (
        result.entityId !== entityId ||
        !result.acquisitionJobId ||
        result.revision !== api.currentRevision()
      )
        throw Error("The surface pick is unavailable or stale. Pick again.");
      if (mounted.current)
        onPick({ ...result, acquisitionJobId: result.acquisitionJobId });
    });
  }

  if (surfacePicking)
    return (
      <section
        className="modal"
        data-reference-coordinate-pick="true"
        role="dialog"
        aria-label="Pick source surface coordinate"
        style={{ position: "fixed", right: 16, top: 160, zIndex: 60 }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <h2>Pick source surface</h2>
        <p>
          Click a visible surface of {source?.name}. The whole source is
          searched.
        </p>
        <button autoFocus disabled={closing} onClick={cancel}>
          {closing ? "Cancelling..." : "Cancel picking"}
        </button>
      </section>
    );

  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose CAD or mesh coordinate"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <h2>Choose a reference coordinate</h2>
        <p>
          World coordinates in millimeters. The chosen coordinate is copied into
          the numeric form.
        </p>
        <fieldset
          disabled={busy || closing}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <label className="select-field">
            Source object
            <AppSelect
              aria-label="Coordinate source"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setFamily("vertices");
                setPage(undefined);
                setFeatureIndex(undefined);
                setError("");
              }}
            >
              <option value="">Select a source</option>
              {sources.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </AppSelect>
          </label>
          {!sources.length && (
            <p>
              No visible, unlocked exact CAD or original mesh sources are
              available.
            </p>
          )}
          <label className="select-field">
            Features
            <AppSelect
              aria-label="Coordinate feature family"
              value={family}
              onChange={(event) => {
                setFamily(event.target.value as CadReferenceFeatureFamily);
                setPage(undefined);
                setFeatureIndex(undefined);
                setError("");
              }}
            >
              <option value="vertices">Vertices</option>
              <option value="edges" disabled={!source?.kernelId}>
                Edges
              </option>
              <option value="faces" disabled={!source?.kernelId}>
                Faces
              </option>
            </AppSelect>
          </label>
          <button disabled={!source} onClick={() => void load(0)}>
            Load features
          </button>
          {page && (
            <>
              <p>
                {page.total} {family} · showing {page.rows.length}
              </p>
              <label className="select-field">
                Feature
                <AppSelect
                  aria-label="Coordinate feature"
                  value={featureIndex === undefined ? "" : String(featureIndex)}
                  onChange={(event) =>
                    setFeatureIndex(
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                    )
                  }
                >
                  <option value="">Select a feature</option>
                  {page.rows.map((row) => (
                    <option
                      key={row.index}
                      value={String(row.index)}
                      disabled={!row.eligible}
                    >
                      {family === "vertices"
                        ? "Vertex"
                        : family === "edges"
                          ? "Edge"
                          : "Face"}{" "}
                      {row.index}
                      {row.reason ? ` (${row.reason})` : ""}
                    </option>
                  ))}
                </AppSelect>
              </label>
              {feature?.position && (
                <p>Source XYZ: {feature.position.join(", ")} mm</p>
              )}
              {family === "edges" && feature && (
                <>
                  <p>
                    Curve parameters: {feature.firstParameter} to{" "}
                    {feature.lastParameter}
                  </p>
                  <label className="select-field">
                    Curve location
                    <AppSelect
                      aria-label="Curve coordinate location"
                      value={edgeLocation}
                      onChange={(event) =>
                        setEdgeLocation(
                          event.target.value as typeof edgeLocation,
                        )
                      }
                    >
                      <option value="start">Start endpoint</option>
                      <option value="end">End endpoint</option>
                      <option value="fraction">Parameter fraction</option>
                    </AppSelect>
                  </label>
                  {edgeLocation === "fraction" && (
                    <label>
                      Parameter fraction (0–1)
                      <input
                        aria-label="Curve parameter fraction"
                        type="number"
                        min="0"
                        max="1"
                        step="any"
                        value={fraction ?? ""}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          setFraction(
                            Number.isFinite(value) ? value : undefined,
                          );
                        }}
                      />
                      <span>Fraction of the curve parameter interval.</span>
                    </label>
                  )}
                </>
              )}
              {family === "faces" && feature && (
                <p>
                  Face {feature.faceIndex ?? feature.index}:{" "}
                  {feature.triangleCount ?? 0} surface triangles. Surface
                  picking searches the whole source.
                </p>
              )}
              {family !== "faces" && (
                <button
                  disabled={!feature?.eligible}
                  onClick={() => void acquire()}
                >
                  {family === "vertices"
                    ? "Use vertex coordinate"
                    : "Use curve coordinate"}
                </button>
              )}
              <div className="button-row">
                <button onClick={() => void load(0)}>First page</button>
                <button
                  disabled={page.nextOffset === null}
                  onClick={() => {
                    if (page.nextOffset !== null) void load(page.nextOffset);
                  }}
                >
                  Next page
                </button>
              </div>
            </>
          )}
          {pickSurface && (
            <button disabled={!source} onClick={() => void surface()}>
              Pick source surface
            </button>
          )}
        </fieldset>
        {busy && (
          <p role="status">
            {closing
              ? "Waiting for cancellation..."
              : "Resolving source coordinates..."}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button disabled={closing} onClick={cancel}>
          {closing ? "Cancelling..." : "Back to reference"}
        </button>
      </section>
    </div>
  );
}
