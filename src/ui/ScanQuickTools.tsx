import { ScanToolIcon } from "./ScanToolIcon";

export function ScanQuickTools(props: {
  x: number;
  y: number;
  onDelete: () => void;
  onHide: () => void;
  onIsolate: () => void;
  onInvert: () => void;
  onDefeature?: () => void;
  onSmooth?: () => void;
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
        <ScanToolIcon name="delete" />
      </button>
      <button
        title="Defeature selected area"
        aria-label="Defeature"
        disabled={!props.onDefeature}
        onClick={props.onDefeature}
      >
        <ScanToolIcon name="defeature" />
      </button>
      <button
        title="Smooth selected area"
        aria-label="Smooth selected"
        disabled={!props.onSmooth}
        onClick={props.onSmooth}
      >
        <ScanToolIcon name="smooth" />
      </button>
      <button
        title="Hide selected"
        aria-label="Hide selected"
        onClick={props.onHide}
      >
        <ScanToolIcon name="hide" />
      </button>
      <button
        title="Invert selection"
        aria-label="Invert selection"
        onClick={props.onInvert}
      >
        <ScanToolIcon name="invert" />
      </button>
      <button
        title="Isolate selected"
        aria-label="Isolate selected"
        onClick={props.onIsolate}
      >
        <ScanToolIcon name="isolate" />
      </button>
    </div>
  );
}
