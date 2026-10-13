import { AppSelect } from "./AppSelect";
import "./ToolPanel.css";
import { useState } from "react";
import type { Entity } from "../types";
import type {
  SketchSectionOptions,
  SketchSectionResult,
} from "../sketch-section";

export function CreateSketchDialog({
  source,
  busy,
  preview,
  onApply,
  onCreate,
  onCancel,
}: {
  source: Entity;
  busy: boolean;
  preview?: SketchSectionResult;
  onApply: (options: SketchSectionOptions) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<SketchSectionOptions>({
    plane: "OXY",
    offset: 0,
    onSlicingPlane: true,
    selectedOnly: false,
  });
  const [changed, setChanged] = useState(true);
  const change = (next: Partial<SketchSectionOptions>) => {
    setOptions({ ...options, ...next });
    setChanged(true);
  };
  return (
    <aside className="inspector tool-panel" aria-label="Create Sketch">
      <h2>Create Sketch</h2>
      <section className="tool-section tool-panel-content">
        <p>{source.name} · For extruded surface</p>
        {source.scanSource &&
          source.scanSource.displayedTriangles <
            source.scanSource.triangles && (
            <p role="note">References use the sampled display scan.</p>
          )}
        <fieldset disabled={busy}>
          <label className="field">
            Reference plane
            <AppSelect
              value={options.plane}
              onChange={(e) =>
                change({
                  plane: e.target.value as SketchSectionOptions["plane"],
                })
              }
            >
              <option value="OXY">OXY · U=X, V=Y</option>
              <option value="OYZ">OYZ · U=Y, V=Z</option>
              <option value="OXZ">OXZ · U=Z, V=X</option>
            </AppSelect>
          </label>
          <label className="field">
            Slice offset (mm)
            <input
              type="number"
              value={options.offset}
              onChange={(e) => change({ offset: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.onSlicingPlane}
              onChange={(e) => change({ onSlicingPlane: e.target.checked })}
            />
            Create sketch on slicing plane
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.selectedOnly}
              onChange={(e) => change({ selectedOnly: e.target.checked })}
            />
            Through selection only
          </label>
        </fieldset>
        {preview && !changed && (
          <p role="status">
            {preview.reference.segments.length / 4} reference segments ·{" "}
            {preview.eligibleTriangles.toLocaleString()} eligible triangles
          </p>
        )}
        <p className="muted">
          Section samples are references. Draw or fit editable curves before
          creating a CAD body.
        </p>
      </section>
      <footer className="tool-panel-actions">
        <button
          disabled={busy || !Number.isFinite(options.offset)}
          onClick={() => {
            setChanged(false);
            onApply(options);
          }}
        >
          Apply section
        </button>
        <button disabled={busy || changed || !preview} onClick={onCreate}>
          Create
        </button>
        <button onClick={onCancel}>Cancel</button>
      </footer>
    </aside>
  );
}
