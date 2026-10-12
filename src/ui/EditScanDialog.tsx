import type { Positions } from "../types";
import { useState } from "react";
import { ScanDiagnostics } from "./ScanDiagnostics";
import type { Entity } from "../types";
import type { ScanClipBounds } from "../scan-clip-box";
import { ScanToolIcon } from "./ScanToolIcon";

export type ScanSelectionTool =
  "brush" | "freehand" | "line" | "rectangle" | "circle" | "wand";
export interface EditScanDialogProps {
  name: string;
  positions: Positions;
  tool: ScanSelectionTool;
  onTool: (tool: ScanSelectionTool) => void;
  angle: number;
  onAngle: (angle: number) => void;
  allConnected: boolean;
  onAllConnected: (enabled: boolean) => void;
  brushRadius: number;
  through: boolean;
  onThrough: (through: boolean) => void;
  selectedCount: number;
  hiddenCount: number;
  wireframe: boolean;
  onWireframe: (wireframe: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onInvert: () => void;
  onHide: () => void;
  onIsolate: () => void;
  onReveal: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onSave: (name: string) => void;
  onClose: () => void;
  quickTools?: boolean;
  onQuickTools?: (enabled: boolean) => void;
  onTopology?: (section: "components" | "holes" | "boundaries") => void;
  onMorph?: (operation: "grow" | "shrink" | "boundary") => void;
  onSelectAll?: () => void;
  onRevealSelected?: () => void;
  clip?: ScanClipBounds | null;
  clipFull?: ScanClipBounds;
  onClip?: (bounds: ScanClipBounds | null) => void;
  onSmooth?: (strength: number, iterations: number) => void;
  onDefeature?: () => void;
  onSplit?: (targetId: string) => void;
  cutters?: Entity[];
  busy?: boolean;
}
const pending = "Behavior not yet reconstructed; unavailable.";
/** Groups follow the installed reference manual, pages 26–27 and 219–220.
 * Unrecovered operations are explicitly unavailable, never mapped to another tool.
 */
export function EditScanDialog(props: EditScanDialogProps) {
  const [quickTools, setQuickTools] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectionName, setSelectionName] = useState("Selection 1");
  const [smoothStrength, setSmoothStrength] = useState(0.3),
    [smoothIterations, setSmoothIterations] = useState(3),
    [cutter, setCutter] = useState("");
  const tools = [
    { id: "wand", label: "Magic wand" },
    { id: "brush", label: "Free hand (filled)" },
    { id: "freehand", label: "Free hand" },
    { id: "line", label: "Select by drawing a line" },
    {
      id: "rectangle",
      label: "Select by drawing a rectangle",
    },
    { id: "circle", label: "Select by drawing a circle" },
  ] as const;
  return (
    <section className="edit-scan-dialog" aria-label={`Edit ${props.name}`}>
      <ScanDiagnostics positions={props.positions} onEdit={props.onTopology} />
      <fieldset
        disabled={props.busy}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <div
          className="scan-tool-row"
          role="group"
          aria-label="Selection tools"
        >
          {tools.map(({ id, label }) => {
            const implemented = true;
            return (
              <button
                key={id}
                aria-label={label}
                title={implemented ? label : `${label}: ${pending}`}
                aria-pressed={props.tool === id}
                disabled={!implemented}
                onClick={() =>
                  implemented && props.onTool(id as ScanSelectionTool)
                }
              >
                <ScanToolIcon name={id} />
              </button>
            );
          })}
          <button
            aria-label="Select through"
            title="Select through"
            aria-pressed={props.through}
            onClick={() => props.onThrough(!props.through)}
          >
            <ScanToolIcon name="through" />
          </button>
        </div>
        {props.tool === "wand" ? (
          <div className="scan-sensitivity">
            <input
              aria-label="Selection sensitivity"
              disabled={props.allConnected}
              type="range"
              min="0"
              max="90"
              step="0.01"
              value={props.angle}
              onChange={(event) => props.onAngle(Number(event.target.value))}
            />
            <label>
              <input
                aria-label="Sensitivity degrees"
                disabled={props.allConnected}
                type="number"
                min="0"
                max="90"
                step="0.01"
                value={props.angle}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value))
                    props.onAngle(Math.min(90, Math.max(0, value)));
                }}
              />{" "}
              degrees
            </label>
          </div>
        ) : (
          <p className="muted">
            Ctrl + wheel adjusts brush size · {props.brushRadius.toFixed(1)} px
          </p>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={props.allConnected}
            disabled={props.tool !== "wand"}
            onChange={(event) => props.onAllConnected(event.target.checked)}
          />
          Select all connected triangles
        </label>
        <div
          className="scan-tool-row"
          role="group"
          aria-label="Selection actions"
        >
          <button
            disabled={!props.selectedCount || !props.onMorph}
            title="Enlarge selection"
            aria-label="Enlarge selection"
            onClick={() => props.onMorph?.("grow")}
          >
            <ScanToolIcon name="grow" />
          </button>
          <button
            disabled={!props.selectedCount || !props.onMorph}
            title="Shrink selection"
            aria-label="Shrink selection"
            onClick={() => props.onMorph?.("shrink")}
          >
            <ScanToolIcon name="shrink" />
          </button>
          <button
            aria-label="Select boundaries"
            title="Select boundaries"
            disabled={!props.onMorph}
            onClick={() => props.onMorph?.("boundary")}
          >
            <ScanToolIcon name="boundary" />
          </button>
          <button
            aria-label="Select all triangles"
            title="Select all triangles"
            disabled={!props.onSelectAll}
            onClick={props.onSelectAll}
          >
            <ScanToolIcon name="all" />
          </button>
          <button
            aria-label="Isolate selected"
            title="Isolate selected"
            disabled={!props.selectedCount}
            onClick={props.onIsolate}
          >
            <ScanToolIcon name="isolate" />
          </button>
          <button
            aria-label="Hide selected"
            title="Hide selected"
            disabled={!props.selectedCount}
            onClick={props.onHide}
          >
            <ScanToolIcon name="hide" />
          </button>
          <button
            aria-label="Show hidden"
            title="Show hidden"
            disabled={!props.hiddenCount}
            onClick={props.onReveal}
          >
            <ScanToolIcon name="reveal" />
          </button>
          <button
            aria-label="Show selected triangles"
            title="Show last hidden selection"
            disabled={!props.hiddenCount || !props.onRevealSelected}
            onClick={props.onRevealSelected}
          >
            <ScanToolIcon name="revealSelected" />
          </button>
          <button
            aria-label="Invert selection"
            title="Invert selection"
            onClick={props.onInvert}
          >
            <ScanToolIcon name="invert" />
          </button>
          <button
            aria-label="Deselect all"
            title="Deselect all"
            disabled={!props.selectedCount}
            onClick={props.onClear}
          >
            <ScanToolIcon name="clear" />
          </button>
        </div>
        <div className="button-row">
          <button
            disabled={!props.onClip || !props.clipFull}
            aria-pressed={!!props.clip}
            onClick={() => props.onClip?.(props.clip ? null : props.clipFull!)}
          >
            <ScanToolIcon name="clip" size={18} /> Clipping Box…
          </button>
          <button
            disabled={!props.selectedCount}
            onClick={() => setSaving(true)}
          >
            <ScanToolIcon name="save" size={18} /> Save selection status…
          </button>
        </div>
        {props.clip && props.clipFull && (
          <fieldset>
            <legend>Clipping box · mm</legend>
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <div key={axis}>
                {(["min", "max"] as const).map((side) => (
                  <label key={side}>
                    {axis} {side} · {props.clip![side][index].toFixed(2)}
                    <input
                      aria-label={`Clip ${axis} ${side}`}
                      type="range"
                      min={props.clipFull!.min[index]}
                      max={props.clipFull!.max[index]}
                      step={Math.max(
                        (props.clipFull!.max[index] -
                          props.clipFull!.min[index]) /
                          500,
                        0.0001,
                      )}
                      value={props.clip![side][index]}
                      onChange={(event) => {
                        const next = {
                          min: [...props.clip!.min] as ScanClipBounds["min"],
                          max: [...props.clip!.max] as ScanClipBounds["max"],
                        };
                        next[side][index] =
                          side === "min"
                            ? Math.min(
                                Number(event.target.value),
                                next.max[index],
                              )
                            : Math.max(
                                Number(event.target.value),
                                next.min[index],
                              );
                        props.onClip?.(next);
                      }}
                    />
                  </label>
                ))}
              </div>
            ))}
            <button onClick={() => props.onClip?.(props.clipFull!)}>
              Reset clipping box
            </button>
            <p className="muted">
              Drag a gold face handle on the mesh to adjust the box.
            </p>
          </fieldset>
        )}
        {saving && (
          <form
            aria-label="Save selection status"
            onSubmit={(event) => {
              event.preventDefault();
              if (selectionName.trim()) {
                props.onSave(selectionName.trim());
                setSaving(false);
              }
            }}
          >
            <label>
              Selection name
              <input
                autoFocus
                maxLength={200}
                value={selectionName}
                onChange={(event) => setSelectionName(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                type="submit"
                disabled={!selectionName.trim() || !props.selectedCount}
              >
                Save selection
              </button>
              <button type="button" onClick={() => setSaving(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <fieldset>
          <legend>New mesh from selection</legend>
          <div className="button-row">
            <button disabled={!props.selectedCount} onClick={props.onCut}>
              <ScanToolIcon name="cut" size={18} /> Cut &amp; Create
            </button>
            <button disabled={!props.selectedCount} onClick={props.onCopy}>
              <ScanToolIcon name="copy" size={18} /> Copy &amp; Create
            </button>
          </div>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={props.quickTools ?? quickTools}
            onChange={(event) => {
              setQuickTools(event.target.checked);
              props.onQuickTools?.(event.target.checked);
            }}
          />
          Show quick tools dialog
        </label>
        {!props.onQuickTools && quickTools && (
          <div
            className="button-row"
            role="group"
            aria-label="Quick selection tools"
          >
            <button disabled={!props.selectedCount} onClick={props.onDelete}>
              <ScanToolIcon name="delete" size={18} /> Delete selected triangles
            </button>
            <button disabled={!props.canUndo} onClick={props.onUndo}>
              Undo selection
            </button>
            <button disabled={!props.canRedo} onClick={props.onRedo}>
              Redo selection
            </button>
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={props.wireframe}
            onChange={(event) => props.onWireframe(event.target.checked)}
          />
          Show mesh wireframe
        </label>
        <p role="status">
          {props.selectedCount.toLocaleString()} selected triangles ·{" "}
          {props.hiddenCount.toLocaleString()} hidden
        </p>
        <fieldset>
          <legend>Selected area</legend>
          <label>
            Smooth strength
            <input
              aria-label="Selected smooth strength"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={smoothStrength}
              onChange={(event) =>
                setSmoothStrength(Number(event.target.value))
              }
            />
          </label>
          <label>
            Iterations
            <input
              aria-label="Selected smooth iterations"
              type="number"
              min="1"
              max="100"
              value={smoothIterations}
              onChange={(event) =>
                setSmoothIterations(
                  Math.min(100, Math.max(1, Number(event.target.value) || 1)),
                )
              }
            />
          </label>
          <div className="button-row">
            <button
              disabled={!props.selectedCount || !props.onSmooth}
              onClick={() => props.onSmooth?.(smoothStrength, smoothIterations)}
            >
              <ScanToolIcon name="smooth" size={18} /> Smooth selected area
            </button>
            <button
              disabled={!props.selectedCount || !props.onDefeature}
              onClick={props.onDefeature}
            >
              <ScanToolIcon name="defeature" size={18} /> Defeature selected
              area
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Split mesh</legend>
          <label>
            Cutting solid, surface or mesh
            <select
              aria-label="Mesh splitter"
              value={cutter}
              onChange={(event) => setCutter(event.target.value)}
            >
              <option value="">Choose an object…</option>
              {props.cutters?.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!cutter || !props.onSplit}
            onClick={() => props.onSplit?.(cutter)}
          >
            <ScanToolIcon name="split" size={18} /> Split with selected object
          </button>
        </fieldset>
        <p className="muted">Alt + left-drag removes selection.</p>
      </fieldset>
      <div className="scan-dialog-footer">
        <button onClick={props.onClose}>Close</button>
      </div>
    </section>
  );
}
