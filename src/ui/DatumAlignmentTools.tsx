import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { DatumInstruction } from "../datum-alignment";
import type { Entity, Vec3 } from "../types";
import { Panel, VectorField } from "./controls";
import { DatumReferencePicker } from "./DatumReferencePicker";
import type { AlignmentReferencePage } from "../automation/alignment-operations";

export function DatumAlignmentTools({
  api,
  entity,
  center,
  entities,
  readReferences,
  onPickFace,
  onPickPoint,
}: {
  api: ApplicationApi;
  entity: Entity;
  center: Vec3;
  entities: Entity[];
  readReferences: (
    entityId: string,
    offset: number,
    signal: AbortSignal,
    triangleIndex?: number,
  ) => Promise<AlignmentReferencePage>;
  onPickFace: (
    callback: ((entityId: string, triangleIndex?: number) => void) | null,
  ) => void;
  onPickPoint: (callback: ((point: Vec3) => void) | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [count, setCount] = useState(1),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const [translation, setTranslation] = useState<Vec3>([0, 0, 0]);
  const [parallel, setParallel] = useState(true);
  const [requiredReferences, setRequiredReferences] = useState<boolean[]>([]);
  const [bindings, setBindings] = useState<
    ({ entityId: string; referenceId: string } | undefined)[]
  >([]);
  const [instructions, setInstructions] = useState<DatumInstruction[]>([
    { kind: "point", point: [0, 0, 0], axis: 0 },
    { kind: "plane", point: [0, 0, 0], direction: [0, 0, 1], axis: 2 },
    { kind: "direction", point: [0, 0, 0], direction: [1, 0, 0], axis: 0 },
  ]);
  const activeJob = useRef<string | null>(null),
    heldPreview = useRef(false),
    disposed = useRef(false);
  const discard = () =>
    api.invoke("preview_discard", {
      target: "datum",
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      onPickPoint(null);
      onPickFace(null);
      if (activeJob.current)
        void api.invoke("job_cancel", { jobId: activeJob.current });
      if (heldPreview.current) void discard();
    };
  }, [entity.id]);
  useEffect(() => {
    heldPreview.current = false;
    setPreview(false);
  }, [entity.positions]);
  function update(index: number, patch: Partial<DatumInstruction>) {
    if (patch.kind || patch.point || patch.direction)
      setBindings((current) =>
        current.map((item, i) => (i === index ? undefined : item)),
      );
    if (heldPreview.current) {
      heldPreview.current = false;
      void discard();
    }
    setPreview(false);
    setError("");
    setInstructions((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  async function run(command: "alignment_preview" | "alignment_apply") {
    setBusy(true);
    setError("");
    try {
      const receipt = await api.invoke(command, {
        entityIds: [entity.id],
        constraints: instructions.slice(0, count).map((item, index) =>
          bindings[index]
            ? {
                kind: "reference",
                ...bindings[index],
                axis: item.axis,
                flip: item.flip,
              }
            : item,
        ),
        translation,
        parallel,
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!receipt.ok) throw new Error(receipt.error.message);
      activeJob.current = (receipt.result as { jobId: string }).jobId;
      const expires = Date.now() + 95_000;
      while (Date.now() < expires) {
        if (disposed.current) return;
        const response = await api.invoke("job_get", {
          jobId: activeJob.current,
        });
        if (!response.ok) throw new Error(response.error.message);
        const job = response.result as {
          status: string;
          error?: { message: string };
        };
        if (job.status !== "running") {
          if (job.status !== "succeeded")
            throw new Error(job.error?.message ?? "Alignment cancelled.");
          heldPreview.current = command === "alignment_preview";
          setPreview(heldPreview.current);
          if (command === "alignment_apply") setOpen(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await api.invoke("job_cancel", { jobId: activeJob.current });
      throw new Error("Alignment exceeded its time limit.");
    } catch (failure) {
      if (!disposed.current)
        setError(
          failure instanceof Error ? failure.message : "Alignment failed.",
        );
    } finally {
      activeJob.current = null;
      if (!disposed.current) setBusy(false);
    }
  }
  async function cancel() {
    onPickPoint(null);
    onPickFace(null);
    if (activeJob.current)
      await api.invoke("job_cancel", { jobId: activeJob.current });
    await discard();
    heldPreview.current = false;
    setPreview(false);
    setOpen(false);
  }
  if (!open)
    return (
      <button
        className="wide"
        disabled={!!entity.locked}
        onClick={() => setOpen(true)}
      >
        Align scan to origin / references
      </button>
    );
  return (
    <Panel title="Coordinate alignment">
      <p className="muted">
        Build a frame from up to three references. Preview preserves the model;
        Apply records one history step.
      </p>
      <fieldset disabled={busy}>
        <label className="field">
          <span>References</span>
          <select
            aria-label="Alignment reference count"
            value={count}
            onChange={(event) => {
              void discard();
              heldPreview.current = false;
              setPreview(false);
              setCount(Number(event.target.value));
            }}
          >
            {[1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {instructions.slice(0, count).map((item, index) => (
          <fieldset key={index}>
            <legend>{["Primary", "Secondary", "Tertiary"][index]}</legend>
            <DatumReferencePicker
              entities={entities}
              index={index}
              value={bindings[index]}
              read={readReferences}
              onPickFace={onPickFace}
              onChange={(value, required) => {
                setRequiredReferences((current) => {
                  const next = [...current];
                  next[index] = required;
                  return next;
                });
                if (
                  value?.reference.point &&
                  value.reference.kind !== "unsupported"
                ) {
                  update(index, {
                    kind: value.reference.kind,
                    point: value.reference.point,
                    direction: value.reference.direction,
                    flip: false,
                  });
                } else update(index, {});
                setBindings((current) => {
                  const next = [...current];
                  next[index] = value
                    ? {
                        entityId: value.entityId,
                        referenceId: value.reference.id,
                      }
                    : undefined;
                  return next;
                });
              }}
            />
            <label className="field">
              <span>Type</span>
              <select
                aria-label={`Reference ${index + 1} type`}
                value={item.kind}
                onChange={(event) =>
                  update(index, {
                    kind: event.target.value as DatumInstruction["kind"],
                    direction: item.direction ?? [0, 0, 1],
                    flip: false,
                  })
                }
              >
                <option value="point">Point</option>
                <option value="plane">Plane</option>
                <option value="direction">Direction</option>
              </select>
            </label>
            <VectorField
              label={`Reference ${index + 1} point (mm)`}
              value={item.point as Vec3}
              onChange={(point) => update(index, { point })}
            />
            {item.kind !== "point" && (
              <>
                <VectorField
                  label={`Reference ${index + 1} direction`}
                  value={(item.direction ?? [0, 0, 1]) as Vec3}
                  onChange={(direction) => update(index, { direction })}
                />
                <label className="field">
                  <span>Target axis</span>
                  <select
                    aria-label={`Reference ${index + 1} target axis`}
                    value={item.axis}
                    onChange={(event) =>
                      update(index, {
                        axis: Number(event.target.value) as 0 | 1 | 2,
                      })
                    }
                  >
                    {["X", "Y", "Z"].map((axis, i) => (
                      <option key={axis} value={i}>
                        {axis}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!item.flip}
                    onChange={(event) =>
                      update(index, { flip: event.target.checked })
                    }
                  />
                  Flip reference direction
                </label>
              </>
            )}
            <button
              onClick={() => onPickPoint((point) => update(index, { point }))}
            >
              Pick reference point on canvas
            </button>
          </fieldset>
        ))}
        <button
          onClick={() =>
            update(0, { kind: "point", point: [...center], flip: false })
          }
        >
          Use scan center as origin
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <VectorField
          label="Frame translation (mm)"
          value={translation}
          onChange={(value) => {
            if (heldPreview.current) {
              heldPreview.current = false;
              void discard();
            }
            setPreview(false);
            setError("");
            setTranslation(value);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={parallel}
            onChange={(event) => {
              if (heldPreview.current) {
                heldPreview.current = false;
                void discard();
              }
              setPreview(false);
              setParallel(event.target.checked);
            }}
          />
          Use multiple CPU cores for large scans
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <p role="status">Alignment preview ready · model unchanged</p>
      )}
      <div className="display-row">
        <button
          disabled={
            busy ||
            requiredReferences.some(
              (required, index) =>
                index < count && required && !bindings[index],
            )
          }
          onClick={() => void run("alignment_preview")}
        >
          Preview alignment
        </button>
        <button
          disabled={
            busy ||
            !preview ||
            requiredReferences.some(
              (required, index) =>
                index < count && required && !bindings[index],
            )
          }
          onClick={() => void run("alignment_apply")}
        >
          Apply alignment
        </button>
        <button onClick={() => void cancel()}>Cancel alignment</button>
      </div>
    </Panel>
  );
}
