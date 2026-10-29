import { useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { Entity, Vec3 } from "../types";
import { VectorField } from "./controls";

export function DatumConstructionDialog({
  api,
  entity,
  kind = entity?.kind === "referenceFrame" ? "frame" : "plane",
  onClose,
}: {
  api: ApplicationApi;
  entity?: Entity;
  kind?: "plane" | "frame";
  onClose(): void;
}) {
  const [draftRevision] = useState(() => api.currentRevision());
  const title = kind === "frame" ? "coordinate system" : "reference plane";
  const stored = entity?.coordinateFrame
    ? {
        center: entity.coordinateFrame.frame.origin,
        normal: entity.coordinateFrame.frame.normal,
        tangent: entity.coordinateFrame.frame.u,
      }
    : entity?.planeFrame;
  const [origin, setOrigin] = useState<Vec3>(() =>
    stored ? [...stored.center] : [0, 0, 0],
  );
  const [normal, setNormal] = useState<Vec3>(() =>
    stored ? [...stored.normal] : [0, 0, 1],
  );
  const [xDirection, setXDirection] = useState<Vec3>(() =>
    stored ? [...stored.tangent] : [1, 0, 0],
  );
  const [size, setSize] = useState(() =>
    entity?.coordinateFrame
      ? entity.coordinateFrame.displaySize
      : entity?.planeFrame?.displaySize !== undefined
        ? entity.planeFrame.displaySize
        : entity
          ? Math.hypot(
              ...[0, 1, 2].map(
                (i) => entity.positions[i + 3] - entity.positions[i],
              ),
            )
          : 100,
  );
  const [name, setName] = useState(
    kind === "frame" ? "Coordinate system" : "Reference plane",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const result = await api.invoke("datum_construct", {
        kind,
        origin,
        normal,
        xDirection,
        displaySize: size,
        ...(entity ? { entityId: entity.id } : { name }),
        expectedRevision: draftRevision,
        requestId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.error.message);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="datum-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id="datum-title">{`${entity ? "Edit" : "Create"} ${title}`}</h2>
        {!entity && (
          <label className="field">
            Name
            <input
              aria-label="Datum name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <VectorField label="Origin (mm)" value={origin} onChange={setOrigin} />
        <VectorField label="Normal" value={normal} onChange={setNormal} />
        <VectorField
          label="X direction"
          value={xDirection}
          onChange={setXDirection}
        />
        <label className="field">
          {kind === "frame" ? "Axis length (mm)" : "Display size (mm)"}
          <input
            aria-label="Datum display size"
            type="number"
            min="0"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            disabled={busy}
          />
        </label>
        <p className="muted">
          {kind === "frame"
            ? "A detached right-handed coordinate system. The normal defines Z; the X direction preserves rotation about Z."
            : "A detached reference plane. Its normal and X direction define the orientation for new sketches."}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="import-unit-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={() => void apply()} disabled={busy}>
            {busy ? "Applying..." : "Apply"}
          </button>
        </div>
      </section>
    </div>
  );
}
