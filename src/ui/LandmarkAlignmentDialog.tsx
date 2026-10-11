import type { Entity } from "../types";
import { landmarkPairs, type LandmarkAlignment } from "../landmark-alignment";

export interface LandmarkAlignmentDialogProps {
  session: LandmarkAlignment;
  targets: Entity[];
  busy: boolean;
  pickSide: "moving" | "fixed";
  onPickSide: (side: "moving" | "fixed") => void;
  onTarget: (id: string) => void;
  onRemoveLast: () => void;
  onRemoveAll: () => void;
  onPreview: () => void;
  onAccept: () => void;
  onCancel: () => void;
}
export function LandmarkAlignmentDialog({
  session,
  targets,
  busy,
  pickSide,
  onPickSide,
  onTarget,
  onRemoveLast,
  onRemoveAll,
  onPreview,
  onAccept,
  onCancel,
}: LandmarkAlignmentDialogProps) {
  const pairs = landmarkPairs(session);
  const complete =
    pairs.moving.length >= 3 && pairs.moving.length === pairs.fixed.length;
  return (
    <aside className="inspector" aria-label="N-points alignment">
      <h2>Align by N points</h2>
      <p>
        Moving scan: <strong>{session.moving.name}</strong>
      </p>
      <label className="select-field">
        Fixed target
        <select
          aria-label="Fixed alignment target"
          value={session.fixed.id}
          disabled={busy}
          onChange={(e) => onTarget(e.target.value)}
        >
          {targets.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        Click matching points on each object in the same order. Pick at least
        three pairs, spread across the objects.
      </p>
      <div className="button-row">
        <button
          disabled={busy}
          aria-pressed={pickSide === "moving"}
          onClick={() => onPickSide("moving")}
        >
          Pick moving points
        </button>
        <button
          disabled={busy}
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
        <button disabled={busy || !session.picks.length} onClick={onRemoveLast}>
          Remove last point
        </button>
        <button disabled={busy || !session.picks.length} onClick={onRemoveAll}>
          Remove all points
        </button>
      </div>
      {session.preview?.registration && (
        <p role="status">
          Preview RMS: {session.preview.registration.rms.toPrecision(4)} mm.
          Source geometry is unchanged until OK.
        </p>
      )}
      <div className="button-row">
        <button disabled={busy || !complete} onClick={onPreview}>
          Preview
        </button>
        <button disabled={busy || !session.preview} onClick={onAccept}>
          OK
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </aside>
  );
}
