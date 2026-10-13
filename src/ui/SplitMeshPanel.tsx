import { useState } from "react";
import type { Entity } from "../types";
import { AppSelect } from "./AppSelect";
import { ScanToolIcon } from "./ScanToolIcon";
import "./ToolPanel.css";

export function SplitMeshPanel({
  cutters,
  busy,
  onSplit,
  onClose,
}: {
  cutters: Entity[];
  busy: boolean;
  onSplit: (targetId: string) => void;
  onClose: () => void;
}) {
  const [cutter, setCutter] = useState("");
  const canSplit = !busy && cutters.some((entity) => entity.id === cutter);
  return (
    <section className="scan-tools-panel tool-panel" aria-label="Split mesh">
      <header className="tool-panel-header">
        <h3>
          <ScanToolIcon name="split" /> Split mesh
        </h3>
        <button aria-label="Close Split mesh" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="tool-panel-content">
        <label className="field">
          Cutting solid, surface or mesh
          <AppSelect
            aria-label="Mesh splitter"
            value={cutter}
            disabled={busy}
            onChange={(event) => setCutter(event.target.value)}
          >
            <option value="">Choose an object…</option>
            {cutters.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </AppSelect>
        </label>
        {!cutters.length && (
          <p className="muted">Add a cutting object to split this mesh.</p>
        )}
      </div>
      <footer className="tool-panel-actions">
        <button onClick={onClose}>Close</button>
        <button disabled={!canSplit} onClick={() => onSplit(cutter)}>
          <ScanToolIcon name="split" size={18} /> Split mesh
        </button>
      </footer>
    </section>
  );
}
