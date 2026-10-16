import { shiftShrinkwrapTriangles } from "./scan-shrinkwrap-field";
import type { Positions } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import type { ScanToolResult } from "./scan-tools-reduction";
import { extractShrinkwrapScaffold } from "./scan-shrinkwrap-extraction";
import {
  collectShrinkwrapInputs,
  ShrinkwrapSurface,
} from "./scan-shrinkwrap-surface";
import { measureShrinkwrapCoverage } from "./scan-shrinkwrap-coverage";
import { shrinkwrapLocalMesh } from "./scan-shrinkwrap-local";

export interface ShrinkwrapOptions extends MeshProcessingOptions {
  sampleInterval?: number;
  gapFill?: number;
  organicShape?: boolean;
  extraThickness?: number;
  maxDeviation?: number;
  scope?: "whole" | "selected" | "isolated";
  selection?: Uint8Array;
  targets?: Positions[];
}

/** Sample an oriented-source-clipped finite-capsule field, then extract its
 * continuous grid interpolant. Backing and rims are inferred; sampled source
 * coverage is enforced independently and is not a certified Hausdorff bound. */
export function shrinkwrapScanMesh(
  positions: Positions,
  options: ShrinkwrapOptions = {},
): ScanToolResult {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  const sampleInterval = options.sampleInterval ?? 0.5,
    gapFill = options.gapFill ?? 0,
    organicShape = options.organicShape ?? false,
    extraThickness = options.extraThickness ?? 0,
    maxDeviation = options.maxDeviation ?? 0.1,
    scope = options.scope ?? "whole";
  for (const [name, value, positive] of [
    ["Sample interval", sampleInterval, true],
    ["Gap fill", gapFill, false],
    ["Extra thickness", extraThickness, false],
    ["Maximum deviation", maxDeviation, true],
  ] as const)
    if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0))
      throw Error(
        `${name} must be ${positive ? "positive" : "nonnegative"} and finite.`,
      );
  if (typeof organicShape !== "boolean")
    throw Error("Organic shape must be boolean.");
  if (!["whole", "selected", "isolated"].includes(scope))
    throw Error("Unsupported ShrinkWrap scope.");
  if (scope !== "whole") {
    if (options.targets?.length)
      throw Error(
        "Local ShrinkWrap does not accept additional target objects.",
      );
    return shrinkwrapLocalMesh(positions, options);
  }
  if (options.selection)
    throw Error("Whole ShrinkWrap does not accept a triangle selection mask.");
  const inputs = [positions, ...(options.targets ?? [])];
  const coordinates = collectShrinkwrapInputs(inputs, options);
  let magnitude = 0;
  for (let i = 0; i < coordinates.length; i++)
    magnitude = Math.max(magnitude, Math.abs(coordinates[i]));
  const ulp = Math.max(
    2 ** -149,
    2 ** (Math.floor(Math.log2(magnitude || 1)) - 23),
  );
  if (Math.min(sampleInterval, maxDeviation) < 8 * ulp)
    throw Error(
      "Requested ShrinkWrap precision is below Float32 coordinate precision; move the mesh nearer the origin.",
    );
  options.onProgress?.(0, "Indexing source surface");
  check();
  const source = new ShrinkwrapSurface(coordinates, options);
  const inwardShift =
    sampleInterval * (organicShape ? 1.125 : 0.75) + gapFill / 2;
  const radius = inwardShift + extraThickness;
  let field: ShrinkwrapSurface | undefined;
  const supportFrontier = new Map<
    number,
    { supported: boolean; expires: number }
  >();
  let lastRetirement = -1;
  let supportedSamples = 0,
    supportedMaxDeviation = 0;
  try {
    const shifted = shiftShrinkwrapTriangles(coordinates, inwardShift, options);
    field = new ShrinkwrapSurface(shifted, options);
    const gapCheck = source.measureCapturedGaps(
      sampleInterval,
      gapFill,
      extraThickness,
      options,
    );
    const result = extractShrinkwrapScaffold(shifted, {
      ...options,
      targets: undefined,
      resolution: sampleInterval,
      gapFill,
      radius,
      insideNode: (p) => source.signedDistance(p) <= extraThickness,
      scalarValue: (p) =>
        Math.max(
          field!.distance(p) - radius,
          source.signedDistance(p) - extraThickness,
        ),
      onProgress: (f, stage) => {
        check();
        options.onProgress?.(0.05 + 0.85 * f, stage);
        check();
      },
      advance: (cell) => {
        check();
        if (cell - lastRetirement >= 16384) {
          for (const [key, item] of supportFrontier)
            if (item.expires < cell) supportFrontier.delete(key);
          lastRetirement = cell;
        }
        if (supportFrontier.size > 750000)
          throw Error(
            "ShrinkWrap support frontier exceeds bounded memory; split the mesh.",
          );
      },
      transform: (key, expires, p) => {
        const cached = supportFrontier.get(key);
        if (cached)
          return {
            point: p,
            supported: cached.supported,
            normal: [0, 0, 0],
            region: 0,
          };
        const nearest = source.nearest(p, 2 * radius + sampleInterval);
        let supported = false;
        if (nearest) {
          const d = p.reduce(
            (sum, v, k) => sum + (v - nearest.point[k]) * nearest.normal[k],
            0,
          );
          const residual = Math.hypot(
            ...p.map(
              (v, k) =>
                v - nearest.point[k] - extraThickness * nearest.normal[k],
            ),
          );
          supported =
            d >= extraThickness - maxDeviation && residual <= maxDeviation;
          if (supported) {
            supportedSamples++;
            supportedMaxDeviation = Math.max(supportedMaxDeviation, residual);
          }
        }
        supportFrontier.set(key, { expires, supported });
        return { point: p, supported, normal: [0, 0, 0], region: 0 };
      },
    });
    check();
    supportFrontier.clear();
    options.onProgress?.(0.92, "Measuring source coverage");
    check();
    const coverage = measureShrinkwrapCoverage(
      coordinates,
      result.positions,
      extraThickness,
      options,
    );
    if (coverage.sourceCoverageMaxDeviation > maxDeviation)
      throw Error(
        `ShrinkWrap sampled source coverage exceeds maximum deviation (${coverage.sourceCoverageMaxDeviation.toPrecision(5)} > ${maxDeviation} mm); decrease sample interval or gap fill to preserve captured features.`,
      );
    if (!supportedSamples)
      throw Error(
        "ShrinkWrap found no captured source support; decrease sample interval.",
      );
    options.onProgress?.(1, "ShrinkWrap complete");
    check();
    return {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        ...coverage,
        ...gapCheck,
        sampleInterval,
        gapFill,
        organicShape,
        extraThickness,
        maxDeviation,
        scope,
        inputTriangles: coordinates.length / 9,
        inputMeshes: inputs.length,
        inferredBackingDepth: 2 * inwardShift,
        capsuleRadius: radius,
        supportedSamples,
        supportedMaxDeviation,
        sourceFieldMethod:
          "sampled oriented-source-clipped finite-triangle capsule field",
        extraction:
          "shared-grid-edge interpolated continuous scalar isosurface",
        gapFillSemantics:
          "additional inward capsule shift and radius = gapFill / 2; captured planar front fixed; generated rims bridge nearby openings",
        organicShapeSemantics:
          "inward continuation radius increased by 50 percent; captured planar front fixed",
        deviationMeasurement:
          "independent sampled original-source-to-output distance at requested outward offset",
        deviationCertified: false,
        coverageCertified: false,
        generatedBacking: true,
        sourceNormalsUsed: true,
        selfIntersectionsChecked: false,
      },
      summary: `ShrinkWrap: ${result.positions.length / 9} triangles at ${sampleInterval} mm; ${result.topology?.components ?? 0} closed components; sampled source maximum ${coverage.sourceCoverageMaxDeviation.toPrecision(4)} mm. Captured front with inferred ${2 * inwardShift} mm backing depth. Global self-intersections are not certified.`,
    };
  } finally {
    supportFrontier.clear();
    field?.dispose();
    source.dispose();
  }
}
