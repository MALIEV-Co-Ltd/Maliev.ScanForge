import { useId, useState } from "react";
import "./ViewportTools.css";

function ViewportIcon({
  kind,
}: {
  kind: "flat" | "smooth" | "grid" | "selection" | "all" | "snap";
}) {
  const gradient = useId();
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
      data-viewport-icon={kind}
    >
      {kind === "flat" && (
        <>
          <path
            d="m12 2 9 5-2 12-7 3-8-5L3 7z"
            fill="var(--icon-gold-dark)"
            stroke="var(--icon-gold-edge)"
          />
          <path d="m3 7 9-5 3 9z" fill="var(--icon-gold-light)" />
          <path d="m3 7 12 4-11 6z" fill="var(--icon-gold-mid)" />
          <path d="m15 11 6-4-2 12-7 3z" fill="var(--icon-gold-dark)" />
          <path
            d="m12 2 3 9-3 11M3 7l12 4 6-4M4 17l11-6 4 8"
            stroke="var(--icon-gold-line)"
          />
        </>
      )}
      {kind === "smooth" && (
        <>
          <defs>
            <radialGradient id={gradient} cx="32%" cy="26%" r="75%">
              <stop stopColor="var(--icon-gold-light)" />
              <stop offset="0.45" stopColor="var(--icon-gold-mid)" />
              <stop offset="1" stopColor="var(--icon-gold-dark)" />
            </radialGradient>
          </defs>
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill={`url(#${gradient})`}
            stroke="var(--icon-gold-edge)"
          />
          <path
            d="M5 8c1-3 4-4 7-4"
            stroke="var(--icon-highlight)"
            strokeLinecap="round"
          />
        </>
      )}
      {(kind === "grid" || kind === "snap") && (
        <>
          <path
            d="m2 15 10-7 10 7-10 7z"
            fill="var(--icon-grid-fill)"
            stroke="var(--icon-grid-edge)"
          />
          <path
            d="m5.3 12.7 10 7m-6.7-9.3 10 7M5.3 17.3l10-7m-6.7 9.3 10-7"
            stroke="var(--icon-grid-line)"
          />
          {kind === "snap" && (
            <>
              <path d="M12 2v7M8.5 5.5h7" stroke="var(--icon-snap-fill)" />
              <circle
                cx="12"
                cy="9"
                r="2.1"
                fill="var(--icon-snap-fill)"
                stroke="var(--icon-gold-edge)"
              />
            </>
          )}
        </>
      )}
      {(kind === "selection" || kind === "all") && (
        <>
          <path
            d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4"
            stroke="var(--icon-grid-edge)"
            strokeLinecap="round"
          />
          {kind === "selection" ? (
            <>
              <path
                d="m8 8 7-2 3 7-7 5-5-5z"
                fill="var(--icon-gold-dark)"
                stroke="var(--icon-gold-edge)"
              />
              <path
                d="m8 8 3 10 4-12m-9 7 12 0"
                stroke="var(--icon-gold-line)"
              />
            </>
          ) : (
            <>
              <path
                d="m6 10 4-2 4 2v5l-4 2-4-2z"
                fill="var(--icon-gold-dark)"
                stroke="var(--icon-gold-edge)"
              />
              <path
                d="m14 6 3-2 3 2v5l-3 2-3-2z"
                fill="var(--icon-grid-fill)"
                stroke="var(--icon-grid-edge)"
              />
              <path
                d="m6 10 4 2 4-2m-4 2v5m4-11 3 2 3-2m-3 2v5"
                stroke="var(--icon-detail)"
              />
            </>
          )}
        </>
      )}
    </svg>
  );
}
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
        <div className="viewport-tool-group" role="group" aria-label="Shading">
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
