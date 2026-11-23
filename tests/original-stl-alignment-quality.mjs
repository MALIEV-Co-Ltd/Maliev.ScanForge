// Independent surface-distance checker. Imports no application geometry/registration code.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { BufferGeometry, BufferAttribute, Vector3 } from "three";
import { MeshBVH, SAH } from "three-mesh-bvh";
const manifestPath = process.argv[2];
const onlyScan = process.argv[3];
assert(manifestPath, "Pass the coordinate-validation manifest path");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert(manifest.passed);
const start = Date.now(),
  deadline = start + 600000,
  controls = [];
const check = () =>
  assert(
    Date.now() < deadline,
    "Independent surface measurement lease expired",
  );
const typed = async (path, Type) => {
  const b = await readFile(path);
  assert.equal(b.byteOffset % 4, 0);
  return new Type(b.buffer, b.byteOffset, b.byteLength / 4);
};
function analyticControls() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0]), 3),
  );
  const tree = new MeshBVH(geometry);
  for (const [p, d] of [
    [[1, 1, 2], 2],
    [[-1, 0, 0], 1],
    [[3, 3, 0], Math.SQRT2],
    [[0, 0, 0], 0],
  ]) {
    const result = tree.closestPointToPoint(new Vector3(...p));
    assert(Math.abs(result.distance - d) < 1e-10);
  }
  geometry.dispose();
}
// Independent point/triangle distance using segment clamps and barycentric projection.
function triangleDistanceSquared(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2],
    aa = dot(ab, ab),
    bb = dot(ab, ac),
    cc = dot(ac, ac),
    d = dot(ab, ap),
    e = dot(ac, ap),
    den = aa * cc - bb * bb;
  if (den > 1e-24) {
    const u = (d * cc - e * bb) / den,
      v = (e * aa - d * bb) / den;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      let sum = 0;
      for (let i = 0; i < 3; i++) sum += (ap[i] - u * ab[i] - v * ac[i]) ** 2;
      return sum;
    }
  }
  let best = Infinity;
  for (const [x, y] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const edge = [y[0] - x[0], y[1] - x[1], y[2] - x[2]],
      delta = [p[0] - x[0], p[1] - x[1], p[2] - x[2]],
      len = dot(edge, edge),
      t = len ? Math.max(0, Math.min(1, dot(delta, edge) / len)) : 0;
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += (delta[i] - edge[i] * t) ** 2;
    best = Math.min(best, sum);
  }
  return best;
}
function brute(point, targets) {
  let best = Infinity,
    boundsChecked = 0,
    trianglesChecked = 0;
  for (const t of targets) {
    const v = t.vertices,
      idx = t.geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3,
        b = idx[i + 1] * 3,
        c = idx[i + 2] * 3;
      let lower = 0;
      for (let axis = 0; axis < 3; axis++) {
        const lo = Math.min(v[a + axis], v[b + axis], v[c + axis]),
          hi = Math.max(v[a + axis], v[b + axis], v[c + axis]),
          d = Math.max(lo - point[axis], 0, point[axis] - hi);
        lower += d * d;
      }
      boundsChecked++;
      if (lower >= best) continue;
      trianglesChecked++;
      best = Math.min(
        best,
        triangleDistanceSquared(
          point,
          [v[a], v[a + 1], v[a + 2]],
          [v[b], v[b + 1], v[b + 2]],
          [v[c], v[c + 1], v[c + 2]],
        ),
      );
    }
  }
  return { distance: Math.sqrt(best), boundsChecked, trianglesChecked };
}
analyticControls();
const retained = [],
  rows = [];
let fixedCount = 0,
  beforeSum = 0,
  afterSum = 0;
