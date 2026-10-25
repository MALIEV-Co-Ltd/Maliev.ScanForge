import { useState } from "react";
import type { ApplicationApi } from "../automation/api";
import type { Entity, Vec3 } from "../types";
import { referenceLineEnd } from "../reference-construction-values";
import { VectorField } from "./controls";
import { AppSelect } from "./AppSelect";
import { isStoredReferenceLine } from "../reference-midpoint";

export function ReferenceConstructionDialog({
  api,
  kind,
  finiteAxis = false,
  entity,
  entities = [],
  onClose,
}: {
  api: ApplicationApi;
  kind: "point" | "line";
  finiteAxis?: boolean;
  entity?: Entity;
  entities?: Entity[];
  onClose(): void;
}) {
  const geometry = entity?.reference?.geometry;
  const definition = entity?.reference?.definition;
  const [pointMode, setPointMode] = useState<"coordinates" | "midpoint">(
    definition?.kind === "point" && definition.mode === "center"
      ? "midpoint"
      : "coordinates",
  );
  const sources = entities.filter(isStoredReferenceLine);
  const [sourceEntityId, setSourceEntityId] = useState(
    definition?.kind === "point" && definition.mode === "center"
      ? (definition.sources[0]?.id ?? "")
      : (sources[0]?.id ?? ""),
  );
  const [start, setStart] = useState<Vec3>(() =>
    geometry?.kind === "point"
      ? [...geometry.position]
      : geometry
        ? [...geometry.start]
        : [0, 0, 0],
  );
  const [end, setEnd] = useState<Vec3>(() =>
    geometry?.kind === "line" ? [...referenceLineEnd(geometry)] : [10, 0, 0],
  );
  const [session, setSession] = useState<{
    sessionId: string;
    version: number;
  }>();
  const [dirty, setDirty] = useState(true),
    [busy, setBusy] = useState(false),
    [closing, setClosing] = useState(false),
    [error, setError] = useState("");
  async function command(action: "preview" | "apply" | "cancel") {
    if (action === "cancel" && !session) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      let owner = session;
      if (owner && action !== "apply") {
        const receipt = await api.invoke("reference_construction_get", {});
        if (!receipt.ok) throw new Error(receipt.error.message);
        const current = receipt.result as {
          active: boolean;
          sessionId?: string;
          version?: number;
          cleanupPending?: boolean;
        };
        if (
          current.sessionId !== owner.sessionId ||
          (!current.active && !current.cleanupPending)
        ) {
          owner = undefined;
          setSession(undefined);
          setClosing(false);
          if (action === "cancel") {
            onClose();
            return;
          }
        } else if (action === "cancel" && current.version !== undefined) {
          owner = { sessionId: owner.sessionId, version: current.version };
        } else if (current.cleanupPending) {
          setClosing(true);
          throw new Error(
            "The preview could not be closed. Retry closing it before continuing.",
          );
        }
      }
      const result = await api.invoke("reference_construct", {
        action,
        ...owner,
        ...(action === "preview"
          ? {
              kind,
              ...(kind === "point"
                ? pointMode === "midpoint"
                  ? { mode: "midpoint", sourceEntityId }
                  : { position: start }
                : { start, end }),
              ...(!owner && entity ? { entityId: entity.id } : {}),
              ...(!owner && !entity && finiteAxis
                ? { name: "Reference axis" }
                : {}),
            }
          : {}),
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.error.message);
      if (action === "preview") {
        const { sessionId, version } = result.result as {
          sessionId: string;
          version: number;
        };
        setSession({ sessionId, version });
        setDirty(false);
      } else if (
        action === "apply" &&
        (result.result as { cleanupPending?: boolean }).cleanupPending
      ) {
        setClosing(true);
        setDirty(true);
        setError(
          "The reference was applied, but its preview could not be closed. Retry closing the preview.",
        );
      } else onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
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
        aria-label={
          finiteAxis ? "Reference axis (finite)" : `Reference ${kind}`
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            void command("cancel");
          }
        }}
      >
        <div className="modal-title">
          <h2>
            {entity ? "Edit" : "Create"} reference{" "}
            {finiteAxis ? "axis (finite)" : kind}
          </h2>
        </div>
        <p>
          {finiteAxis
            ? "A finite directed line in world millimeters. Its start and end define the axis direction and extent."
            : "World coordinates in millimeters."}
        </p>
        {kind === "point" && (
          <label className="select-field">
            Point construction
            <AppSelect
              value={pointMode}
              onChange={(event) => {
                setPointMode(event.target.value as "coordinates" | "midpoint");
                setDirty(true);
              }}
            >
              <option value="coordinates">Coordinates</option>
              <option value="midpoint">Line midpoint</option>
            </AppSelect>
          </label>
        )}
        {kind === "point" && pointMode === "midpoint" ? (
          <label className="select-field">
            Source line
            <AppSelect
              value={sourceEntityId}
              onChange={(event) => {
                setSourceEntityId(event.target.value);
                setDirty(true);
              }}
            >
              <option value="">Select a stored reference line</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </AppSelect>
          </label>
        ) : (
          <VectorField
            label={kind === "point" ? "Position" : "Start"}
            value={start}
            onChange={(value) => {
              setStart(value);
              setDirty(true);
            }}
          />
        )}
        {kind === "line" && (
          <VectorField
            label="End"
            value={end}
            onChange={(value) => {
              setEnd(value);
              setDirty(true);
            }}
          />
        )}
        {error && <p role="alert">{error}</p>}
        <p className="muted">
          Preview expires after 60 seconds. Apply adds one history step.
        </p>
        <div className="button-row">
          <button
            disabled={busy || closing}
            onClick={() => void command("preview")}
          >
            Preview
          </button>
          <button
            disabled={busy || closing || !session || dirty}
            onClick={() => void command("apply")}
          >
            Apply
          </button>
          <button disabled={busy} onClick={() => void command("cancel")}>
            {closing ? "Retry closing preview" : "Cancel"}
          </button>
        </div>
      </section>
    </div>
  );
}
