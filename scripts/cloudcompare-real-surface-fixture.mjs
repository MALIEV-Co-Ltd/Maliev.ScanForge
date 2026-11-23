import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const sourcePath =
  process.argv[2] ?? "C:/repo/alignment-example-files/asc-1.asc";
const out = new URL(
  "../docs/evidence/cloudcompare-20261028/real-surface/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
const bytes = await readFile(sourcePath),
  lines = bytes.toString().split(/\r?\n/),
  tiles = new Map();
let validPoints = 0,
  normalEligible = 0;
for (let line = 0; line < lines.length; line++) {
  const values = lines[line].trim().split(/\s+/).map(Number);
  if (values.length !== 6 || !values.every(Number.isFinite)) continue;
  validPoints++;
  let eligible = false;
  for (let axis = 0; axis < 3; axis++) {
    const normal = values[3 + axis];
    if (Math.abs(normal) < 0.9) continue;
    eligible = true;
    const key = [
      axis,
      normal < 0 ? -1 : 1,
      ...values.slice(0, 3).map((v, i) => Math.floor(v / (i === axis ? 1 : 5))),
    ].join(",");
    const tile = tiles.get(key) ?? [];
    tile.push({ line, values });
    tiles.set(key, tile);
  }
  if (eligible) normalEligible++;
}
const [tile, points] = [...tiles].sort(
  (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "en"),
)[0];
assert(
  points.length >= 100,
  "No representative dominant-axis surface crop found",
);
const positions = [],
  normals = [];
let maxQuantizationErrorMm = 0;
for (const point of points) {
  for (const v of point.values.slice(0, 3)) {
    positions.push(Math.fround(v));
    maxQuantizationErrorMm = Math.max(
      maxQuantizationErrorMm,
      Math.abs(v - Math.fround(v)),
    );
  }
  normals.push(...point.values.slice(3));
}
const sourceIndices = points.map((point) => point.line);
const [axis, sign, ...tileCoordinates] = tile.split(",").map(Number);
const plane = ["yz", "xz", "xy"][axis];
const manifest = {
  sourcePath,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  sourceValidPoints: validPoints,
  normalEligiblePoints: normalEligible,
  selection: {
    algorithm:
      "For each coordinate axis and normal sign, collect records whose absolute normal component is at least 0.9 into tiles 1mm along that axis and 5mm in both projection dimensions. Choose the most-populated tile; tie-break lexicographically by full tile key. Preserve original file order. No interpolation, smoothing or resampling.",
    tile,
    normalAxis: axis,
    normalSign: sign,
    halfOpenBoundsMm: {
      min: tileCoordinates.map((v, i) => v * (i === axis ? 1 : 5)),
      max: tileCoordinates.map((v, i) => (v + 1) * (i === axis ? 1 : 5)),
    },
    sourceLineIndicesZeroBased: sourceIndices,
  },
  selectedPoints: points.length,
  projectionPlane: plane,
  maxEdgeLengthMm: 0.35,
  maxCoordinateFloat32QuantizationErrorMm: maxQuantizationErrorMm,
  positionsFloat32Sha256: createHash("sha256")
    .update(Buffer.from(Float32Array.from(positions).buffer))
    .digest("hex"),
  scope:
    "Bounded dominant-axis real scan patch. Source cloud retains Float32 samples corresponding to the selected ASC records. Does not establish whole-scan, closed-object or full original decimal-coordinate fidelity.",
};
const project = {
  format: "maliev-scanforge",
  version: 1,
  name: "Owner ASC projected surface",
  units: "mm",
  entities: [
    {
      id: "cloud",
      name: "owner-surface.asc",
      kind: "pointcloud",
      positions,
      normals,
      visible: true,
      color: "#80ff80",
      opacity: 1,
    },
  ],
};
await writeFile(
  new URL("owner-surface-project.json", out),
  JSON.stringify(project) + "\n",
);
await writeFile(
  new URL("owner-surface.asc", out),
  points.map((point) => lines[point.line]).join("\n") + "\n",
);
await writeFile(
  new URL("manifest.json", out),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ...manifest,
    selection: {
      ...manifest.selection,
      sourceLineIndicesZeroBased: `${sourceIndices.length} indices retained in manifest.json`,
    },
  }),
);
