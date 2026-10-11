import type { ReactNode } from "react";
import type { Vec3 } from "../types";
export function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
export function VectorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div className="vector-field">
      <span>{label}</span>
      <div>
        {value.map((n, i) => (
          <label key={i}>
            <span>{["X", "Y", "Z"][i]}</span>
            <input
              aria-label={`${label} ${["X", "Y", "Z"][i]}`}
              type="number"
              value={n}
              step="1"
              onChange={(e) => {
                if (Number.isFinite(e.target.valueAsNumber)) {
                  const next = [...value] as Vec3;
                  next[i] = e.target.valueAsNumber;
                  onChange(next);
                }
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
export function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
