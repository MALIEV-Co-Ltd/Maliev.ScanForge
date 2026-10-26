import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { evaluatePatch, validatePatch } from "../../src/surfaces.ts";
import { nativeStepPatch } from "./native-step-patch.mjs";
const root = new URL("../../", import.meta.url);
const nativeRoot =
  "C:/repo/alignment-example-files/m5-native-ui-20261026-01a1737c-r1/owned-fit-exchange-r2/native-output/";
const nativeBytes = readFileSync(nativeRoot + "m5-native-simple-4x4-oxy.stp");
const hash = (x) => createHash("sha256").update(x).digest("hex");
assert.equal(
  hash(nativeBytes),
  "1c7bf1331f1294b387f4b059cbd60ed66671abe9e629b3b16307f6d2c6bfdfd7",
);
const { patch: nativePatch } = nativeStepPatch(nativeBytes.toString("utf8"));
const appBytes = readFileSync(
  "C:/repo/alignment-example-files/m5-native-validation-20261026-01a1737c-r3/real-region-fit.json",
);
assert.equal(
  hash(appBytes),
  "a52b9d9b3691281e6084bd07f07a7d1916044dab3c1b325937ad5660f71f0a65",
);
const app = JSON.parse(appBytes.toString("utf8"));
validatePatch(nativePatch);
validatePatch(app.patch);
const stl = readFileSync(
  "C:/repo/alignment-example-files/m5-native-validation-20261026-01a1737c-r3/real-region-input.stl",
);
const sourceHash = hash(stl);
assert.equal(
  sourceHash,
  "b2b80efc269999188cae65751f408d70a8c462b93f20524b57f3ce0850b2576e",
);
assert.equal(stl.readUInt32LE(80), 200);
assert.equal(stl.length, 10084);
const samples = [];
for (let t = 0; t < 200; t++)
  for (let v = 0; v < 3; v++)
    samples.push(
      [0, 1, 2].map((k) => stl.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4)),
    );
const inverseXyToleranceMm = 1e-5;
function xyPoint(patch, x, y) {
  const xs = patch.points.map((p) => p[0]),
    ys = patch.points.map((p) => p[1]);
  let u = (x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs)),
    v = (y - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys));
  const clip = (x) => Math.max(0, Math.min(1, x));
  u = clip(u);
  v = clip(v);
  for (let i = 0; i < 16; i++) {
    const p = evaluatePatch(patch, u, v),
      ex = p[0] - x,
      ey = p[1] - y;
    if (Math.hypot(ex, ey) < 1e-11) break;
    const e = 1e-5,
      ua = clip(u - e),
      ub = clip(u + e),
      va = clip(v - e),
      vb = clip(v + e);
    const a = evaluatePatch(patch, ua, v),
      b = evaluatePatch(patch, ub, v),
      c = evaluatePatch(patch, u, va),
      d = evaluatePatch(patch, u, vb);
    const ux = (b[0] - a[0]) / (ub - ua),
      uy = (b[1] - a[1]) / (ub - ua),
      vx = (d[0] - c[0]) / (vb - va),
      vy = (d[1] - c[1]) / (vb - va),
      det = ux * vy - vx * uy;
    assert(Math.abs(det) > 1e-12);
    u = clip(u - (ex * vy - vx * ey) / det);
    v = clip(v - (ux * ey - ex * uy) / det);
  }
  const point = evaluatePatch(patch, u, v);
  const xyResidual = Math.hypot(point[0] - x, point[1] - y);
  assert(
    xyResidual <= inverseXyToleranceMm,
    `Projected XY inversion failed: ${xyResidual} mm`,
  );
  return { point, u, v, xyResidual };
}
function normalXY(patch, x, y) {
  const { u, v } = xyPoint(patch, x, y),
    e = 1e-5,
    clip = (x) => Math.max(0, Math.min(1, x));
  const a = evaluatePatch(patch, clip(u - e), v),
    b = evaluatePatch(patch, clip(u + e), v),
    c = evaluatePatch(patch, u, clip(v - e)),
    d = evaluatePatch(patch, u, clip(v + e));
  const p = b.map((x, i) => x - a[i]),
    q = d.map((x, i) => x - c[i]),
    n = [
      p[1] * q[2] - p[2] * q[1],
      p[2] * q[0] - p[0] * q[2],
      p[0] * q[1] - p[1] * q[0],
    ],
    length = Math.hypot(...n);
  assert(length > 1e-14);
  return n.map((x) => x / length);
}
function residuals(patch) {
  const rows = samples.map((s) => {
    const p = xyPoint(patch, s[0], s[1]);
    return { z: p.point[2] - s[2], xy: p.xyResidual };
  });
  return {
    scope: "Projected Z residual at source XY, not closest-point/native UI RMS",
    samples: rows.length,
    rmsMm: Math.sqrt(rows.reduce((s, r) => s + r.z * r.z, 0) / rows.length),
    maxAbsMm: Math.max(...rows.map((r) => Math.abs(r.z))),
    maxInverseXyResidualMm: Math.max(...rows.map((r) => r.xy)),
  };
}
const sharedMin = [0, 1].map((k) =>
  Math.max(
    Math.min(...nativePatch.points.map((p) => p[k])),
    Math.min(...app.patch.points.map((p) => p[k])),
  ),
);
const sharedMax = [0, 1].map((k) =>
  Math.min(
    Math.max(...nativePatch.points.map((p) => p[k])),
    Math.max(...app.patch.points.map((p) => p[k])),
  ),
);
const differences = [],
  rectangleInverseResiduals = [],
  normalDots = [];
