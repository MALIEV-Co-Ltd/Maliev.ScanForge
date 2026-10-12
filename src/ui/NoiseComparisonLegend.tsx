import "./NoiseComparisonLegend.css";

export function NoiseComparisonLegend({
  threshold,
  visible,
  onToggle,
}: {
  threshold: number;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <section
      className="noise-comparison-legend"
      aria-label="Original surface comparison"
    >
      <strong>
        {visible ? "Original surface comparison" : "Smoothed result"}
      </strong>
      {visible && (
        <>
          <p>
            Signed distance from the original surface to the smoothed result.
          </p>
          <div className="noise-comparison-ramp" aria-hidden="true" />
          <div className="noise-comparison-endpoints">
            <span>−{5 * threshold} mm</span>
            <span>+{5 * threshold} mm</span>
          </div>
          <p>
            <span className="noise-comparison-green" /> Less than ±{threshold}{" "}
            mm
          </p>
          <p>
            <span className="noise-comparison-gray" /> No surface within{" "}
            {5 * threshold} mm
          </p>
        </>
      )}
      <button type="button" aria-pressed={visible} onClick={onToggle}>
        {visible ? "Show smoothed result" : "Show original comparison"}
      </button>
    </section>
  );
}
