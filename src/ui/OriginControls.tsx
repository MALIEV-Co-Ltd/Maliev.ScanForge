import { Crosshair, Plus, X } from "lucide-react";
import { ORIGIN_PLANES, PLANE_LABELS, type OriginPlane } from "../origin";
import "./origin-controls.css";

export function CoordinateSystem({
  visible,
  onVisible,
  onSketch,
}: {
  visible: boolean;
  onVisible: (visible: boolean) => void;
  onSketch: () => void;
}) {
  return (
    <div className="coordinate-system-row" aria-label="World coordinate system">
      <label>
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => onVisible(e.target.checked)}
        />
        <Crosshair size={15} aria-hidden="true" /> Coordinate System
      </label>
      <button
        aria-label="Create sketch on plane"
        title="Create sketch on plane"
        onClick={onSketch}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
export function SketchPlanePicker({
  onPick,
  onHover,
  onCustom,
  onCancel,
}: {
  onPick: (plane: OriginPlane) => void;
  onHover: (plane?: OriginPlane) => void;
  onCustom: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="sketch-plane-picker"
      role="region"
      aria-label="Choose sketch plane"
    >
      <span>Select a plane on the canvas</span>
      <div>
        {ORIGIN_PLANES.map((plane) => (
          <button
            key={plane}
            onPointerEnter={() => onHover(plane)}
            onPointerLeave={() => onHover()}
            onFocus={() => onHover(plane)}
            onBlur={() => onHover()}
            onClick={() => onPick(plane)}
          >
            {PLANE_LABELS[plane]}
          </button>
        ))}
      </div>
      <button onClick={onCustom}>Custom plane…</button>
      <button aria-label="Cancel plane selection" onClick={onCancel}>
        <X size={15} />
      </button>
    </div>
  );
}