for (let j = 0; j <= 16; j++)
  for (let i = 0; i <= 16; i++) {
    const x = sharedMin[0] + ((sharedMax[0] - sharedMin[0]) * i) / 16,
      y = sharedMin[1] + ((sharedMax[1] - sharedMin[1]) * j) / 16;
    const native = xyPoint(nativePatch, x, y),
      ours = xyPoint(app.patch, x, y);
    differences.push(native.point[2] - ours.point[2]);
    rectangleInverseResiduals.push(native.xyResidual, ours.xyResidual);
    const n = normalXY(nativePatch, x, y),
      m = normalXY(app.patch, x, y);
    normalDots.push(n.reduce((s, x, k) => s + x * m[k], 0));
  }
const triangleDifferences = [],
  triangleInverseResiduals = [],
  triangleNormalDots = [];
for (let t = 0; t < 200; t++) {
  const p = samples.slice(t * 3, t * 3 + 3),
    x = p.reduce((s, a) => s + a[0], 0) / 3,
    y = p.reduce((s, a) => s + a[1], 0) / 3;
  const native = xyPoint(nativePatch, x, y),
    ours = xyPoint(app.patch, x, y);
  triangleDifferences.push(native.point[2] - ours.point[2]);
  triangleInverseResiduals.push(native.xyResidual, ours.xyResidual);
  const n = normalXY(nativePatch, x, y),
    m = normalXY(app.patch, x, y);
  triangleNormalDots.push(n.reduce((s, a, k) => s + a * m[k], 0));
}
const requests = new Map();
let id = 0;
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) return;
      const p = requests.get(reply.id);
      requests.delete(reply.id);
      reply.error ? p.reject(Error(reply.error)) : p.resolve(reply.result);
    },
  },
});
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context);
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
);
const request = (operation, payload) =>
  new Promise((resolve, reject) => {
    const key = ++id;
    requests.set(key, { resolve, reject });
    context.self.onmessage({ data: { id: key, operation, payload } });
  });
