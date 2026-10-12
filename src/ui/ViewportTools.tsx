import { useState } from "react";
import { Box, Circle, Grid3X3, Focus, Maximize, Settings2 } from "lucide-react";
import "./ViewportTools.css";
export function ViewportTools(props: {
  flat: boolean;
  grid: boolean;
  spacing: number;
  snap: boolean;
  hasSelection: boolean;
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
        <button
          aria-label="Flat shading"
          title="Flat shading"
          aria-pressed={props.flat}
          onClick={() => props.onFlat(true)}
        >
          <Box size={18} />
        </button>
        <button
          aria-label="Smooth shading"
          title="Smooth shading"
          aria-pressed={!props.flat}
          onClick={() => props.onFlat(false)}
        >
          <Circle size={18} />
        </button>
        <button
          aria-label="Show floor grid"
          title="Show floor grid"
          aria-pressed={props.grid}
          onClick={() => props.onGrid(!props.grid)}
        >
          <Grid3X3 size={18} />
        </button>
        <button
          aria-label="Fit selection"
          title="Fit selected triangles or selected object"
          disabled={!props.hasSelection}
          onClick={props.onFitSelection}
        >
          <Focus size={18} />
        </button>
        <button
          aria-label="Fit all objects"
          title="Fit all visible objects"
          onClick={props.onFitAll}
        >
          <Maximize size={18} />
        </button>
        <button
          aria-label="Grid and snap settings"
          title="Grid and snap settings"
          aria-expanded={settings}
          onClick={() => setSettings(!settings)}
        >
          <Settings2 size={18} />
        </button>
      </div>
      {settings && (
        <section
          className="viewport-grid-settings"
          aria-label="Grid and snap settings"
        >
          <label>
            Grid spacing (mm)
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
          <p>Snapping uses the sketch plane’s origin and grid spacing.</p>
          <button onClick={() => setSettings(false)}>
            Close grid settings
          </button>
        </section>
      )}
    </div>
  );
}
