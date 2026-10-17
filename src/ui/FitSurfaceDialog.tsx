import { AppSelect } from "./AppSelect";
import "./ToolPanel.css";
import { useState } from "react";
import type { SurfaceFitOptions } from "../surfaces";
import type { SurfaceFitSession } from "../surface-fit-session";
import { nativeSurfaceWorkingSet } from "../native-surface-fitting";

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
  const [method, setMethod] = useState<"projected-grid" | "approximate">(
    "projected-grid",
  );
  const [regularizationWeight, setRegularizationWeight] = useState(0.0001);
  const [changed, setChanged] = useState(false);
  const valid = [u, v].every((n) => Number.isInteger(n) && n >= 4 && n <= 16);
  let approximationError = "";
  if (method === "approximate") {
    try {
      if (!Number.isFinite(regularizationWeight) || regularizationWeight < 0)
        throw new Error("Smoothing weight must be finite and nonnegative.");
      nativeSurfaceWorkingSet(u, v, Math.min(10000, session.scan.length / 3));
    } catch (error) {
      approximationError =
        error instanceof Error ? error.message : String(error);
    }
  }
  return (
    <aside className="inspector tool-panel" aria-label="Fit Surface">
      <h2>Fit Surface</h2>
      <section className="tool-section tool-panel-content">
        <p>
          {session.source.name} · {session.triangles.toLocaleString()} selected
          triangles
        </p>
        <fieldset disabled={busy}>
          <label className="field">
            Method
            <AppSelect
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as "projected-grid" | "approximate");
                setChanged(true);
              }}
            >
              <option value="projected-grid">Projected grid</option>
              <option value="approximate">Approximate</option>
            </AppSelect>
          </label>
          {method === "approximate" && (
            <label className="field">
              Smoothing weight
              <input
                type="number"
                min={0}
                step="any"
                value={regularizationWeight}
                onChange={(e) => {
                  setRegularizationWeight(Number(e.target.value));
                  setChanged(true);
                }}
              />
            </label>
          )}
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
            <AppSelect
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
            </AppSelect>
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
            {session.preview.method === "approximate" ? "Sample" : "Projected"}{" "}
            RMS {session.preview.rms.toPrecision(4)} mm · maximum{" "}
            {session.preview.maxError.toPrecision(4)} mm ·{" "}
            {session.preview.samples} samples
          </p>
        )}
        {changed && <p>Apply the changed options before accepting.</p>}
        {approximationError && <p role="alert">{approximationError}</p>}
        <p className="muted">
          Preview leaves the scan unchanged. Both methods use the chosen
          projection. Approximate fits and smooths all three coordinates.
          Selection-bounds orientation and automatic tolerance fitting remain
          unavailable.
        </p>
      </section>
      <footer className="tool-panel-actions">
        <button
          disabled={busy || !valid || Boolean(approximationError)}
          onClick={() => {
            setChanged(false);
            onApply({
              countU: u,
              countV: v,
              degree: 3,
              projection,
              sampleLimit: 10000,
              ...(method === "approximate"
                ? { method, regularizationWeight }
                : {}),
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
