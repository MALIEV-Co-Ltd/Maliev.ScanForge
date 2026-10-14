import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import { buildDatumAlignment, type DatumInstruction } from "../datum-alignment";
import { nativeDatumTranslationFromPoint } from "../scan-native-datum-picked-translation";
import type { Entity, Vec3 } from "../types";
import { Panel, VectorField } from "./controls";
import { DatumReferencePicker } from "./DatumReferencePicker";
import type { AlignmentReferencePage } from "../automation/alignment-operations";
import {
  nativeDatumOriginPayload,
  type NativeDatumOriginReference,
} from "../scan-native-datum-origin";

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
  const [translationPoint, setTranslationPoint] = useState<Vec3>();
  const [parallel, setParallel] = useState(true);
  const [targetIds, setTargetIds] = useState<string[]>([entity.id]);
  async function includeDependents() {
    setBusy(true);
    setError("");
    try {
      const response = await api.invoke("alignment_targets", {
        entityIds: targetIds,
      });
      if (!response.ok) throw new Error(response.error.message);
      const result = response.result as {
        entityIds: string[];
        blocked: { entityId: string; reason: string }[];
        exceedsTargetLimit: boolean;
      };
      if (result.exceedsTargetLimit)
        throw new Error(
          "Dependent targets exceed the 32-object alignment limit.",
        );
      if (result.blocked.length)
        throw new Error(
          result.blocked
            .map(
              (item) =>
                `${entities.find((entity) => entity.id === item.entityId)?.name ?? item.entityId}: ${item.reason}`,
            )
            .join(" "),
        );
      if (heldPreview.current) {
        const discarded = await discard();
        if (!discarded.ok) throw new Error(discarded.error.message);
      }
      heldPreview.current = false;
      setPreview(false);
      setTargetIds(result.entityIds);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }
  const targets = entities.filter(
    (item) =>
      !item.locked &&
      item.positions.length &&
      (item.kernelId ||
        (!item.parametric && ["mesh", "pointcloud"].includes(item.kind))),
  );
  const validTargets =
    targetIds.length > 0 &&
    targetIds.every((id) => targets.some((item) => item.id === id));
  const [requiredReferences, setRequiredReferences] = useState<boolean[]>([]);
  const [referenceAcceptance, setReferenceAcceptance] = useState<boolean[]>([]);
  const [originReferences, setOriginReferences] = useState<
    (NativeDatumOriginReference | undefined)[]
  >([]);
  const [bindings, setBindings] = useState<
    ({ entityId: string; referenceId: string } | undefined)[]
  >([]);
  const [instructions, setInstructions] = useState<DatumInstruction[]>([
    { kind: "point", point: [0, 0, 0], axis: 0 },
    { kind: "plane", point: [0, 0, 0], direction: [0, 0, 1], axis: 2 },
    { kind: "direction", point: [0, 0, 0], direction: [1, 0, 0], axis: 0 },
  ]);
  useEffect(() => {
    if (!translationPoint) return;
    try {
      const frame = buildDatumAlignment(instructions.slice(0, count));
      setTranslation(
        nativeDatumTranslationFromPoint(
          frame.accepted ? frame.state.matrix : undefined,
          translationPoint,
        ) as Vec3,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [translationPoint, instructions, count]);
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
    setTargetIds([entity.id]);
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
      setOriginReferences((current) =>
        current.map((item, i) => (i === index ? undefined : item)),
      );
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
    setInstructions((current) => {
      const next = current.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      );
      if (patch.kind) {
        try {
          const options = buildDatumAlignment(next.slice(0, index + 1))
            .referenceOptions[index];
          if (options.visible.some(Boolean) && options.enabled.some(Boolean))
            next[index] = { ...next[index], axis: options.axis };
        } catch {
          /* Incomplete numeric input is reported by Preview. */
        }
      }
      return next;
    });
  }
  async function run(command: "alignment_preview" | "alignment_apply") {
    setBusy(true);
    setError("");
    try {
      const receipt = await api.invoke(command, {
        entityIds: targetIds,
        constraints: instructions.slice(0, count).map((item, index) =>
          originReferences[index]
            ? {
                kind: "origin",
                reference: originReferences[index],
                axis: item.axis,
                flip: item.flip,
              }
            : bindings[index]
              ? {
                  kind: "reference",
                  ...bindings[index],
                  axis: item.axis,
                  flip: item.flip,
                }
              : item,
        ),
        translation,
        ...(translationPoint ? { translationPoint } : {}),
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
          result?: { translation?: number[]; referenceAcceptance?: boolean[] };
        };
        if (job.status !== "running") {
          if (job.status !== "succeeded")
            throw new Error(job.error?.message ?? "Alignment cancelled.");
          heldPreview.current = command === "alignment_preview";
          if (job.result?.translation?.length === 3)
            setTranslation([...job.result.translation] as Vec3);
          setReferenceAcceptance(job.result?.referenceAcceptance ?? []);
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
        onClick={() => {
          setTargetIds([entity.id]);
          setOpen(true);
        }}
      >
        Align object to origin / references
      </button>
    );
  return (
    <Panel title="Coordinate alignment">
      <p className="muted">
        Build a frame from up to three references. Preview preserves the model;
        Apply records one history step.
      </p>
      {entity.surfaceScanId && (
        <p className="muted" data-source-scan-id={entity.surfaceScanId}>
          Source scan:{" "}
          {entities.find((item) => item.id === entity.surfaceScanId)?.name ??
            entity.surfaceScanId}
        </p>
      )}
      {!entity.parametric && entity.authoringLinks && (
        <p
          className="muted"
          data-authoring-feature-id={entity.authoringLinks.featureId}
        >
          Referenced objects:{" "}
          {entity.authoringLinks.references
            .map((id) => entities.find((item) => item.id === id)?.name ?? id)
            .join(", ") || "None"}
        </p>
      )}
      <fieldset disabled={busy}>
        <button
          type="button"
          disabled={!validTargets}
          onClick={() => void includeDependents()}
        >
          Include dependent features
        </button>
        {targets.length > 1 && (
          <fieldset>
            <legend>Objects to move · {targetIds.length} selected</legend>
            {targets.map((item) => (
              <label className="check-row" key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Move ${item.name}`}
                  checked={targetIds.includes(item.id)}
                  disabled={
                    !targetIds.includes(item.id) && targetIds.length >= 32
                  }
                  onChange={(event) => {
                    if (heldPreview.current) void discard();
                    heldPreview.current = false;
                    setPreview(false);
                    setTargetIds((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    );
                  }}
                />
                {item.name}
              </label>
            ))}
          </fieldset>
        )}
        {!validTargets && (
          <p role="alert">
            Choose at least one available, unlocked object to move.
          </p>
        )}
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
        {instructions.slice(0, count).map((item, index) => {
          let enabledAxes: boolean[] | undefined;
          try {
            enabledAxes = buildDatumAlignment(instructions.slice(0, index + 1))
              .referenceOptions[index].enabledAxes;
          } catch {
            /* Keep editing available while numeric input is incomplete. */
          }
          return (
            <fieldset key={index}>
              <legend>{["Primary", "Secondary", "Tertiary"][index]}</legend>
              <label className="field">
                <span>Origin reference</span>
                <select
                  aria-label={`Reference ${index + 1} origin reference`}
                  value={originReferences[index] ?? ""}
                  onChange={(event) => {
                    const reference = event.target.value as
                      NativeDatumOriginReference | "";
                    if (reference)
                      update(index, {
                        ...nativeDatumOriginPayload(reference),
                        flip: false,
                      });
                    else update(index, {});
                    setOriginReferences((current) => {
                      const next = [...current];
                      next[index] = reference || undefined;
                      return next;
                    });
                    setRequiredReferences((current) => {
                      const next = [...current];
                      next[index] = false;
                      return next;
                    });
                  }}
                >
                  <option value="">Manual / object reference</option>
                  {(["XY", "YZ", "XZ", "X", "Y", "Z", "origin"] as const).map(
                    (reference) => (
                      <option key={reference} value={reference}>
                        {reference === "origin"
                          ? "Origin point"
                          : `${reference} ${reference.length === 2 ? "plane" : "axis"}`}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {!originReferences[index] && (
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
              )}
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
                        <option
                          key={axis}
                          value={i}
                          disabled={enabledAxes?.[i] === false}
                        >
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
          );
        })}
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
            setTranslationPoint(undefined);
            if (heldPreview.current) {
              heldPreview.current = false;
              void discard();
            }
            setPreview(false);
            setError("");
            setTranslation(value);
          }}
        />
        <button
          onClick={() =>
            onPickPoint((point) => {
              if (heldPreview.current) {
                heldPreview.current = false;
                void discard();
              }
              setPreview(false);
              setError("");
              setTranslationPoint([...point]);
              onPickPoint(null);
            })
          }
        >
          Pick translation point on canvas
        </button>
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
      {preview && referenceAcceptance.some((accepted) => !accepted) && (
        <p role="status">
          References{" "}
          {referenceAcceptance
            .flatMap((accepted, index) => (accepted ? [] : [index + 1]))
            .join(", ")}{" "}
          did not constrain this frame.
        </p>
      )}
      <div className="display-row">
        <button
          disabled={
            busy ||
            !validTargets ||
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
            !validTargets ||
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
