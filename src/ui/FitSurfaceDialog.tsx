import "./ToolPanel.css";
import { useState } from "react";
import type { SurfaceFitOptions } from "../surfaces";
import type { SurfaceFitSession } from "../surface-fit-session";

export function FitSurfaceDialog({
  session,
  busy,
  onApply,
  onAccept,
  onCancel,
}: {
  session: SurfaceFitSession;
  busy: boolean;
  onApply: (options: SurfaceFitOptions) => void;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const [u, setU] = useState(10),
    [v, setV] = useState(10);
  const [projection, setProjection] =
    useState<SurfaceFitOptions["projection"]>("xy");
  const [analysis, setAnalysis] = useState(false);
  const [changed, setChanged] = useState(false);
  const valid = [u, v].every((n) => Number.isInteger(n) && n >= 4 && n <= 16);
  return (
    <aside className="inspector tool-panel" aria-label="Fit Surface">
      <h2>Fit Surface</h2>
      <section className="tool-section tool-panel-content">
        <p>
          {session.source.name} · {session.triangles.toLocaleString()} selected
          triangles
        </p>
        <fieldset disabled={busy}>
          {(
            [
              ["U count", u, setU],
              ["V count", v, setV],
            ] as const
          ).map(([label, value, update]) => (
            <label className="field" key={label}>
              {label}
              <input
                type="number"
                min={4}
                max={16}
                value={value}
                onChange={(e) => {
                  update(Number(e.target.value));
                  setChanged(true);
                }}
              />
            </label>
          ))}
          <label className="field">
            Orientation
            <select
              value={projection}
              onChange={(e) => {
                setProjection(
                  e.target.value as SurfaceFitOptions["projection"],
                );
                setChanged(true);
              }}
            >
              <option value="xy">OXY</option>
              <option value="xz">OXZ</option>
              <option value="yz">OYZ</option>
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={analysis}
              onChange={(e) => setAnalysis(e.target.checked)}
            />
            Analysis
          </label>
        </fieldset>
        {session.preview && analysis && (
          <p role="status">
            Projected RMS {session.preview.rms.toPrecision(4)} mm · maximum{" "}
            {session.preview.maxError.toPrecision(4)} mm ·{" "}
            {session.preview.samples} samples
          </p>
        )}
        {changed && <p>Apply the changed options before accepting.</p>}
        <p className="muted">
          Preview leaves the scan unchanged. This fit currently supports
          axis-oriented height fields. Selection-bounds orientation, smoothness
          and automatic tolerance fitting remain unavailable.
        </p>
      </section>
      <footer className="tool-panel-actions">
        <button
          disabled={busy || !valid}
          onClick={() => {
            setChanged(false);
            onApply({
              countU: u,
              countV: v,
              degree: 3,
              projection,
              sampleLimit: 10000,
            });
          }}
        >
          Apply
        </button>
        <button
          disabled={busy || changed || !session.preview}
          onClick={onAccept}
        >
          OK
        </button>
        <button onClick={onCancel}>Cancel</button>
      </footer>
    </aside>
  );
}
