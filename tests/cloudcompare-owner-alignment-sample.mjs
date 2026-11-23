import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder =
  process.env.SCANFORGE_ALIGNMENT_EXAMPLES ??
  resolve(root, "../alignment-example-files");
const evidence = join(root, "docs/evidence/cloudcompare-20261028");
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const { parsePackedBinaryPly } = await server.ssrLoadModule(
    "/src/ply-binary-topology.ts",
  );
  const { registerFineAlignment } = await server.ssrLoadModule(
    "/src/fine-registration.ts",
  );
  const inputs = {};
  async function load(name) {
    const bytes = await readFile(join(folder, name));
    inputs[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    const mesh = parsePackedBinaryPly(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    assert(mesh?.normals);
    return mesh;
  }
  const source = await load("ply-2.ply"),
    target = await load("ply-1.ply");
  const count = 5000;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const id = Math.floor((i * (source.vertices.length / 3)) / count);
    positions.set(source.vertices.subarray(id * 3, id * 3 + 3), i * 3);
    normals.set(source.normals.subarray(id * 3, id * 3 + 3), i * 3);
  }
  const identity = {
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    translation: [0, 0, 0],
  };
  const options = {
    targetSurface: target,
    sourceNormals: normals,
    targetRms: 0.5,
    maxDistance: 10,
    sampleSize: 2000,
    maxIterations: 3,
  };
  const fifteen = registerFineAlignment(positions, target.vertices, {
    ...options,
    overlapPercent: 15,
  });
  const eightyFive = registerFineAlignment(positions, target.vertices, {
    ...options,
    overlapPercent: 85,
  });
  const nativeMatrix = (
    await readFile(
      join(evidence, "owner-overlap85/moving_REGISTRATION_MATRIX.txt"),
      "utf8",
    )
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  const nativeTransform = {
    rotation: [
      nativeMatrix[0],
      nativeMatrix[1],
      nativeMatrix[2],
      nativeMatrix[4],
      nativeMatrix[5],
      nativeMatrix[6],
      nativeMatrix[8],
      nativeMatrix[9],
      nativeMatrix[10],
    ],
    translation: [nativeMatrix[3], nativeMatrix[7], nativeMatrix[11]],
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(target.vertices, 3));
  geometry.setIndex(new BufferAttribute(target.triangles.slice(), 1));
  const bvh = new MeshBVH(geometry);
  function measure(transform) {
    const distances = [],
      compatible = [];
    const p = new Vector3();
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const r = transform.rotation,
        t = transform.translation;
      const vector = (buffer) =>
        [0, 1, 2].map(
          (axis) =>
            r[axis * 3] * buffer[i * 3] +
            r[axis * 3 + 1] * buffer[i * 3 + 1] +
            r[axis * 3 + 2] * buffer[i * 3 + 2],
        );
      const n = vector(normals),
        v = vector(positions).map((value, axis) =>
          Math.fround(value + t[axis]),
        );
      p.set(...v);
      const hit = bvh.closestPointToPoint(p);
      assert(hit);
      const d2 = hit.distance ** 2;
      distances.push(d2);
      sum += d2;
      const index = geometry.index.array;
      const a = index[hit.faceIndex * 3] * 3,
        b = index[hit.faceIndex * 3 + 1] * 3,
        c = index[hit.faceIndex * 3 + 2] * 3;
      const u = [0, 1, 2].map(
        (axis) => target.vertices[b + axis] - target.vertices[a + axis],
      );
      const w = [0, 1, 2].map(
        (axis) => target.vertices[c + axis] - target.vertices[a + axis],
      );
      const normal = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const normalLengths = Math.hypot(...normal) * Math.hypot(...n);
      if (
        hit.distance <= 10 &&
        normalLengths > 0 &&
        normal.reduce((total, value, axis) => total + value * n[axis], 0) >=
          0.5 * normalLengths
      )
        compatible.push(d2);
    }
    distances.sort((a, b) => a - b);
    compatible.sort((a, b) => a - b);
    const rms = (values, fraction) => {
      const n = Math.min(values.length, Math.ceil(count * fraction));
      return n
        ? Math.sqrt(
            values.slice(0, n).reduce((total, value) => total + value, 0) / n,
          )
        : null;
    };
    return {
      evaluatedPoints: count,
      wholeSourceRmsMm: Math.sqrt(sum / count),
      closest15PercentRmsMm: rms(distances, 0.15),
      closest85PercentRmsMm: rms(distances, 0.85),
      compatibleWithin10mm: compatible.length,
      required15PercentPoints: Math.ceil(count * 0.15),
      compatible15PercentSatisfied:
        compatible.length >= Math.ceil(count * 0.15),
      compatible15PercentRmsMm: rms(compatible, 0.15),
      compatible85PercentAvailableSubsetRmsMm: rms(compatible, 0.85),
    };
  }
  const report = {
    evidenceType:
      "bounded deterministic source sample; independent three-mesh-bvh closest-surface verification against complete owner target mesh",
    inputs,
    sourcePoints: source.vertices.length / 3,
    targetPoints: target.vertices.length / 3,
    targetTriangles: target.triangles.length / 3,
    sample: {
      count,
      selection: "vertex floor(i * sourcePointCount / 5000), i=0..4999",
      fittingSamples: 2000,
      maxIterations: 3,
    },
    initial: measure(identity),
    native85: {
      independentlyMeasured: measure(nativeTransform),
      transform: nativeTransform,
    },
    scanforge15: {
      independentlyMeasured: measure(
        fifteen.applied ? fifteen.transform : identity,
      ),
      registration: fifteen,
    },
    scanforge85: {
      independentlyMeasured: measure(
        eightyFive.applied ? eightyFive.transform : identity,
      ),
      registration: eightyFive,
    },
    limits: [
      "Sample-only evidence; does not replace the failed full-source 300-second ScanForge test.",
      "Owner scan correspondence truth is unknown; nearest-surface residual improvement does not prove correct physical registration.",
      "Native85 transform was fit by a separate native mesh sampling workflow; sample sets, normals policy, overlap and stopping differ.",
      "three-mesh-bvh verification is independent of ScanForge solver target query and RMS; compatible-subset metrics describe available matches even when requested85 percent coverage is not present.",
      "Deterministic input-order sampling is not an area-weighted or random sampling certificate.",
      "Independent BVH and solver normal-compatible counts differ by a few points; nearest-triangle/normal handling is a possible explanation that was not adjudicated.",
    ],
  };
  assert.equal(eightyFive.applied, false);
  assert.equal(fifteen.applied, true);
  assert(
    report.scanforge15.independentlyMeasured.compatible15PercentRmsMm < 0.1,
  );
  await writeFile(
    join(evidence, "owner-ply-sampled-comparison.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
