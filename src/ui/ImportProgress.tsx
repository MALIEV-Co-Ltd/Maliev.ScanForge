import "./ImportProgress.css";

export function ImportProgress({
  name,
  fraction,
  onCancel,
}: {
  name: string;
  fraction: number | null;
  onCancel?: () => void;
}) {
  const percent =
    fraction !== null && Number.isFinite(fraction)
      ? Math.round(Math.max(0, Math.min(1, fraction)) * 100)
      : null;
  return (
    <div className="status-import-progress">
      <span className="status-import-filename" title={`Importing ${name}`}>
        Importing {name}
      </span>
      <div
        className={`status-import-track${percent === null ? " indeterminate" : ""}`}
        role="progressbar"
        aria-label={`Importing ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? "Import in progress" : `${percent}%`}
      >
        <span style={{ width: percent === null ? "35%" : `${percent}%` }} />
      </div>
      <span className="status-import-percent">
        {percent === null ? "…" : `${percent}%`}
      </span>
      {onCancel && (
        <button
          className="status-import-cancel"
          aria-label="Cancel import"
          title="Cancel import"
          onClick={onCancel}
        >
          ×
        </button>
      )}
    </div>
  );
}
