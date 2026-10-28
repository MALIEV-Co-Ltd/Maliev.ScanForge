import { createPortal } from "react-dom";

/** Remains reachable while the workspace makes its tool panel inert. */
export function CadJobCancel({
  label,
  onCancel,
}: {
  label: string;
  onCancel: () => void;
}) {
  return createPortal(
    <button
      style={{ position: "fixed", right: 16, bottom: 32, zIndex: 1000 }}
      onClick={onCancel}
    >
      {label}
    </button>,
    document.body,
  );
}
