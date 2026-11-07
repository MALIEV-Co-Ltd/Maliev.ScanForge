import { Fragment, type ReactNode } from "react";
import { Check, Circle, Triangle } from "./GeneratedUiIcons";
import type { ProcessingResult } from "../processing-client";
import "./MeshOperationResult.css";

type Metric = [string, ReactNode];
function Metrics({
  rows,
  label,
  className = "",
}: {
  rows: Metric[];
  label: string;
  className?: string;
}) {
  return (
    <dl className={`mesh-result-metrics ${className}`} aria-label={label}>
      {rows.map(([name, value]) => (
        <Fragment key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
function millimetres(value: number | null) {
  return value === null ? (
    "Unavailable"
  ) : (
    <span title={String(value)}>
      {value.toPrecision(4)} <small>mm</small>
    </span>
  );
}
function diagnosticValue(value: number | string | boolean | null) {
  return value === null ? (
    "Unavailable"
  ) : typeof value === "boolean" ? (
    value ? (
      "Yes"
    ) : (
      "No"
    )
  ) : typeof value === "number" ? (
    <span title={String(value)}>
      {Number.isInteger(value) ? value.toLocaleString() : value.toPrecision(6)}
    </span>
  ) : (
    value
  );
}
const label = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export function MeshOperationResult({ result }: { result: ProcessingResult }) {
  const registration = result.registration;
  const fine =
    registration && "overlapRms" in registration ? registration : undefined;
  const success = fine
    ? fine.targetReached
    : result.refinement
      ? result.refinement.accepted
      : undefined;
  const unchanged =
    fine?.applied === false || result.refinement?.accepted === false;
  const outcome = fine
    ? unchanged
      ? "Alignment not applied"
      : success
        ? "Target reached"
        : "Target not reached"
    : result.refinement
      ? success
        ? "Refinement accepted"
        : "Refinement not applied"
      : "Operation result";
  const reason = fine
    ? {
        targetReached: "Target accuracy reached",
        stoppedImproving: "Stopped improving",
        iterationLimit: "Iteration limit reached",
        insufficientOverlap: "Insufficient compatible overlap",
      }[fine.terminationReason]
    : undefined;
  const Icon = success ? Check : fine || result.refinement ? Triangle : Circle;
  const diagnostics: Metric[] = Object.entries(result.diagnostics)
    .filter(
      ([key]) => !["pointCloudPose", "localBuffersRetained"].includes(key),
    )
    .filter(
      ([key]) =>
        !fine || ["iterations", "maxError", "rejectedPoints"].includes(key),
    )
    .map(([key, value]) => [
      label(key),
      key === "maxError" && typeof value === "number"
        ? millimetres(value)
        : diagnosticValue(value),
    ]);
  if (fine)
    diagnostics.push(
      [
        "Fitting samples",
        `${fine.fittingSamples.toLocaleString()} / ${fine.sampleSize.toLocaleString()} requested`,
      ],
      [
        "Matching",
        fine.matching === "fullTargetSurface"
          ? "Visible target surface"
          : "Target points",
      ],
      [
        "Normal compatibility",
        fine.normalCompatibility ? "60°" : "Unavailable",
      ],
      ...(fine.normalCompatibility
        ? [
            [
              "Rejected by normals",
              fine.rejectedNormalPoints.toLocaleString(),
            ] as Metric,
          ]
        : []),
    );
  return (
    <section
      className="mesh-operation-result"
      aria-label="Mesh operation result"
      role="status"
      aria-atomic="false"
    >
      <header
        className="mesh-result-outcome"
        data-tone={
          success
            ? "success"
            : fine || result.refinement
              ? "warning"
              : "neutral"
        }
      >
        <Icon size={16} aria-hidden="true" />
        <div>
          <h4>{outcome}</h4>
          {reason && (
            <span>
              {reason} · {fine?.iterations.toLocaleString()}{" "}
              {fine?.iterations === 1 ? "iteration" : "iterations"}
            </span>
          )}
          {fine?.applied && <span>Alignment applied</span>}
        </div>
      </header>
      {fine && (
        <>
          <Metrics
            label="Alignment accuracy"
            className="mesh-result-accuracy"
            rows={[
              ["Overlap RMS", millimetres(fine.overlapRms)],
              ["Target RMS", millimetres(fine.targetRms)],
              ["Whole-cloud RMS", millimetres(fine.wholeCloudRms)],
            ]}
          />
          <Metrics
            label="Overlap coverage"
            rows={[
              ["Expected overlap", `${fine.overlapPercent}%`],
              [
                fine.normalCompatibility
                  ? "Compatible within distance"
                  : "Within search distance",
                `${(fine.overlapFraction * 100).toFixed(1)}%`,
              ],
              [
                "Overlap points",
                <span>
                  {fine.overlapPoints.toLocaleString()} /{" "}
                  {fine.requiredOverlapPoints.toLocaleString()}{" "}
                  <small>required</small>
                </span>,
              ],
            ]}
          />
        </>
      )}
      {unchanged && (
        <p className="mesh-result-note">
          Geometry unchanged; no history entry created.
        </p>
      )}
      {fine && !fine.overlapSatisfied && (
        <p role="alert" className="mesh-result-note">
          Insufficient overlap within the search distance or normal
          compatibility; target accuracy not reached. Reduce expected overlap to
          match the shared region, or improve the starting alignment.
        </p>
      )}
      {result.topology && (
        <Metrics
          label="Topology"
          rows={Object.entries(result.topology).map(([key, value]) => [
            label(key),
            value.toLocaleString(),
          ])}
        />
      )}
      {diagnostics.length > 0 && (
        <details className="mesh-result-details">
          <summary>Diagnostics</summary>
          <Metrics label="Operation diagnostics" rows={diagnostics} />
        </details>
      )}
      {!!result.segmentClassifications?.length && (
        <details className="mesh-result-details">
          <summary>
            Regions · {result.segmentClassifications.length.toLocaleString()}
          </summary>
          {result.segmentClassifications.map((region, index) => (
            <section key={index} className="mesh-result-part">
              <h5>
                Region {index + 1} ·{" "}
                {region.kind === "freeform"
                  ? "Unclassified / freeform"
                  : region.kind}
              </h5>
              <Metrics
                label={`Region ${index + 1}`}
                rows={[
                  ["Samples", region.samples.toLocaleString()],
                  ...(region.rms !== undefined
                    ? [["RMS", millimetres(region.rms)] as Metric]
                    : []),
                  ...(region.maxError !== undefined
                    ? [
                        [
                          "Maximum residual",
                          millimetres(region.maxError),
                        ] as Metric,
                      ]
                    : []),
                  ["Tolerance", millimetres(region.tolerance)],
                  ["Reason", region.reason],
                ]}
              />
            </section>
          ))}
        </details>
      )}
      {!!result.repairSheets?.length && (
        <details className="mesh-result-details">
          <summary>
            Sheets · {result.repairSheets.length.toLocaleString()}
          </summary>
          {result.repairSheets.map((sheet, index) => (
            <section key={index} className="mesh-result-part">
              <h5>
                Sheet {index + 1} ·{" "}
                {sheet.watertight ? "Watertight" : "Open boundary"}
              </h5>
              <Metrics
                label={`Sheet ${index + 1}`}
                rows={[
                  ["Triangles", sheet.triangles.toLocaleString()],
                  ["Boundary edges", sheet.boundaryEdges.toLocaleString()],
                  [
                    "Nonmanifold edges",
                    sheet.nonManifoldEdges.toLocaleString(),
                  ],
                  [
                    "Nonmanifold vertices",
                    sheet.nonManifoldVertices.toLocaleString(),
                  ],
                ]}
              />
            </section>
          ))}
        </details>
      )}
    </section>
  );
}
