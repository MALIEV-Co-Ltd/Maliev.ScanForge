import { useState } from "react";
import { GeneratedIcon } from "./GeneratedIcon";
import "./ViewportTools.css";
type ViewportIconKind =
  "normals" | "flat" | "smooth" | "grid" | "snap" | "selection" | "all";
function ViewportIcon({ kind }: { kind: ViewportIconKind }) {
  return (
    <GeneratedIcon
      asset={`viewport-${kind}`}
      size={26}
      data-viewport-icon={kind}
    />
  );
}
export function ViewportTools(props: {
  flat: boolean;
  grid: boolean;
  spacing: number;
  automatic: boolean;
  onAutomatic: (value: boolean) => void;
  snap: boolean;
  hasSelection: boolean;
  normals?: boolean;
  onNormals?: (value: boolean) => void;
  onFlat: (value: boolean) => void;
  onGrid: (value: boolean) => void;
  onSpacing: (value: number) => void;
  onSnap: (value: boolean) => void;
  onFitSelection: () => void;
  onFitAll: () => void;
}) {
  const [settings, setSettings] = useState(false);
  return (
    <div className="viewport-tools-container">
      <div
        className="viewport-tools"
        role="toolbar"
        aria-label="Viewport tools"
      >
        <div className="viewport-tool-group" role="group" aria-label="Shading">
          <button
            aria-label="Normals"
            title="Normals: grey front faces, red back faces"
            aria-pressed={!!props.normals}
            onClick={() => props.onNormals?.(!props.normals)}
          >
            <ViewportIcon kind="normals" />
          </button>
          <button
            aria-label="Flat shading"
            title="Flat shading"
            aria-pressed={props.flat}
            onClick={() => props.onFlat(true)}
          >
            <ViewportIcon kind="flat" />
          </button>
          <button
            aria-label="Smooth shading"
            title="Smooth shading"
            aria-pressed={!props.flat}
            onClick={() => props.onFlat(false)}
          >
            <ViewportIcon kind="smooth" />
          </button>
        </div>
        <span
          className="viewport-tool-separator"
          role="separator"
          aria-orientation="vertical"
        />
        <div
          className="viewport-tool-group"
          role="group"
          aria-label="Grid and snapping"
        >
          <button
            aria-label="Show floor grid"
            title="Show floor grid"
            aria-pressed={props.grid}
            onClick={() => props.onGrid(!props.grid)}
          >
            <ViewportIcon kind="grid" />
          </button>
          <button
            aria-label="Grid and snap settings"
            title="Grid spacing and sketch snapping"
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            <ViewportIcon kind="snap" />
          </button>
        </div>
        <span
          className="viewport-tool-separator"
          role="separator"
          aria-orientation="vertical"
        />
        <div className="viewport-tool-group" role="group" aria-label="Fit view">
          <button
            aria-label="Fit selection"
            title="Fit selected triangles or selected object"
            disabled={!props.hasSelection}
            onClick={props.onFitSelection}
          >
            <ViewportIcon kind="selection" />
          </button>
          <button
            aria-label="Fit all objects"
            title="Fit all visible objects"
            onClick={props.onFitAll}
          >
            <ViewportIcon kind="all" />
          </button>
        </div>
      </div>
      {settings && (
        <section
          className="viewport-grid-settings"
          aria-label="Grid and snap settings"
        >
          <label>
            <input
              type="checkbox"
              checked={props.automatic}
              onChange={(e) => props.onAutomatic(e.target.checked)}
            />
            Automatic grid spacing
          </label>
          <label>
            Manual grid / snap spacing (mm)
            <input
              aria-label="Grid spacing (mm)"
              type="number"
              min="0.001"
              max="1000000"
              step="any"
              value={props.spacing}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (
                  Number.isFinite(value) &&
                  value >= 0.001 &&
                  value <= 1000000
                )
                  props.onSpacing(value);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.snap}
              onChange={(e) => props.onSnap(e.target.checked)}
            />
            Snap sketch points to grid
          </label>
          <p>
            Automatic display spacing follows model size. Sketch snapping uses
            the manual spacing and sketch origin.
          </p>
          <button onClick={() => setSettings(false)}>
            Close grid settings
          </button>
        </section>
      )}
    </div>
  );
}
