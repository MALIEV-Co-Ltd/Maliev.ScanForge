import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { BufferGeometry, BufferAttribute, Vector3 } from "three";
import { verifyMeshIntersections } from "./m3-mesh-intersections.mjs";
import { MeshBVH, PointsBVH } from "three-mesh-bvh";

// Independent library queries against the complete output and complete XYZ set.
// Deterministic record samples are not a Hausdorff or self-intersection certificate.
const [directory, outputDirectory] = process.argv.slice(2);
assert(
  directory && outputDirectory,
  "Pass original folder and browser evidence directory",
);
const evidence = JSON.parse(
  await readFile(join(outputDirectory, "evidence.json"), "utf8"),
);
assert.equal(evidence.passed, true);
const output = JSON.parse(
  await readFile(join(outputDirectory, "output-geometry.json"), "utf8"),
);
const positions = Float32Array.from(output.positions);
const geometry = new BufferGeometry();
geometry.setAttribute("position", new BufferAttribute(positions, 3));
const mesh = new MeshBVH(geometry, { targetLeafSize: 8 });
const counts = evidence.pointCounts,
  total = counts.reduce((a, b) => a + b, 0);
const all = new Float32Array(total * 3);
let written = 0;
const perScan = [];
const q = new Vector3();
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  assert(sorted.every(Number.isFinite));
  return {
    samples: values.length,
    rms: Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
}
for (let scan = 1; scan <= 3; scan++) {
  let index = 0,
    sample = 0;
  const distances = [];
  const count = counts[scan - 1],
    n = Math.min(4096, count);
  const lines = createInterface({
    input: createReadStream(join(directory, `asc-${scan}.asc`)),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const xyz = line.trim().split(/\s+/).slice(0, 3).map(Number);
    assert(xyz.length === 3 && xyz.every(Number.isFinite));
    for (let a = 0; a < 3; a++) all[written++] = Math.fround(xyz[a]);
    if (sample < n && index === Math.floor((sample * (count - 1)) / (n - 1))) {
      q.fromArray(all, written - 3);
      const hit = mesh.closestPointToPoint(q);
      assert(hit);
      distances.push(hit.distance);
      sample++;
    }
    index++;
  }
  assert.equal(index, count);
  perScan.push({ scan, points: count, sourceToMesh: stats(distances) });
}
assert.equal(written, all.length);
const pointGeometry = new BufferGeometry();
pointGeometry.setAttribute("position", new BufferAttribute(all, 3));
const points = new PointsBVH(pointGeometry, { targetLeafSize: 16 });
const reverse = [];
let pointTests = 0;
// Area-weighted deterministic triangle sampling avoids bias toward dense tessellation.
const areas = new Float64Array(positions.length / 9);
let area = 0;
const a = new Vector3(),
  b = new Vector3(),
  c = new Vector3(),
  u = new Vector3(),
  v = new Vector3();
for (let i = 0; i < areas.length; i++) {
  a.fromArray(positions, i * 9);
  b.fromArray(positions, i * 9 + 3);
  c.fromArray(positions, i * 9 + 6);
  area += u.subVectors(b, a).cross(v.subVectors(c, a)).length() / 2;
  areas[i] = area;
}
let face = 0;
for (let i = 0; i < 4096; i++) {
  const target = (area * (i + 0.5)) / 4096;
  while (areas[face] < target) face++;
  a.fromArray(positions, face * 9);
  b.fromArray(positions, face * 9 + 3);
  c.fromArray(positions, face * 9 + 6);
  const r = Math.sqrt(((i + 1) * 0.6180339887498949) % 1),
    t = ((i + 1) * 0.4142135623730951) % 1;
  q.copy(a)
    .multiplyScalar(1 - r)
    .addScaledVector(b, r * (1 - t))
    .addScaledVector(c, r * t);
  let best = Infinity;
  points.shapecast({
    boundsTraverseOrder: (box) => box.distanceToPoint(q),
    intersectsBounds: (box) => box.distanceToPoint(q) ** 2 <= best,
    intersectsPoint: (p) => {
      pointTests++;
      best = Math.min(best, p.distanceToSquared(q));
      return false;
    },
  });
  reverse.push(Math.sqrt(best));
}
const intersections = verifyMeshIntersections(mesh);
const report = {
  passed: intersections.invalidIntersections === 0,
  intersections,
  scope:
    "Independent three-mesh-bvh nearest-surface and full-point-set nearest-point queries on deterministic samples; original placement unchanged, millimetres; not a global distance bound, aligned/native-equivalence result or exact-arithmetic proof",
  sourceToMesh: perScan,
  areaWeightedMeshToFullPointSet: stats(reverse),
  outputTriangles: positions.length / 9,
  pointTests,
  selfIntersectionsChecked: true,
};
await writeFile(
  join(outputDirectory, "quality.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
assert(report.passed, "Invalid triangle intersections detected");