async function measure(stage) {
  const meshes = [];
  for (const source of manifest.scans) {
    check();
    const vertices = await typed(source[stage], Float32Array),
      indices = await typed(source.trianglePath, Uint32Array),
      geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(vertices, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const tree = new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 10 });
    meshes.push({ source, vertices, geometry, tree });
  }
  for (let scan = 0; scan < meshes.length; scan++) {
    if (onlyScan && meshes[scan].source.name !== onlyScan) continue;
    check();
    const mesh = meshes[scan],
      targets = meshes.filter((_, i) => i !== scan),
      distances = new Float64Array(mesh.source.vertices),
      p = new Vector3(),
      target = { point: new Vector3() },
      measureStart = Date.now();
    let sum = 0,
      max = 0,
      localCount = 0,
      localBefore = 0,
      localAfter = 0;
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      if (i % 1500000 === 0) check();
      p.set(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]);
      let distance = Infinity;
      for (const t of targets) {
        const hit = t.tree.closestPointToPoint(p, target, 0, distance);
        if (hit) distance = Math.min(distance, hit.distance);
      }
      assert(Number.isFinite(distance));
      const slot = i / 3;
      distances[slot] = distance;
      sum += distance * distance;
      max = Math.max(max, distance);
      if (stage === "global" && retained[scan][slot] <= 0.5) {
        localCount++;
        localBefore += retained[scan][slot] ** 2;
        localAfter += distance ** 2;
      }
    }
    for (const slot of [0, Math.floor(mesh.source.vertices / 2)]) {
      const point = Array.from(mesh.vertices.subarray(slot * 3, slot * 3 + 3)),
        control = brute(point, targets),
        error = Math.abs(control.distance - distances[slot]);
      assert(
        error <= 1e-6,
        JSON.stringify({ stage, scan, slot, error, control }),
      );
      controls.push({ stage, name: mesh.source.name, slot, ...control, error });
    }
    const sorted = distances.slice().sort();
    const row = {
      stage,
      name: mesh.source.name,
      vertices: distances.length,
      rms: Math.sqrt(sum / distances.length),
      p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
      max,
      elapsedMs: Date.now() - measureStart,
    };
    if (stage === "coarse") retained[scan] = distances;
    else {
      Object.assign(row, {
        fixedOverlapVertices: localCount,
        fixedOverlapRmsBefore: Math.sqrt(localBefore / localCount),
        fixedOverlapRmsAfter: Math.sqrt(localAfter / localCount),
      });
      fixedCount += localCount;
      beforeSum += localBefore;
      afterSum += localAfter;
    }
    rows.push(row);
    process.stderr.write(JSON.stringify(row) + "\n");
  }
  for (const m of meshes) m.geometry.dispose();
}
await measure("coarse");
global.gc?.();
await measure("global");
const fixedBefore = Math.sqrt(beforeSum / fixedCount),
  fixedAfter = Math.sqrt(afterSum / fixedCount);
assert(fixedCount > 0);
const targetText = process.env.SCANFORGE_ALIGNMENT_ACCEPTANCE_RMS;
const targetRms = targetText === undefined ? undefined : Number(targetText);
assert(
  targetRms === undefined || (Number.isFinite(targetRms) && targetRms > 0),
  "Acceptance RMS must be positive and finite",
);
const finalRows = rows.filter((r) => r.stage === "global");
const tradeoffs = finalRows
  .filter((r) => r.fixedOverlapRmsAfter >= r.fixedOverlapRmsBefore)
  .map((r) => r.name);
const failures = [];
if (!(fixedAfter < fixedBefore))
  failures.push("Group fixed-overlap RMS did not improve");
for (const row of finalRows) {
  if (
    targetRms === undefined
      ? row.fixedOverlapRmsAfter >= row.fixedOverlapRmsBefore
      : row.fixedOverlapRmsAfter > targetRms
  )
    failures.push(
      `${row.name}: ${targetRms === undefined ? "fixed-overlap RMS did not improve" : "fixed-overlap RMS exceeds target"}`,
    );
}
const report = {
  passed: failures.length === 0,
  acceptance: {
    mode: targetRms === undefined ? "eachScanImproves" : "explicitRmsTarget",
    rmsTargetMm: targetRms,
    groupMustImprove: true,
    tradeoffs,
    failures,
  },
  manifestPath,
  evaluatedScans: onlyScan ? [onlyScan] : manifest.scans.map((s) => s.name),
  scope:
    "Every indexed vertex against complete triangle surfaces of both other scans. No application registration/query code, sampling or normal filters. Fixed support is the same coarse-stage vertex IDs within 0.5 mm. Baseline import is verified separately against public MCP hashes.",
  scans: manifest.scans.map(({ name, vertices, triangles, inputSha256 }) => ({
    name,
    vertices,
    triangles,
    inputSha256,
  })),
  rows,
  fixedOverlap: {
    vertices: fixedCount,
    rmsBefore: fixedBefore,
    rmsAfter: fixedAfter,
  },
  controls,
  analyticControls: 4,
  elapsedMs: Date.now() - start,
};
await writeFile(
  join(dirname(manifestPath), "independent-quality.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));

assert(report.passed, failures.join("; "));
