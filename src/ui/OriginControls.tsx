import { Crosshair, Plus } from "./GeneratedUiIcons";
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
