import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { Entity } from "../types";
import {
  inspectGlobalAlignmentCandidates,
  normalizeGlobalSearchTolerance,
} from "../global-alignment-input";
import type { GlobalAlignmentPreviewState } from "../automation/global-alignment-operations";

const metric = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toPrecision(5)
    : "Unavailable";

export function GlobalAlignmentDiagnostics({
  state,
  entities,
}: {
  state: GlobalAlignmentPreviewState;
  entities: Entity[];
}) {
  if (state.state !== "preview") return null;
  return (
    <section aria-label="Global alignment diagnostics">
      <p role="status">Preview ready · originals and history unchanged.</p>
      {state.expiresAt && (
        <p className="muted">Preview expires at {state.expiresAt}.</p>
      )}
      {state.converged === false && (
        <p role="alert">
          Alignment did not converge. Inspect the preview and scan diagnostics
          before choosing Apply anyway.
        </p>
      )}
      {state.outer && <p>{state.outer.passes} refinement passes</p>}
      {state.outer?.states.map((scan) => (
        <section
          key={scan.id}
          aria-label={`Diagnostics for ${entities.find((entity) => entity.id === scan.id)?.name ?? scan.id}`}
        >
          <strong>
            {entities.find((entity) => entity.id === scan.id)?.name ?? scan.id}
          </strong>
          <dl>
            <dt>Mean distance (mm)</dt>
            <dd>{metric(scan.mean)}</dd>
            <dt>Coverage (%)</dt>
            <dd>{metric(scan.coveragePercent)}</dd>
            <dt>Stable</dt>
            <dd>
              {scan.stable === undefined
                ? "Unavailable"
                : scan.stable
                  ? "Yes"
                  : "No"}
            </dd>
            <dt>Converged</dt>
            <dd>
              {scan.converged === undefined
                ? "Unavailable"
                : scan.converged
                  ? "Yes"
                  : "No"}
            </dd>
          </dl>
        </section>
      ))}
    </section>
  );
}