const timer = setTimeout(() => {
  console.error("Native comparison exceeded unchanged90-second kernel lease");
  process.exit(124);
}, 90000);
const ids = [];
let output;
try {
  const native = await request("import", {
    data: new Uint8Array(nativeBytes),
    extension: "step",
  });
  ids.push(native.kernelId);
  const reconstructed = await request("surface", nativePatch);
  ids.push(reconstructed.kernelId);
  const ours = await request("surface", app.patch);
  ids.push(ours.kernelId);
  const reports = {};
  for (const [name, shape] of Object.entries({
    native,
    reconstructed,
    scanforge: ours,
  }))
    reports[name] = await request("inspectBrep", { brep: shape.brep });
  for (const report of Object.values(reports))
    assert(report.valid && report.faces === 1 && report.solids === 0);
  assert(
    Math.abs(reports.native.areaMm2 - reports.reconstructed.areaMm2) <
      Math.max(1e-6, reports.native.areaMm2 * 1e-8),
  );
  const thickened = await request("thicken", {
    kernelId: native.kernelId,
    thickness: -0.1,
  });
  ids.push(thickened.kernelId);
  const thickenedReport = await request("inspectBrep", {
    brep: thickened.brep,
  });
  assert(thickenedReport.valid && thickenedReport.solids === 1);
  output = {
    nativeUi: {
      method: "Simple",
      uLabel: 4,
      vLabel: 4,
      degree: 3,
      orientation: "OXY",
      expand: 0,
      smoothness: 0,
    },
    nativeSerialized: {
      countU: nativePatch.countU,
      countV: nativePatch.countV,
      degreeU: nativePatch.degreeU,
      degreeV: nativePatch.degreeV,
      knotsU: nativePatch.knotsU,
      knotsV: nativePatch.knotsV,
    },
    sourceHash,
    scanforgeFitSha256: hash(appBytes),
    nativeStepSha256: hash(nativeBytes),
    reports,
    nativeProjectedResidual: residuals(nativePatch),
    scanforgeProjectedResidual: residuals(app.patch),
    commonDomain: {
      scope:
        "Intersection of control-net XY bounds, with projected inverse residual checked at every sample; includes extrapolation outside the scanned region",
      inverseXyToleranceMm,
      maxInverseXyResidualMm: Math.max(...rectangleInverseResiduals),
      min: sharedMin,
      max: sharedMax,
      samples: differences.length,
      maxAbsZDifferenceMm: Math.max(...differences.map(Math.abs)),
      rmsZDifferenceMm: Math.sqrt(
        differences.reduce((s, x) => s + x * x, 0) / differences.length,
      ),
    },
    scanforgeKernelThickeningOfNativeSurface: {
      scope:
        "ScanForge kernel on actual native fit; not a native QuickSurface thicken result",
      thicknessMm: -0.1,
      report: thickenedReport,
    },
  };
} finally {
  await request("release", ids);
  clearTimeout(timer);
}
assert.equal(vm.runInContext("shapes.size", context), 0);
assert.equal(hash(stl), sourceHash);
output.commonDomain.normalSamples = normalDots.length;
output.commonDomain.minimumNormalDot = Math.min(...normalDots);
output.commonDomain.maximumNormalAngleDegrees =
  (Math.acos(Math.max(-1, Math.min(1, Math.min(...normalDots)))) * 180) /
  Math.PI;
output.scannedTriangleCentroids = {
  scope:
    "200 source-triangle XY centroids; reported alongside the full rectangular domain, not substituted for it",
  samples: 200,
  inverseXyToleranceMm,
  maxInverseXyResidualMm: Math.max(...triangleInverseResiduals),
  maxAbsZDifferenceMm: Math.max(...triangleDifferences.map(Math.abs)),
  rmsZDifferenceMm: Math.sqrt(
    triangleDifferences.reduce((s, x) => s + x * x, 0) / 200,
  ),
  minimumNormalDot: Math.min(...triangleNormalDots),
  maximumNormalAngleDegrees:
    (Math.acos(Math.max(-1, Math.min(1, Math.min(...triangleNormalDots)))) *
      180) /
    Math.PI,
};
output.cleanup = { remainingKernelHandles: 0, sourceUnchanged: true };
writeFileSync(
  process.env.M5_NATIVE_PROBE_RECEIPT ??
    new URL(".resources/m5/native-fit-comparison.json", root),
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output));
