import { AppSelect } from "./AppSelect";
import "./ReductionModeSelect.css";
export const reductionModes = [
  { value: "triangles", label: "Number of triangles" },
  { value: "percentage", label: "Percentage remaining" },
  { value: "deviation", label: "Deviation from original" },
] as const;
export type ReductionMode = (typeof reductionModes)[number]["value"];
export function ReductionModeSelect({
  value,
  disabled,
  onChange,
}: {
  value: ReductionMode;
  disabled: boolean;
  onChange: (value: ReductionMode) => void;
}) {
  return (
    <div className="reduction-mode-select">
      <span>Reduce by</span>
      <AppSelect
        aria-label="Reduce by"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ReductionMode)}
      >
        {reductionModes.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </AppSelect>
    </div>
  );
}
