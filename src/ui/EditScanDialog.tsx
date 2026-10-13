import type { Positions } from "../types";
import { useState } from "react";
import { ScanDiagnostics } from "./ScanDiagnostics";
import type { Entity } from "../types";
import type { ScanClipBounds } from "../scan-clip-box";
import { ScanToolIcon, type ScanIconName } from "./ScanToolIcon";
import "./EditScanDialog.css";

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
  onSmooth?: () => void;
  onDefeature?: () => void;
  onSplit?: (targetId: string) => void;
  cutters?: Entity[];
  busy?: boolean;
}
/** Groups follow the installed reference manual, pages 26–27 and 219–220.
 * Unrecovered operations are explicitly unavailable, never mapped to another tool.
 */
export function EditScanDialog(props: EditScanDialogProps) {
  const [quickTools, setQuickTools] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectionName, setSelectionName] = useState("Selection 1");
  const [cutter, setCutter] = useState("");
  const tools = [
    { id: "wand", label: "Magic wand", text: "Wand" },
    { id: "brush", label: "Free hand (filled)", text: "Brush" },
    { id: "freehand", label: "Free hand", text: "Outline" },
    { id: "line", label: "Select by drawing a line", text: "Line" },
    {
      id: "rectangle",
      label: "Select by drawing a rectangle",
      text: "Rectangle",
    },
    { id: "circle", label: "Select by drawing a circle", text: "Circle" },
  ] as const;
  const actions: {
    icon: ScanIconName;
    label: string;
    text: string;
    disabled?: boolean;
    run?: () => void;
    extra?: boolean;
  }[] = [
    {
      icon: "all",
      label: "Select all triangles",
      text: "Select all",
      disabled: !props.onSelectAll,
      run: props.onSelectAll,
    },
    {
      icon: "clear",
      label: "Deselect all",
      text: "Clear",
      disabled: !props.selectedCount,
      run: props.onClear,
    },
    {
      icon: "invert",
      label: "Invert selection",
      text: "Invert",
      run: props.onInvert,
    },
    {
      icon: "hide",
      label: "Hide selected",
      text: "Hide",
      disabled: !props.selectedCount,
      run: props.onHide,
    },
    {
      icon: "isolate",
      label: "Isolate selected",
      text: "Isolate",
      disabled: !props.selectedCount,
      run: props.onIsolate,
    },
    {
      icon: "reveal",
      label: "Show hidden",
      text: "Show hidden",
      disabled: !props.hiddenCount,
      run: props.onReveal,
    },
    {
      icon: "grow",
      label: "Enlarge selection",
      text: "Enlarge",
      disabled: !props.selectedCount || !props.onMorph,
      run: () => props.onMorph?.("grow"),
      extra: true,
    },
    {
      icon: "shrink",
      label: "Shrink selection",
      text: "Shrink",
      disabled: !props.selectedCount || !props.onMorph,
      run: () => props.onMorph?.("shrink"),
      extra: true,
    },
    {
      icon: "boundary",
      label: "Select boundaries",
      text: "Boundaries",
      disabled: !props.onMorph,
      run: () => props.onMorph?.("boundary"),
      extra: true,
    },
    {
      icon: "revealSelected",
      label: "Show selected triangles",
      text: "Show last hidden",
      disabled: !props.hiddenCount || !props.onRevealSelected,
      run: props.onRevealSelected,
      extra: true,
    },
    {
      icon: "delete",
      label: "Delete selected triangles",
      text: "Delete triangles",
      disabled: !props.selectedCount,
      run: props.onDelete,
      extra: true,
    },
  ];
  const actionButtons = (extra = false) =>
    actions
      .filter((action) => !!action.extra === extra)
      .map((action) => (
        <button
          key={action.icon}
          aria-label={action.label}
          title={action.label}
          disabled={action.disabled}
          onClick={action.run}
        >
          <ScanToolIcon name={action.icon} size={18} />
          <span>{action.text}</span>
        </button>
      ));
  return (
    <section className="edit-scan-dialog" aria-label={`Edit ${props.name}`}>
      <p className="edit-scan-name" title={props.name}>
        {props.name}
      </p>
      <section className="edit-scan-section" aria-label="Mesh information">
        <h3>Mesh information</h3>
        <ScanDiagnostics
          positions={props.positions}
          onEdit={props.onTopology}
        />
      </section>
      <fieldset
        disabled={props.busy}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <section className="edit-scan-section" aria-label="Select triangles">
          <h3>Selection tools</h3>
          <div
            className="scan-tool-row"
            role="group"
            aria-label="Selection tools"
          >
            {tools.map(({ id, label, text }) => {
              return (
                <button
                  key={id}
                  aria-label={label}
                  title={label}
                  aria-pressed={props.tool === id}
                  onClick={() => props.onTool(id)}
                >
                  <ScanToolIcon name={id} />
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
          <button
            className="edit-scan-through"
            aria-label="Select through"
            title="Select through"
            aria-pressed={props.through}
            onClick={() => props.onThrough(!props.through)}
          >
            <ScanToolIcon name="through" />
            <span>See-through selection</span>
          </button>
          {props.tool === "wand" ? (
            <div className="scan-sensitivity">
              <span>Angle</span>
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
              Ctrl + wheel adjusts brush size · {props.brushRadius.toFixed(1)}{" "}
              px
            </p>
          )}
          {props.tool === "wand" && (
            <label className="check">
              <input
                type="checkbox"
                checked={props.allConnected}
                disabled={props.tool !== "wand"}
                onChange={(event) => props.onAllConnected(event.target.checked)}
              />
              Select all connected triangles
            </label>
          )}
        </section>
        <section className="edit-scan-section" aria-label="Manage selection">
          <h3>
            Selection actions{" "}
            <small>{props.selectedCount.toLocaleString()} selected</small>
          </h3>
          <div
            className="edit-scan-actions"
            role="group"
            aria-label="Selection actions"
          >
            {actionButtons()}
          </div>
          <details className="edit-scan-more">
            <summary>More selection actions</summary>
            <div className="edit-scan-actions edit-scan-extra">
              {actionButtons(true)}
            </div>
            {!props.onQuickTools && quickTools && (
              <div
                className="button-row"
                role="group"
                aria-label="Quick selection tools"
              >
                <button disabled={!props.canUndo} onClick={props.onUndo}>
                  Undo selection
                </button>
                <button disabled={!props.canRedo} onClick={props.onRedo}>
                  Redo selection
                </button>
              </div>
            )}
            <div className="button-row">
              <button
                disabled={!props.onClip || !props.clipFull}
                aria-pressed={!!props.clip}
                onClick={() =>
                  props.onClip?.(props.clip ? null : props.clipFull!)
                }
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
                              min: [
                                ...props.clip!.min,
                              ] as ScanClipBounds["min"],
                              max: [
                                ...props.clip!.max,
                              ] as ScanClipBounds["max"],
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
          </details>
        </section>
        <fieldset className="edit-scan-create">
          <legend>Create from selection</legend>
          <div className="button-row">
            <button disabled={!props.selectedCount} onClick={props.onCut}>
              <ScanToolIcon name="cut" size={18} /> Cut &amp; Create
            </button>
            <button disabled={!props.selectedCount} onClick={props.onCopy}>
              <ScanToolIcon name="copy" size={18} /> Copy &amp; Create
            </button>
          </div>
        </fieldset>
        <details className="edit-scan-more edit-scan-additional">
          <summary>Additional tools & display</summary>
          <section className="edit-scan-section" aria-label="Display">
            <h3>Display</h3>
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
            <label className="check">
              <input
                type="checkbox"
                checked={props.wireframe}
                onChange={(event) => props.onWireframe(event.target.checked)}
              />
              Show mesh wireframe
            </label>
            <p role="status" className="edit-scan-counts">
              {props.selectedCount.toLocaleString()} selected ·{" "}
              {props.hiddenCount.toLocaleString()} hidden
            </p>
          </section>

          <fieldset>
            <legend>Selected area</legend>
            <div className="button-row">
              <button
                disabled={!props.selectedCount || !props.onSmooth}
                onClick={() => props.onSmooth?.()}
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
        </details>
      </fieldset>
      <div className="scan-dialog-footer">
        <button onClick={props.onClose}>Close</button>
      </div>
    </section>
  );
}