/** Uses the same versioned operations and cached preview as MCP. */
export function GlobalAlignmentTools({
  api,
  entities,
  onClose,
}: {
  api: ApplicationApi;
  entities: Entity[];
  onClose: () => void;
}) {
  const [state, setState] = useState<GlobalAlignmentPreviewState>({
    state: "idle",
    entityIds: [],
  });
  const [searchTolerance, setSearchTolerance] = useState("0.5");
  const [parallel, setParallel] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const disposed = useRef(false);
  const lifecycle = useRef(0);
  const activeApi = useRef(api);
  activeApi.current = api;
  const ownedJob = useRef<{
    jobId: string;
    generation: number;
    api: ApplicationApi;
  } | null>(null);
  const cancelling = useRef(false);
  const invoke = useCallback(
    async (command: string, args: Record<string, unknown> = {}) => {
      const response = await api.invoke(command, {
        ...args,
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!response.ok) throw new Error(response.error.message);
      return response.result;
    },
    [api],
  );
  const cancel = useCallback(async () => {
    if (cancelling.current) return;
    const generation = lifecycle.current;
    const active = () =>
      !disposed.current &&
      lifecycle.current === generation &&
      activeApi.current === api;
    cancelling.current = true;
    setError("");
    try {
      await invoke("global_alignment_cancel");
      if (active()) {
        ownedJob.current = null;
        onClose();
      }
    } catch (failure) {
      if (active())
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active()) cancelling.current = false;
    }
  }, [api, invoke, onClose]);
  useEffect(() => {
    disposed.current = false;
    setPending(false);
    setError("");
    setState({ state: "idle", entityIds: [] });
    cancelling.current = false;
    const generation = lifecycle.current;
    const active = () =>
      !disposed.current &&
      lifecycle.current === generation &&
      activeApi.current === api;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await api.invoke("global_alignment_state", {});
        if (!response.ok) throw new Error(response.error.message);
        if (active()) {
          const next = response.result as GlobalAlignmentPreviewState;
          setState(next);
          if (next.settings) {
            setSearchTolerance(String(next.settings.searchTolerance));
            setParallel(next.settings.parallel);
          }
        }
      } catch (failure) {
        if (active())
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (active()) timer = setTimeout(() => void refresh(), 1000);
      }
    };
    void refresh();
    return () => {
      disposed.current = true;
      ++lifecycle.current;
      clearTimeout(timer);
      const owned = ownedJob.current;
      if (owned?.generation === generation) {
        ownedJob.current = null;
        void owned.api
          .invoke("global_alignment_cancel", {
            jobId: owned.jobId,
            expectedRevision: owned.api.currentRevision(),
            requestId: crypto.randomUUID(),
          })
          .then((response) => {
            if (!response.ok) throw new Error(response.error.message);
          })
          .catch((failure) =>
            console.error("Global alignment cleanup failed", failure),
          );
      }
    };
  }, [api, invoke]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void cancel();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [cancel]);
  async function preview() {
    const generation = lifecycle.current;
    const active = () =>
      !disposed.current &&
      lifecycle.current === generation &&
      activeApi.current === api;
    setPending(true);
    setError("");
    try {
      let result = (await invoke("global_alignment_preview", {
        searchTolerance: Number(searchTolerance),
        parallel,
      })) as GlobalAlignmentPreviewState & { jobId?: string };
      if (result.jobId) {
        const jobId = result.jobId;
        if (!active()) {
          await invoke("global_alignment_cancel", { jobId });
          return;
        }
        ownedJob.current = { jobId, generation, api };
        const expires = Date.now() + 10 * 60_000;
        while (active() && !cancelling.current) {
          const response = await api.invoke("job_get", {
            jobId,
          });
          if (!response.ok) throw new Error(response.error.message);
          const job = response.result as {
            status: string;
            result?: GlobalAlignmentPreviewState;
            error?: { message: string };
          };
          if (job.status !== "running") {
            if (job.status !== "succeeded")
              throw new Error(
                job.error?.message ?? "Global alignment cancelled.",
              );
            result = job.result!;
            break;
          }
          if (Date.now() >= expires) {
            await invoke("global_alignment_cancel", { jobId });
            throw new Error("Global alignment exceeded its time limit.");
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      if (active() && !cancelling.current) setState(result);
    } catch (failure) {
      if (active())
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active()) setPending(false);
    }
  }
  async function apply() {
    if (!state.previewId) return;
    const generation = lifecycle.current;
    const active = () =>
      !disposed.current &&
      lifecycle.current === generation &&
      activeApi.current === api;
    setPending(true);
    setError("");
    try {
      await invoke("global_alignment_apply", { previewId: state.previewId });
      if (active()) {
        ownedJob.current = null;
        onClose();
      }
    } catch (failure) {
      if (active())
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active()) setPending(false);
    }
  }
  const candidates = inspectGlobalAlignmentCandidates(entities);
  const eligible = candidates.entityIds;
  const reasons = [...candidates.blocked, ...candidates.excluded];
  const staged = state.state === "preview";
  const displayedTargets = state.state === "idle" ? eligible : state.entityIds;
  const busy = pending || state.state === "preparing";
  let validTolerance = searchTolerance.trim() !== "";
  try {
    normalizeGlobalSearchTolerance(Number(searchTolerance));
  } catch {
    validTolerance = false;
  }
  return (
    <aside
      className="inspector tool-panel global-alignment-panel"
      aria-label="Global fine align"
    >
      <h2>Global fine align</h2>
      <div className="tool-panel-content">
        <p>
          Refine all visible raw meshes together. Preview preserves originals;
          Apply records one history step.
        </p>
        <p className="muted">
          Point clouds and CAD objects are not supported by this command.
        </p>
        <fieldset disabled={busy || staged}>
          <legend>Visible targets · {displayedTargets.length}</legend>
          <ul>
            {entities.map((entity) => (
              <li key={entity.id}>
                {entity.name}
                {displayedTargets.includes(entity.id)
                  ? " · Included"
                  : ` · ${reasons.find((item) => item.id === entity.id)?.reason ?? "Not included in preview"}`}
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Search tolerance (mm)</span>
            <input
              type="number"
              step="any"
              value={searchTolerance}
              onChange={(event) => setSearchTolerance(event.target.value)}
            />
          </label>
          <p className="muted">Negative values use their absolute distance.</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={parallel}
              onChange={(event) => setParallel(event.target.checked)}
            />
            Use multiple CPU cores
          </label>
        </fieldset>
        {(eligible.length < 2 || eligible.length > 32) && (
          <p role="alert">Choose 2–32 visible, unlocked raw meshes.</p>
        )}
        {candidates.blocked.map((item) => (
          <p role="alert" key={item.id}>
            {entities.find((entity) => entity.id === item.id)?.name ?? item.id}:{" "}
            {item.reason}
          </p>
        ))}
        {!validTolerance && (
          <p role="alert">
            Search tolerance must be a finite distance within the supported
            range.
          </p>
        )}
        {busy && <p role="status">Preparing global alignment…</p>}
        {error && <p role="alert">{error}</p>}
        <GlobalAlignmentDiagnostics state={state} entities={entities} />
        <div className="global-alignment-actions">
          <button
            disabled={
              busy || staged || !validTolerance || !candidates.canPreview
            }
            onClick={() => void preview()}
          >
            Preview
          </button>
          <button
            disabled={busy || !staged || !state.previewId}
            onClick={() => void apply()}
          >
            {state.converged === false ? "Apply anyway" : "Apply"}
          </button>
          <button onClick={() => void cancel()}>Cancel / close</button>
        </div>
      </div>
    </aside>
  );
}
