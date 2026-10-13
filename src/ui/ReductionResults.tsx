import type { ReductionStatistics } from "../reduction-report";
import "./ReductionResults.css";
import { nativeNoiseColor } from "../scan-noise-color";

export function ReductionColorScale({
  threshold,
  tolerance,
}: {
  threshold: number;
  tolerance: number;
}) {
  const range = threshold * 5;
  const stops = Array.from(
    { length: 51 },
    (_, i) =>
      `rgb(${nativeNoiseColor(range * (1 - i / 25), threshold).join(",")}) ${i * 2}%`,
  ).join(",");
  return (
    <aside
      className="reduction-color-scale"
      aria-label="Signed deviation colour scale"
    >
      <strong>Deviation (mm)</strong>
      <div className="reduction-color-scale-body">
        <div
          className="reduction-color-scale-ramp"
          style={{ background: `linear-gradient(to bottom, ${stops})` }}
        />
        <div className="reduction-color-scale-ticks">
          {[1, 0.5, 0, -0.5, -1].map((f) => (
            <span key={f}>
              {f > 0 ? "+" : f < 0 ? "−" : ""}
              {Math.abs(f * range).toFixed(3)}
            </span>
          ))}
        </div>
      </div>
      <p>Tolerance ±{tolerance.toPrecision(3)} mm</p>
      <p>Grey: unmatched</p>
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
      <p>Original mesh → reduced surface · Original coordinates</p>
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
        <dt>Tolerance</dt>
        <dd>±{s.tolerance.toPrecision(3)} mm</dd>
        <dt>Within tolerance</dt>
        <dd>{s.percentage.toFixed(2)}%</dd>
        <dt>Matched samples</dt>
        <dd>
          {s.matched.toLocaleString()} / {s.total.toLocaleString()}
        </dd>
        <dt>Unmatched</dt>
        <dd>{s.unmatched.toLocaleString()}</dd>
      </dl>
      <p>
        Signed original-vertex distances. RMS and extrema use matched samples;
        unmatched samples count outside tolerance.
      </p>
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
