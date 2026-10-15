import { AppSelect } from "./AppSelect";
import { PreviewButton } from "./PreviewButton";
import type { Entity } from "../types";
import {
  landmarkPairs,
  landmarkTargetEntities,
  type LandmarkAlignment,
  type LandmarkTargetScope,
} from "../landmark-alignment";

export interface LandmarkAlignmentDialogProps {
  session: LandmarkAlignment;
  targets: Entity[];
  busy: boolean;
  pickSide: "moving" | "fixed";
  onPickSide: (side: "moving" | "fixed") => void;
  onTarget: (id: string) => void;
  onTargetScope: (scope: LandmarkTargetScope) => void;
  onRemoveLast: () => void;
  onRemoveAll: () => void;
  onPreview: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onReset: () => void;
}
export function LandmarkAlignmentDialog({
  session,
  targets,
  busy,
  pickSide,
  onPickSide,
  onTarget,
  onTargetScope,
  onRemoveLast,
  onRemoveAll,
  onPreview,
  onAccept,
  onCancel,
  onReset,
}: LandmarkAlignmentDialogProps) {
  const pairs = landmarkPairs(session);
  const complete =
    pairs.moving.length >= 3 && pairs.moving.length === pairs.fixed.length;
  return (
    <aside className="inspector tool-panel" aria-label="N-points alignment">
      <h2>Align by N points</h2>
      <div className="tool-panel-content">
        <p>
          Moving scan: <strong>{session.moving.name}</strong>
        </p>
        <label className="select-field">
          Fixed target
          <AppSelect
            aria-label="Fixed alignment target"
            value={session.fixed.id}
            disabled={busy || !!session.preview}
            onChange={(e) => onTarget(e.target.value)}
          >
            {targets.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </AppSelect>
        </label>
        <label className="select-field">
          Refine against
          <AppSelect
            aria-label="Alignment refinement targets"
            value={session.targetScope ?? "fixed"}
            disabled={busy}
            onChange={(event) =>
              onTargetScope(event.target.value as LandmarkTargetScope)
            }
          >
            <option value="visibleScene">Visible scans and CAD</option>
            <option value="fixed">Fixed target only</option>
          </AppSelect>
        </label>
        {session.moving.indexedMesh && (
          <p>{landmarkTargetEntities(session).length} refinement targets</p>
        )}
        <p>
          Click matching points on each object in the same order. Pick at least
          three pairs, spread across the objects.
        </p>
        <div className="button-row">
          <button
            disabled={busy || !!session.preview}
            aria-pressed={pickSide === "moving"}
            onClick={() => onPickSide("moving")}
          >
            Pick moving points
          </button>
          <button
            disabled={busy || !!session.preview}
            aria-pressed={pickSide === "fixed"}
            onClick={() => onPickSide("fixed")}
          >
            Pick fixed points
          </button>
        </div>
        <div className="tool-section">
          <h3>Moving points (M)</h3>
          <ol aria-label="Moving landmarks">
            {pairs.moving.map((p, i) => (
              <li key={i}>
                M{i + 1}: {p.map((v) => v.toFixed(3)).join(", ")}
              </li>
            ))}
          </ol>
          <h3>Fixed points (F)</h3>
          <ol aria-label="Fixed landmarks">
            {pairs.fixed.map((p, i) => (
              <li key={i}>
                F{i + 1}: {p.map((v) => v.toFixed(3)).join(", ")}
              </li>
            ))}
          </ol>
        </div>
        <div className="button-row">
          <button
            disabled={busy || !!session.preview || !session.picks.length}
            onClick={onRemoveLast}
          >
            Remove last point
          </button>
          <button
            disabled={busy || !!session.preview || !session.picks.length}
            onClick={onRemoveAll}
          >
            Remove all points
          </button>
        </div>
        {session.preview?.registration && (
          <p role="status">
            Preview RMS: {session.preview.registration.rms.toPrecision(4)} mm.
            Source geometry is unchanged until OK.
          </p>
        )}
      </div>
      <footer className="tool-panel-actions">
        <button disabled={busy || !session.preview} onClick={onReset}>
          Reset
        </button>
        <PreviewButton disabled={busy || !complete} onClick={onPreview} />
        <button disabled={busy || !session.preview} onClick={onAccept}>
          OK
        </button>
        <button onClick={onCancel}>Cancel</button>
      </footer>
    </aside>
  );
}
