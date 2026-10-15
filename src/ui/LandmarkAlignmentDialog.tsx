import { AppSelect } from "./AppSelect";
import { PreviewButton } from "./PreviewButton";
import type { Entity } from "../types";
import {
  landmarkPairs,
  landmarkPreviewControls,
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
  const controls = landmarkPreviewControls(session);
  return (
    <aside className="inspector tool-panel" aria-label="N-points alignment">
      <h2>Align by N points</h2>
      <div className="tool-panel-content">
        <p>
          Moving scan: <strong>{session.moving.name}</strong>
        </p>
        <label className="select-field">
          Fixed target (optional)
          <AppSelect
            aria-label="Fixed alignment target"
            value={session.fixed?.id ?? ""}
            disabled={busy || !!session.preview}
            onChange={(e) => onTarget(e.target.value)}
          >
            <option value="">All visible references</option>
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
            <option value="fixed" disabled={!session.fixed}>
              Fixed target only
            </option>
          </AppSelect>
        </label>
        {session.moving.indexedMesh && (
          <p>
            {landmarkTargetEntities(session).length
              ? `${landmarkTargetEntities(session).length} refinement targets`
              : "No refinement surfaces. Matching points will determine alignment."}
          </p>
        )}
        {session.moving.kind === "pointcloud" && (
          <p>Matching points determine point-cloud alignment.</p>
        )}
        <p>
          Pick at least three matching pairs, spread across the scans. Fixed
          points can come from any visible reference. Choose a fixed target to
          filter canvas picking to that object.
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
          <button disabled={busy || !controls.canRemove} onClick={onRemoveLast}>
            Remove last point
          </button>
          <button disabled={busy || !controls.canRemove} onClick={onRemoveAll}>
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
        <button disabled={busy || !controls.canReset} onClick={onReset}>
          Reset
        </button>
        <PreviewButton
          disabled={busy || !controls.canPreview}
          onClick={onPreview}
        />
        <button disabled={busy || !session.preview} onClick={onAccept}>
          OK
        </button>
        <button onClick={onCancel}>Cancel</button>
      </footer>
    </aside>
  );
}
