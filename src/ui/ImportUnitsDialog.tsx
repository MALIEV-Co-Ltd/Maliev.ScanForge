import "./ImportUnitsDialog.css";
import { useState } from "react";
import { SCAN_UNITS, type ScanUnit } from "../import-units";

export function ImportUnitsDialog({
  onImport,
  onCancel,
}: {
  onImport: (unit: ScanUnit) => void;
  onCancel: () => void;
}) {
  const [unit, setUnit] = useState<ScanUnit>("mm");
  return (
    <div className="modal-backdrop">
      <section
        className="modal import-units-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-units-title"
      >
        <h2 id="import-units-title">Import scan</h2>
        <label className="select-field">
          Units
          <select
            autoFocus
            value={unit}
            onChange={(e) => setUnit(e.target.value as ScanUnit)}
          >
            {Object.entries(SCAN_UNITS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <div className="import-unit-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="accent" onClick={() => onImport(unit)}>
            Import
          </button>
        </div>
      </section>
    </div>
  );
}
