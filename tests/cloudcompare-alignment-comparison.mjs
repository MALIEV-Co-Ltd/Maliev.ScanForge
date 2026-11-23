import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = join(root, "docs/evidence/cloudcompare-20261028");
const fixtures = join(evidence, "fixtures");
const inputs = {};
async function read(name) {
  const bytes = await readFile(join(fixtures, name));
  inputs[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return bytes.toString("utf8");
}
function ply(text) {
  const [header, body] = text.split(/end_header\r?\n/);
  assert.match(header, /format ascii 1.0/);
  const count = Number(header.match(/element vertex (\d+)/)[1]);
  const points = body
    .trim()
    .split(/\r?\n/)
    .slice(0, count)
    .flatMap((line) => line.trim().split(/\s+/).slice(0, 3).map(Number));
  assert.equal(points.length, count * 3);
  assert(points.every(Number.isFinite));
  return new Float32Array(points);
}
// Independent arithmetic: neither solver transforms nor solver residuals define quality.
function apply(points, transform) {
  const output = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3)
    for (let axis = 0; axis < 3; axis++)
      output[i + axis] =
        transform.translation[axis] +
        points[i] * transform.rotation[axis * 3] +
        points[i + 1] * transform.rotation[axis * 3 + 1] +
        points[i + 2] * transform.rotation[axis * 3 + 2];
  return output;
}
function residual(points, fixed) {
  assert.equal(points.length, fixed.length);
  let sum = 0,
    maximum = 0;
  for (let i = 0; i < points.length; i += 3) {
    const distance = Math.hypot(
      points[i] - fixed[i],
      points[i + 1] - fixed[i + 1],
      points[i + 2] - fixed[i + 2],
    );
    sum += distance * distance;
    maximum = Math.max(maximum, distance);
  }
  return {
    correspondingPointRmsMm: Math.sqrt(sum / (points.length / 3)),
    maximumCorrespondingErrorMm: maximum,
  };
}
function transformError(actual, truth) {
  return {
    rotationMatrixFrobeniusError: Math.hypot(
      ...actual.rotation.map((value, i) => value - truth.rotation[i]),
    ),
    maximumRotationCoefficientError: Math.max(
      ...actual.rotation.map((value, i) => Math.abs(value - truth.rotation[i])),
    ),
    translationErrorMm: Math.hypot(
      ...actual.translation.map((value, i) => value - truth.translation[i]),
    ),
  };
}
const moving = ply(await read("moving.ply"));
const fixed = ply(await read("fixed.ply"));
const truth = JSON.parse(await read("truth.json"));
assert.equal(moving.length / 3, truth.points);
const rotation = truth.movingFromFixed.rotation;
const inverse = {
  rotation: [
    rotation[0],
    rotation[3],
    rotation[6],
    rotation[1],
    rotation[4],
    rotation[7],
    rotation[2],
    rotation[5],
    rotation[8],
  ],
  translation: [0, 1, 2].map(
    (axis) =>
      -[0, 1, 2].reduce(
        (sum, row) =>
          sum +
          rotation[row * 3 + axis] * truth.movingFromFixed.translation[row],
        0,
      ),
  ),
};
assert(
  transformError(inverse, truth.fixedFromMoving).translationErrorMm < 1e-14,
);
assert(
  transformError(inverse, truth.fixedFromMoving).rotationMatrixFrobeniusError <
    1e-14,
);
const matrix = (await read("moving_REGISTRATION_MATRIX.txt"))
  .trim()
  .split(/\s+/)
  .map(Number);
assert.equal(matrix.length, 16);
const nativeTransform = {
  rotation: [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[8],
    matrix[9],
    matrix[10],
  ],
  translation: [matrix[3], matrix[7], matrix[11]],
};
const nativeOutput = (await read("moving_REGISTERED.asc"))
  .trim()
  .split(/\r?\n/)
  .flatMap((line) => line.trim().split(/\s+/).slice(0, 3).map(Number));
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
let result;
const options = {
  overlapPercent: 100,
  targetRms: 1e-5,
  sampleSize: truth.points,
  maxDistance: 10,
  tolerance: 1e-7,
  maxIterations: 200,
};
try {
  const { registerFineAlignment } = await server.ssrLoadModule(
    "/src/fine-registration.ts",
  );
  result = registerFineAlignment(moving, fixed, options);
} finally {
  await server.close();
}
const identity = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
};
const report = {
  evidenceType:
    "independent synthetic numerical comparison; native CLI output versus current ScanForge solver",
  points: truth.points,
  units: truth.units,
  inputs,
  precision:
    "PLY float coordinates rounded to Float32 on both inputs; ScanForge output independently rounded to Float32. Native saved ASC retains its printed precision.",
  truth: inverse,
  initial: { ...residual(moving, fixed), ...transformError(identity, inverse) },
  native: {
    ...residual(nativeOutput, fixed),
    ...transformError(nativeTransform, inverse),
    transform: nativeTransform,
    matrixAppliedWithIndependentFloat32Arithmetic: residual(
      apply(moving, nativeTransform),
      fixed,
    ),
  },
  scanforge: {
    ...residual(apply(moving, result.transform), fixed),
    ...transformError(result.transform, inverse),
    transform: result.transform,
    options,
    iterations: result.iterations,
    terminationReason: result.terminationReason,
    applied: result.applied,
  },
  limits: [
    "One asymmetric synthetic full-overlap fixture establishes local rigid accuracy only.",
    "CloudCompare CLI and GUI settings differ; this does not establish algorithmic equivalence.",
    "Corresponding-point quality uses preserved fixture point ordering, not nearest-neighbour residuals or either solver's reported RMS.",
    "No browser or public MCP execution in this numerical script; separate fine-browser evidence supplies those checks.",
  ],
};
assert(report.native.correspondingPointRmsMm < 1e-5);
assert(report.scanforge.correspondingPointRmsMm < 1e-5);
assert(report.native.translationErrorMm < 1e-5);
assert(report.scanforge.translationErrorMm < 1e-5);
assert(report.native.rotationMatrixFrobeniusError < 1e-6);
assert(report.scanforge.rotationMatrixFrobeniusError < 1e-6);
assert.equal(report.scanforge.applied, true);
await writeFile(
  join(evidence, "synthetic-alignment-comparison.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
