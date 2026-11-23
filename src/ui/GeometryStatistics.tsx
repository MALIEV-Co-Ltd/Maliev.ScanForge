import type { EntityDisplayStats } from "../entity-display-stats";

const number = (value: number) =>
  value.toLocaleString("en", { maximumFractionDigits: 3 });
export function GeometryStatistics({ stats }: { stats: EntityDisplayStats }) {
  return (
    <>
      <dl>
        {stats.kind === "reference" ? (
          <>
            <dt>{stats.lines ? "Reference lines" : "Reference points"}</dt>
            <dd>{number(stats.lines || stats.points)}</dd>
            <dt>{stats.lines ? "Minimum (mm)" : "Position (mm)"}</dt>
            <dd>{stats.min.map(number).join(" · ")}</dd>
            {!!stats.lines && (
              <>
                <dt>Maximum (mm)</dt>
                <dd>{stats.max.map(number).join(" · ")}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>
              {stats.kind === "pointcloud"
                ? "Points"
                : "Vertices (triangle soup)"}
            </dt>
            <dd>{number(stats.vertices)}</dd>
            {stats.kind === "mesh" && (
              <>
                <dt>Triangles</dt>
                <dd>{number(stats.triangles)}</dd>
              </>
            )}
          </>
        )}
        <dt>Bounds (mm)</dt>
        <dd>{stats.size.map(number).join(" × ")}</dd>
        {stats.kind === "mesh" && (
          <>
            <dt>Surface area (mm²)</dt>
            <dd>{number(stats.area)}</dd>
            <dt>Volume estimate (mm³)</dt>
            <dd>{number(stats.volume)}</dd>
          </>
        )}
      </dl>
      {stats.kind === "mesh" && (
        <p className="muted">
          Volume assumes a closed, consistently oriented mesh.
        </p>
      )}
    </>
  );
}
