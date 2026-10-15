import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppSelect } from "./AppSelect";
import { Kbd } from "./Kbd";
import type { InteractiveAlignmentStore } from "../interactive-alignment-store";
import "./InteractiveAlignmentDialog.css";

export interface InteractiveAlignmentDialogProps {
  store: InteractiveAlignmentStore;
  busy?: boolean;
  mirrorAvailable?: boolean;
  onEdit: (edit: Record<string, unknown>) => Promise<unknown>;
  onApply: () => Promise<unknown>;
  onCancel: () => Promise<unknown>;
}

/** All actions are supplied by the shared versioned application operations. */
export function InteractiveAlignmentDialog({
  store,
  busy = false,
  mirrorAvailable = false,
  onEdit,
  onApply,
  onCancel,
}: InteractiveAlignmentDialogProps) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [rotationAxis, setRotationAxis] = useState(2);
  const [translationAxis, setTranslationAxis] = useState(0);
  const [angle, setAngle] = useState(1);
  const [distance, setDistance] = useState(1);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelPending = useRef(false);
  const [error, setError] = useState("");
  const cancel = useCallback(async () => {
    if (cancelPending.current) return;
    cancelPending.current = true;
    setCancelling(true);
    setError("");
    try {
      await onCancel();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      cancelPending.current = false;
      setCancelling(false);
    }
  }, [onCancel]);
  useEffect(() => {
    if (!state) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.isComposing &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        event.stopPropagation();
        void cancel();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state?.sessionId, cancel]);
  if (!state) return null;
  const run = async (action: () => Promise<unknown>) => {
    if (pending || busy || cancelling) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const step = (rotation: boolean, positive: boolean) =>
    void run(() =>
      onEdit({
        action: "step",
        kind: rotation
          ? positive
            ? "rotatePositive"
            : "rotateNegative"
          : positive
            ? "translatePositive"
            : "translateNegative",
        axis: rotation ? rotationAxis : translationAxis,
        value: rotation ? angle : distance,
      }),
    );
  return (
    <aside
      className="inspector tool-panel interactive-alignment-panel"
      aria-label="Interactive alignment"
    >
      <h2>Interactive alignment</h2>
      <div className="tool-panel-content">
        <p className="interactive-tool-note">
          {state.entityIds.length}{" "}
          {state.entityIds.length === 1 ? "scan" : "scans"} selected
        </p>
        <p>
          Drag an axis, plane, or rotation ring to position the selected scans.
        </p>
        <p className="interactive-tool-note">
          <Kbd>Escape</Kbd> cancels without changing the scan.
        </p>
        <fieldset disabled={pending || busy || cancelling || state.applying}>
          <legend>Rotate about origin</legend>
          <label className="select-field">
            Axis
            <AppSelect
              aria-label="Rotation axis"
              value={rotationAxis}
              onChange={(e) => setRotationAxis(Number(e.target.value))}
            >
              {["X", "Y", "Z"].map((axis, i) => (
                <option key={axis} value={i}>
                  {axis}
                </option>
              ))}
            </AppSelect>
          </label>
          <label className="select-field">
            Angle (°)
            <input
              aria-label="Rotation step in degrees"
              type="number"
              step="any"
              value={angle}
              onChange={(e) => setAngle(e.target.valueAsNumber)}
            />
          </label>
          <div className="interactive-step-actions">
            <button
              disabled={!Number.isFinite(Math.fround(angle))}
              onClick={() => step(true, false)}
              aria-label="Rotate negative"
            >
              −
            </button>
            <button
              disabled={!Number.isFinite(Math.fround(angle))}
              onClick={() => step(true, true)}
              aria-label="Rotate positive"
            >
              +
            </button>
          </div>
        </fieldset>
        <fieldset disabled={pending || busy || cancelling || state.applying}>
          <legend>Translate</legend>
          <label className="select-field">
            Axis
            <AppSelect
              aria-label="Translation axis"
              value={translationAxis}
              onChange={(e) => setTranslationAxis(Number(e.target.value))}
            >
              {["X", "Y", "Z"].map((axis, i) => (
                <option key={axis} value={i}>
                  {axis}
                </option>
              ))}
            </AppSelect>
          </label>
          <label className="select-field">
            Distance (mm)
            <input
              aria-label="Translation step in millimeters"
              type="number"
              step="any"
              value={distance}
              onChange={(e) => setDistance(e.target.valueAsNumber)}
            />
          </label>
          <div className="interactive-step-actions">
            <button
              disabled={!Number.isFinite(Math.fround(distance))}
              onClick={() => step(false, false)}
              aria-label="Translate negative"
            >
              −
            </button>
            <button
              disabled={!Number.isFinite(Math.fround(distance))}
              onClick={() => step(false, true)}
              aria-label="Translate positive"
            >
              +
            </button>
          </div>
        </fieldset>
        <fieldset disabled={pending || busy || cancelling || state.applying}>
          <legend>Drag and preview</legend>
          <label className="select-field">
            Drag strength ({state.strength}%)
            <input
              aria-label="Interactive drag strength"
              type="range"
              min={0}
              max={100}
              step={1}
              value={state.strength}
              onChange={(e) =>
                void run(() =>
                  onEdit({
                    action: "configure",
                    strength: Number(e.target.value),
                  }),
                )
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={!mirrorAvailable}
              checked={state.mirror}
              onChange={(e) =>
                void run(() =>
                  onEdit({ action: "configure", mirror: e.target.checked }),
                )
              }
            />{" "}
            Mirror mesh preview
          </label>
          <label className="select-field">
            Mirror plane
            <AppSelect
              aria-label="Interactive mirror plane"
              disabled={!state.mirror || !mirrorAvailable}
              value={["XY", "YZ", "XZ"][state.mirrorPlane]}
              onChange={(e) =>
                void run(() =>
                  onEdit({ action: "configure", mirrorPlane: e.target.value }),
                )
              }
            >
              {["XY", "YZ", "XZ"].map((plane) => (
                <option key={plane}>{plane}</option>
              ))}
            </AppSelect>
          </label>
          <p className="interactive-tool-note">
            Mirror preview is a visual reference for meshes; point-cloud
            transforms remain available without mirroring.
          </p>
        </fieldset>
        <div className="interactive-step-actions">
          <button
            disabled={pending || busy || cancelling}
            onClick={() => void run(() => onEdit({ action: "currentView" }))}
          >
            As current view
          </button>
          <button
            disabled={pending || busy || cancelling}
            onClick={() => void run(() => onEdit({ action: "reset" }))}
          >
            Reset
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="interactive-step-actions interactive-dialog-actions">
        <button disabled={cancelling} onClick={() => void cancel()}>
          Cancel
        </button>
        <button
          className="accent"
          disabled={pending || busy || cancelling}
          onClick={() => void run(onApply)}
        >
          {pending ? "Working…" : "Apply"}
        </button>
      </div>
    </aside>
  );
}
