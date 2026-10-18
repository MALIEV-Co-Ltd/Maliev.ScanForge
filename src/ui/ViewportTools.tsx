import { useState } from "react";
import "./ViewportTools.css";
const viewportArtwork = {
  normals: (
    <>
      <path d="m2 15 9-6 9 6-9 6Z" fill="#9aaab7" />
      <path d="m11 9 9 6v-8l-9-5Z" fill="#e78376" />
      <path
        d="M10 13V3m-3 3 3-3 3 3m7 6 4-3m-4-1 4 1-1 4"
        stroke="#f4c35a"
        strokeWidth="1.7"
      />
    </>
  ),
  flat: (
    <>
      <path d="m13 2 10 6-2 12-11 4-8-9 2-9Z" fill="#9aaab7" />
      <path d="m13 2 2 11 8-5M2 15l13-2-5 11M4 6l11 7 6 7" stroke="#e1eaf0" />
      <path d="m13 2 2 11 8-5Z" fill="#d5dee4" />
    </>
  ),
  smooth: (
    <>
      <circle cx="13" cy="13" r="10.5" fill="#9aaab7" />
      <path
        d="M7 5c-5 7 0 16 8 18-11 2-18-11-8-18Z"
        fill="#647785"
        stroke="none"
      />
      <path d="M8 6c6-4 12 0 13 5-5-4-9-3-13 0Z" fill="#d5dee4" stroke="none" />
    </>
  ),
  grid: (
    <>
      <path d="m1 16 12-9 12 9-12 9Z" fill="#406879" stroke="#8ed5e5" />
      <path d="m5 13 12 9M9 10l12 9M5 19l12-9M9 22l12-9" stroke="#8ed5e5" />
    </>
  ),
  snap: (
    <>
      <path d="m1 16 12-9 12 9-12 9Z" fill="#406879" stroke="#8ed5e5" />
      <path d="m5 13 12 9M5 19l12-9" stroke="#8ed5e5" />
      <path d="M13 2v12m-4-4 4 4 4-4" stroke="#f4c35a" strokeWidth="2" />
      <circle cx="13" cy="16" r="2" fill="#f4c35a" />
    </>
  ),
  selection: (
    <>
      <path
        d="M8 3H3v5m15-5h5v5M3 18v5h5m15-5v5h-5"
        stroke="#8ed5e5"
        strokeWidth="1.7"
      />
      <path d="m7 16 5-9 7 9-6 4Z" fill="#9aaab7" />
      <path d="m7 16 5-9 1 13Z" fill="#f4c35a" />
    </>
  ),
  all: (
    <>
      <path
        d="M8 3H3v5m15-5h5v5M3 18v5h5m15-5v5h-5"
        stroke="#8ed5e5"
        strokeWidth="1.7"
      />
      <path d="m6 10 5-3 5 3v6l-5 3-5-3Z" fill="#9aaab7" />
      <path d="m6 10 5 3 5-3m-5 3v6" />
      <path d="m14 17 3-5 4 6-5 3Z" fill="#f4c35a" />
    </>
  ),
};

function ViewportIcon({ kind }: { kind: keyof typeof viewportArtwork }) {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 26 26"
      fill="none"
      stroke="var(--icon-detail)"
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-viewport-icon={kind}
      data-icon-style="geometric-isometric"
    >
      {viewportArtwork[kind]}
    </svg>
  );
}
export function ViewportTools(props: {
  flat: boolean;
  grid: boolean;
  spacing: number;
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
