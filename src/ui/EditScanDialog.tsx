import { useState } from "react";
import {
  Circle,
  MousePointer2,
  Paintbrush,
  RectangleHorizontal,
  WandSparkles,
  PenLine,
  Minus,
  Eye,
  EyeOff,
  Copy,
  Scissors,
  Trash2,
} from "lucide-react";

export type ScanSelectionTool = "brush" | "rectangle" | "circle" | "wand";
export interface EditScanDialogProps {
  name: string;
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
}
const pending = "Behavior not yet reconstructed; unavailable.";
/** Groups follow the installed reference manual, pages 26–27 and 219–220.
 * Unrecovered operations are explicitly unavailable, never mapped to another tool.
 */
export function EditScanDialog(props: EditScanDialogProps) {
  const [quickTools, setQuickTools] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectionName, setSelectionName] = useState("Selection 1");
  const tools = [
    { id: "wand", label: "Magic wand", Icon: WandSparkles },
    { id: "brush", label: "Free hand (filled)", Icon: Paintbrush },
    { id: "freehand", label: "Free hand", Icon: PenLine },
    { id: "line", label: "Select by drawing a line", Icon: Minus },
    {
      id: "rectangle",
      label: "Select by drawing a rectangle",
      Icon: RectangleHorizontal,
    },
    { id: "circle", label: "Select by drawing a circle", Icon: Circle },
  ] as const;
  return (
    <section className="edit-scan-dialog" aria-label={`Edit ${props.name}`}>
      <div className="scan-diagnostics" role="group" aria-label="Mesh editing">
        {["Individual meshes", "Holes", "Boundaries"].map((label) => (
          <div key={label}>
            <span>{label}</span>
            <button
              disabled
              title={pending}
              aria-label={`Edit ${label.toLowerCase()}`}
            >
              Edit…
            </button>
          </div>
        ))}
      </div>
      <div className="scan-tool-row" role="group" aria-label="Selection tools">
        {tools.map(({ id, label, Icon }) => {
          const implemented = id !== "freehand" && id !== "line";
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
              <Icon size={21} />
            </button>
          );
        })}
        <button
          aria-label="Select through"
          title="Select through"
          aria-pressed={props.through}
          onClick={() => props.onThrough(!props.through)}
        >
          <Copy size={21} />
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
        <button disabled title={pending} aria-label="Enlarge selection">
          <Circle size={20} />
        </button>
        <button disabled title={pending} aria-label="Shrink selection">
          <Circle size={14} />
        </button>
        <button
          aria-label="Isolate selected"
          title="Isolate selected"
          disabled={!props.selectedCount}
          onClick={props.onIsolate}
        >
          <MousePointer2 size={20} />
        </button>
        <button
          aria-label="Hide selected"
          title="Hide selected"
          disabled={!props.selectedCount}
          onClick={props.onHide}
        >
          <EyeOff size={20} />
        </button>
        <button
          aria-label="Show hidden"
          title="Show hidden"
          disabled={!props.hiddenCount}
          onClick={props.onReveal}
        >
          <Eye size={20} />
        </button>
        <button
          aria-label="Invert selection"
          title="Invert selection"
          onClick={props.onInvert}
        >
          <Circle size={20} />
        </button>
        <button
          aria-label="Deselect all"
          title="Deselect all"
          disabled={!props.selectedCount}
          onClick={props.onClear}
        >
          <Minus size={20} />
        </button>
      </div>
      <div className="button-row">
        <button disabled title={pending}>
          Clipping Box…
        </button>
        <button disabled={!props.selectedCount} onClick={() => setSaving(true)}>
          Save selection status…
        </button>
      </div>
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
            <Scissors size={14} /> Cut &amp; Create
          </button>
          <button disabled={!props.selectedCount} onClick={props.onCopy}>
            <Copy size={14} /> Copy &amp; Create
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
            <Trash2 size={14} /> Delete selected triangles
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
      <p className="muted">
        Alt + left-drag removes selection. Greyed controls await implementation.
      </p>
      <div className="scan-dialog-footer">
        <button onClick={props.onClose}>Close</button>
      </div>
    </section>
  );
}
