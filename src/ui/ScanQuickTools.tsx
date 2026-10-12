import { Circle, Eye, EyeOff, MousePointer2, Waves, X } from "lucide-react";

export function ScanQuickTools(props: {
  x: number;
  y: number;
  onDelete: () => void;
  onHide: () => void;
  onIsolate: () => void;
  onInvert: () => void;
}) {
  return (
    <div
      className="scan-quick-tools"
      role="toolbar"
      aria-label="Quick selection tools"
      style={{
        left: Math.max(
          8,
          Math.min(
            (typeof window === "undefined" ? 1024 : window.innerWidth) - 244,
            props.x - 112,
          ),
        ),
        top: Math.max(8, props.y - 48),
      }}
    >
      <button
        title="Delete selected"
        aria-label="Delete selected"
        onClick={props.onDelete}
      >
        <X size={17} />
      </button>
      <button
        title="Defeature: original operation is not yet reconstructed"
        aria-label="Defeature"
        disabled
      >
        <Circle size={17} />
      </button>
      <button
        title="Smooth: original operation is not yet reconstructed"
        aria-label="Smooth selected"
        disabled
      >
        <Waves size={17} />
      </button>
      <button
        title="Hide selected"
        aria-label="Hide selected"
        onClick={props.onHide}
      >
        <EyeOff size={17} />
      </button>
      <button
        title="Invert selection"
        aria-label="Invert selection"
        onClick={props.onInvert}
      >
        <MousePointer2 size={17} />
      </button>
      <button
        title="Isolate selected"
        aria-label="Isolate selected"
        onClick={props.onIsolate}
      >
        <Eye size={17} />
      </button>
    </div>
  );
}
