import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { Entity, Vec3 } from "../types";
import { runApplicationJobCommand } from "./application-job-command";

export function SurfaceTrimTools({
  entity,
  entities,
  api,
  onPickPoint,
  onError,
  disabled,
}: {
  entity: Entity;
  entities: Entity[];
  api: Pick<ApplicationApi, "invoke" | "currentRevision">;
  onPickPoint: (callback: ((point: Vec3) => void) | null) => void;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  const [cutters, setCutters] = useState<string[]>([]);
  const [points, setPoints] = useState("[]");
  const [tolerance, setTolerance] = useState(0.1);
  const [hideInputs, setHideInputs] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pointCallback = useRef(onPickPoint);
  const currentPoints = useRef(points);
  currentPoints.current = points;
  pointCallback.current = onPickPoint;
  useEffect(
    () => () => {
      pointCallback.current(null);
      controller.current?.abort();
    },
    [entity.id],
  );
  useEffect(() => {
    if (!picking) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        pointCallback.current(null);
        setPicking(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [picking]);
  function pick() {
    setPicking(true);
    onPickPoint((point) => {
      setPicking(false);
      try {
        const previous = JSON.parse(currentPoints.current);
        if (!Array.isArray(previous))
          throw Error("Retained points must be a JSON array.");
        setPoints(JSON.stringify([...previous, point]));
      } catch (failure) {
        onError(
          failure instanceof Error
            ? failure.message
            : "Correct the retained points first.",
        );
      }
    });
  }
  function cancel() {
    onPickPoint(null);
    setPicking(false);
    if (controller.current) controller.current.abort();
    else setPoints("[]");
  }
  async function apply() {
    const run = new AbortController();
    controller.current = run;
    onPickPoint(null);
    setPicking(false);
    setBusy(true);
    try {
      const reference = (id: string) => {
        const input = entities.find((item) => item.id === id);
        if (!input?.kernelId)
          throw Error(
            "A source or cutter is no longer available as exact CAD.",
          );
        return {
          featureId: input.parametric?.feature.id ?? input.id,
          output: input.parametric?.output ?? 0,
        };
      };
      const result = await runApplicationJobCommand(
        api,
        "cad_create",
        {
          name: `${entity.name} trimmed`,
          hideInputs,
          recipe: {
            kind: "trimSurfaces",
            source: reference(entity.id),
            cutters: cutters.map(reference),
            keepPoints: JSON.parse(points),
            toleranceMm: tolerance,
          },
        },
        {
          signal: run.signal,
          cancelledMessage: "Surface trim cancelled.",
          leaseMessage: "Surface trim exceeded its time limit.",
        },
      );
      if (run.signal.aborted) return;
      controller.current = null;
      const response = await api.invoke("object_select", {
        entityId: (result.entityIds as string[])[0],
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!response.ok) throw Error(response.error.message);
    } catch (failure) {
      if (!run.signal.aborted)
        onError(
          failure instanceof Error ? failure.message : "Surface trim failed.",
        );
    } finally {
      if (controller.current === run) controller.current = null;
      setBusy(false);
    }
  }
  const candidates = entities.filter(
    (item) => item.kernelId && item.id !== entity.id,
  );
  return (
    <section aria-label="Trim surfaces">
      <h3>Trim surfaces</h3>
      <p>
        Source: {entity.name}. Choose cutters, then pick inside each surface
        region to retain.
      </p>
      <fieldset disabled={disabled || busy}>
        <legend>Cutters</legend>
        {candidates.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={cutters.includes(item.id)}
              onChange={(event) =>
                setCutters((previous) =>
                  event.target.checked
                    ? [...previous, item.id]
                    : previous.filter((id) => id !== item.id),
                )
              }
            />
            {item.name}
          </label>
        ))}
        {!candidates.length && (
          <p>Add an intersecting CAD surface or solid first.</p>
        )}
      </fieldset>
      <button disabled={disabled || busy || picking} onClick={pick}>
        Pick retained region
      </button>
      {picking && (
        <p role="status">
          Click inside a source surface region. Escape cancels picking.
        </p>
      )}
      <label>
        Retained points (world mm)
        <textarea
          aria-label="Retained points (world mm)"
          value={points}
          maxLength={32768}
          disabled={disabled || busy}
          onChange={(event) => setPoints(event.target.value)}
        />
      </label>
      <label>
        Point tolerance (mm)
        <input
          type="number"
          min="0"
          max="1000000"
          step="any"
          value={tolerance}
          disabled={disabled || busy}
          onChange={(event) => setTolerance(Number(event.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={hideInputs}
          disabled={disabled || busy}
          onChange={(event) => setHideInputs(event.target.checked)}
        />
        Hide source and cutters on apply
      </label>
      <button
        disabled={
          disabled ||
          busy ||
          !cutters.length ||
          !points.trim() ||
          points.trim() === "[]" ||
          !(tolerance > 0)
        }
        onClick={() => void apply()}
      >
        Apply surface trim
      </button>
      <button onClick={cancel}>
        {busy ? "Cancel surface trim" : "Cancel trimming"}
      </button>
      <p className="muted">
        Retained regions stay exact CAD surfaces. Boundary points are ambiguous;
        use Split solid for volume cutting.
      </p>
    </section>
  );
}
