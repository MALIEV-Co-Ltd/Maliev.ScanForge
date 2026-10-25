import type { ReductionStatistics } from "../reduction-report";
import "./ReductionResults.css";
import { useEffect, useRef, useState } from "react";
import { toleranceAtPointer } from "../reduction-display";

export function ReductionColorScale({
  threshold,
  tolerance,
  lowerTolerance = -Math.min(threshold, tolerance),
  upperTolerance = Math.min(threshold, tolerance),
  onToleranceChange,
  disabled = false,
  readOnly = false,
}: {
  threshold: number;
  tolerance: number;
  lowerTolerance?: number;
  upperTolerance?: number;
  onToleranceChange?: (lower: number, upper: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const range = threshold;
  const body = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState([lowerTolerance, upperTolerance]);
  const draft = useRef(bounds);
  useEffect(() => {
    const next = [lowerTolerance, upperTolerance];
    setBounds(next);
    draft.current = next;
  }, [lowerTolerance, upperTolerance]);
  const setBound = (index: number, value: number, commit = false) => {
    if (disabled || !Number.isFinite(value)) return;
    const next = [...draft.current];
    next[index] =
      index === 0
        ? Math.max(-range, Math.min(0, value))
        : Math.min(range, Math.max(0, value));
    draft.current = next;
    setBounds(next);
    if (commit) onToleranceChange?.(next[0], next[1]);
  };
  const drag = (index: number, y: number) => {
    const rect = body.current?.getBoundingClientRect();
    if (rect)
      setBound(
        index,
        toleranceAtPointer(y, rect.top, rect.height, range),
        true,
      );
  };
  return (
    <aside
      className="reduction-color-scale"
      data-read-only={readOnly || undefined}
      aria-label="Signed deviation colour scale"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <strong>Deviation (mm)</strong>
      <div className="reduction-color-scale-body" ref={body}>
        <div
          className="reduction-color-scale-ramp"
          style={{
            background: `linear-gradient(to bottom, #ff0000 0%, #ff0000 ${50 * (1 - bounds[1] / range)}%, #ffff00 ${50 * (1 - bounds[1] / (2 * range))}%, #00ff00 50%, #00ffff ${50 * (1 - bounds[0] / (2 * range))}%, #0000ff ${50 * (1 - bounds[0] / range)}%, #0000ff 100%)`,
          }}
        />
        <div className="reduction-color-scale-ticks">
          {[1, 0.5, 0, -0.5, -1].map((f) => (
            <span
              key={f}
              style={{
                visibility:
                  !readOnly &&
                  bounds.some((bound) => Math.abs(f - bound / range) < 0.13)
                    ? "hidden"
                    : "visible",
              }}
            >
              {f > 0 ? "+" : f < 0 ? "−" : ""}
              {Math.abs(f * range).toFixed(3)}
            </span>
          ))}
        </div>
        {(readOnly ? [] : [1, 0]).map((index) => (
          <div
            key={index}
            className="reduction-tolerance-marker"
            style={{ top: `${50 * (1 - bounds[index] / range)}%` }}
          >
            <div
              role="slider"
              aria-orientation="vertical"
              tabIndex={disabled ? -1 : 0}
              aria-label={index ? "Upper tolerance" : "Lower tolerance"}
              aria-valuemin={index ? 0 : -range}
              aria-valuemax={index ? range : 0}
              aria-valuenow={bounds[index]}
              aria-valuetext={`${bounds[index].toFixed(3)} mm`}
              aria-disabled={disabled}
              className="reduction-tolerance-handle"
              onPointerDown={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  drag(index, event.clientY);
              }}
              onPointerUp={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                drag(index, event.clientY);
                event.currentTarget.releasePointerCapture(event.pointerId);
                onToleranceChange?.(draft.current[0], draft.current[1]);
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                draft.current = [lowerTolerance, upperTolerance];
                setBounds(draft.current);
              }}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowUp" || event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowDown" || event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (direction) {
                  event.preventDefault();
                  setBound(
                    index,
                    bounds[index] + (direction * range) / 100,
                    true,
                  );
                }
              }}
            />
            <label>
              <span>{index ? "Upper" : "Lower"}</span>
              <input
                aria-label={
                  index ? "Upper tolerance value" : "Lower tolerance value"
                }
                type="number"
                step={range / 100}
                min={index ? 0 : -range}
                max={index ? range : 0}
                value={Number(bounds[index].toPrecision(6))}
                disabled={disabled}
                onChange={(event) =>
                  setBound(index, event.currentTarget.valueAsNumber, true)
                }
              />
            </label>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function ReductionResults({
  statistics: s,
}: {
  statistics: ReductionStatistics;
}) {
  const mm = (value: number | null, signed = false) =>
    value === null
      ? "Unavailable"
      : `${signed && value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(3)} mm`;
  return (
    <section
      className="reduction-results"
      aria-label="Reduction deviation results"
    >
      <strong>Deviation results</strong>
      {s.originalTriangles !== undefined &&
        s.reducedTriangles !== undefined && (
          <p>
            {s.originalTriangles.toLocaleString()} →{" "}
            {s.reducedTriangles.toLocaleString()} triangles
            <br />
            {s.originalTriangles
              ? (100 * (1 - s.reducedTriangles / s.originalTriangles)).toFixed(
                  1,
                )
              : "0.0"}
            % fewer triangles
          </p>
        )}
      <dl>
        <dt>Minimum</dt>
        <dd className="deviation-negative">{mm(s.minimum, true)}</dd>
        <dt>Maximum</dt>
        <dd className="deviation-positive">{mm(s.maximum, true)}</dd>
        <dt>RMS</dt>
        <dd>{mm(s.rms)}</dd>
        <dt>Within tolerance</dt>
        <dd>{s.percentage.toFixed(2)}%</dd>
      </dl>
      {s.unmatched > 0 && (
        <p>{s.unmatched.toLocaleString()} samples could not be measured.</p>
      )}
    </section>
  );
}

export function ReductionProgress({
  fraction,
  stage,
}: {
  fraction: number;
  stage: string;
}) {
  const percent = Math.min(100, Math.max(0, Math.floor(fraction * 100)));
  return (
    <div className="reduction-progress">
      <div className="reduction-progress-label" role="status">
        <span>{stage}</span>
        <strong>{percent}%</strong>
      </div>
      <div
        className="reduction-progress-track"
        role="progressbar"
        aria-label="Reduce polygons overall progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${stage} · ${percent}%`}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
