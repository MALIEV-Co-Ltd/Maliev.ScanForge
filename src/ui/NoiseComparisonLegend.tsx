import "./NoiseComparisonLegend.css";

export function NoiseComparisonLegend({
  threshold,
  visible,
  onToggle,
  resultKind = "smoothed",
}: {
  threshold: number;
  visible: boolean;
  onToggle: () => void;
  resultKind?: "smoothed" | "reduced";
}) {
  // Keep native Float32 thresholds for computation; round only their labels.
  const thresholdLabel = Number(threshold.toPrecision(6));
  const rangeLabel = Number((threshold * 5).toPrecision(6));
  return (
    <section
      className="noise-comparison-legend"
      aria-label="Original surface comparison"
    >
      <strong>
        {visible
          ? "Original surface comparison"
          : resultKind === "reduced"
            ? "Reduced result"
            : "Smoothed result"}
      </strong>
      {visible && (
        <>
          <p>
            Signed distance from the original surface to the {resultKind}{" "}
            result.
          </p>
          <div className="noise-comparison-ramp" aria-hidden="true" />
          <div className="noise-comparison-endpoints">
            <span>−{rangeLabel} mm</span>
            <span>+{rangeLabel} mm</span>
          </div>
          <p>
            <span className="noise-comparison-green" /> Less than ±
            {thresholdLabel} mm
          </p>
          <p>
            <span className="noise-comparison-gray" /> No surface within{" "}
            {rangeLabel} mm
          </p>
        </>
      )}
      <button type="button" aria-pressed={visible} onClick={onToggle}>
        {visible ? `Show ${resultKind} result` : "Show original comparison"}
      </button>
    </section>
  );
}
