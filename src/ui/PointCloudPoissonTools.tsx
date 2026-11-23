import { useState } from "react";
import type { PointCloudPoissonOptions } from "../point-cloud-poisson-input";
import type { PointCloudNormalMode } from "../point-cloud-normals";
import { AppSelect } from "./AppSelect";

export function PointCloudPoissonTools({
  count,
  hasNormals,
  onApply,
}: {
  count: number;
  hasNormals: boolean;
  onApply: (options: PointCloudPoissonOptions) => void;
}) {
  const [normalMode, setNormalMode] =
    useState<PointCloudNormalMode>("provided");
  const [depth, setDepth] = useState(8);
  const [densityThreshold, setDensity] = useState(0);
  const [normalNeighbors, setNeighbors] = useState(24);
  const [pointWeight, setWeight] = useState(2);
  const [samplesPerNode, setSamples] = useState(1.5);
  const [viewpoint, setViewpoint] = useState<[number, number, number]>([
    0, 0, 0,
  ]);
  const valid =
    count >= 3 &&
    count <= 500000 &&
    Number.isInteger(depth) &&
    depth >= 6 &&
    depth <= 10 &&
    Number.isFinite(densityThreshold) &&
    densityThreshold >= 0 &&
    densityThreshold <= 32 &&
    Number.isInteger(normalNeighbors) &&
    normalNeighbors >= 8 &&
    normalNeighbors <= 48 &&
    Number.isFinite(pointWeight) &&
    pointWeight >= 0 &&
    pointWeight <= 100 &&
    Number.isFinite(samplesPerNode) &&
    samplesPerNode >= 0.1 &&
    samplesPerNode <= 100 &&
    ((normalMode !== "provided" && normalMode !== "estimate-provided") ||
      hasNormals) &&
    (normalMode !== "estimate-viewpoint" || viewpoint.every(Number.isFinite));
  return (
    <details>
      <summary>Reconstruct a 3D surface</summary>
      <label>
        Normal orientation
        <AppSelect
          aria-label="Poisson normal orientation"
          value={normalMode}
          onChange={(event) =>
            setNormalMode(event.target.value as PointCloudNormalMode)
          }
        >
          <option value="provided" disabled={!hasNormals}>
            Use existing oriented normals
          </option>
          <option value="estimate-provided" disabled={!hasNormals}>
            Estimate using existing orientations
          </option>
          <option value="estimate-outward">
            Estimate outward for a closed object
          </option>
          <option value="estimate-viewpoint">
            Estimate toward scanner viewpoint
          </option>
        </AppSelect>
      </label>
      <p>
        {normalMode === "provided"
          ? "Existing normals must be finite, nonzero and consistently oriented. Choose estimation using existing orientations to rebuild noisy or missing vectors."
          : normalMode === "estimate-provided"
            ? "Rebuild local normals and orient each connected neighborhood using valid existing normals. Source orientations remain the reference."
            : normalMode === "estimate-outward"
              ? "Assumes closed surface components. Avoid this mode for open scan patches."
              : "Assumes one scanner viewpoint. Enter its position in the current world coordinates."}
      </p>
      {normalMode === "estimate-viewpoint" && (
        <>
          {["X", "Y", "Z"].map((axis, i) => (
            <label key={axis}>
              Scanner {axis} (mm)
              <input
                aria-label={`Poisson scanner ${axis} (mm)`}
                type="number"
                step="1"
                value={viewpoint[i]}
                onChange={(event) =>
                  setViewpoint(
                    viewpoint.map((v, a) =>
                      a === i ? event.target.valueAsNumber : v,
                    ) as [number, number, number],
                  )
                }
              />
            </label>
          ))}
        </>
      )}
      <label>
        Reconstruction depth
        <input
          aria-label="Poisson reconstruction depth"
          type="number"
          min="6"
          max="10"
          step="1"
          value={depth}
          onChange={(event) => setDepth(event.target.valueAsNumber)}
        />
      </label>
      <label>
        Density trimming threshold
        <input
          aria-label="Poisson density trimming threshold"
          type="number"
          min="0"
          max="32"
          step="0.25"
          value={densityThreshold}
          onChange={(event) => setDensity(event.target.valueAsNumber)}
        />
      </label>
      <p>
        Creates a new general 3D Poisson mesh and preserves the cloud. Zero
        density threshold keeps the whole surface, which can close holes and
        extend beyond open scans. Increase it to discard poorly supported
        triangles; trimming can open boundaries and split the mesh. Higher depth
        uses more memory.
      </p>
      <details>
        <summary>Advanced Poisson settings</summary>
        <label>
          Normal neighbors
          <input
            aria-label="Poisson normal neighbors"
            type="number"
            min="8"
            max="48"
            step="1"
            disabled={normalMode === "provided"}
            value={normalNeighbors}
            onChange={(event) => setNeighbors(event.target.valueAsNumber)}
          />
        </label>
        <label>
          Point weight
          <input
            aria-label="Poisson point weight"
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={pointWeight}
            onChange={(event) => setWeight(event.target.valueAsNumber)}
          />
        </label>
        <label>
          Samples per node
          <input
            aria-label="Poisson samples per node"
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={samplesPerNode}
            onChange={(event) => setSamples(event.target.valueAsNumber)}
          />
        </label>
      </details>
      <button
        disabled={!valid}
        onClick={() =>
          onApply({
            normalMode,
            depth,
            densityThreshold,
            normalNeighbors,
            pointWeight,
            samplesPerNode,
            ...(normalMode === "estimate-viewpoint" ? { viewpoint } : {}),
          })
        }
      >
        Create Poisson mesh
      </button>
      {count > 500000 && (
        <p>Reduce the cloud to 500,000 points or fewer first.</p>
      )}
      {!hasNormals &&
        (normalMode === "provided" || normalMode === "estimate-provided") && (
          <p>This cloud has no normals. Choose a normal estimation method.</p>
        )}
    </details>
  );
}
