import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  structuredClone,
  AbortController,
  setTimeout,
  clearTimeout,
  self: { location: { href: new URL("public/cad-worker.js", root).href } },
});
let helperSha256;
context.importScripts = (url) => {
  const bytes = readFileSync(new URL(url));
  vm.runInContext(bytes.toString("utf8"), context);
  if (new URL(url).pathname.endsWith("/sketch-backend.js"))
    helperSha256 = createHash("sha256").update(bytes).digest("hex");
  if (new URL(url).pathname.endsWith("/opencascade.js")) {
    const factory = context.opencascade;
    context.opencascade = (options) =>
      factory({ ...options, wasmBinary: binary });
  }
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
);
const expiry = setTimeout(() => process.exit(124), 90000);
const owners = [];
let checks = 0;
try {
  const oc = await vm.runInContext("kernel()", context);
  const classes = vm.runInContext("loadSketchBackends()", context);
  const check = classes.checkNativeSketchWireSelfConnection;
  assert.equal(typeof check, "function");
  const curve = new classes.SketchLineCurve(oc);
  owners.push(curve);
  assert.equal(
    curve.rebuildCurve({
      kind: "line",
      points: [
        [0, 0, 0],
        [5e-5, 0, 0],
      ],
    }),
    true,
  );
  const start = curve.evaluateFraction(0).map((x) => x * 0.001);
  const end = curve.evaluateFraction(1).map((x) => x * 0.001);
  let samples = 0;
  // Explicit fixture sampler; this test does not infer native sampler policy.
  const result = check(start, end, 1e-12, () => {
    samples++;
    return curve.evaluateFraction(0.5).map((x) => x * 0.001);
  });
  assert.equal(result.candidate, false);
  assert.equal(samples, 1);
  assert.ok(Math.abs(result.endpointDistanceSquared - 2.5e-15) < 1e-29);
  assert.equal(curve.snapshot().hasCurve, true);
  checks++;
  const prepared = curve.prepareBodyCandidate(0.001, {
    linearResolution: 1e-8,
    coordinateDeltaZeroThreshold: 1e-18,
    endpointTolerance: 1e-8,
    coordinateEnvelope: 1000,
    relativeComparisonTolerance: 1.6e-14,
  });
  assert.equal(prepared.status, "candidate");
  owners.push(prepared.candidate);
  assert.ok(!prepared.candidate.wire.IsNull());
  checks++;
  const snapshotBefore = structuredClone(prepared.candidate.snapshot());
  assert.equal(prepared.candidate.checkInputInterval(0).usable, true);
  assert.equal(
    prepared.candidate.checkInputInterval(1e-6).nativeRangeStatus,
    3,
  );
  assert.equal(
    prepared.candidate.checkInputInterval(5.0000000000000004e-8).usable,
    false,
  );
  assert.throws(
    () => prepared.candidate.checkInputInterval(undefined),
    /threshold/,
  );
  assert.deepEqual(prepared.candidate.snapshot(), snapshotBefore);
  checks++;
  const nativeWitness = prepared.candidate.checkSelfConnection(1e-12);
  assert.equal(nativeWitness.candidate, false);
  // Conversion retains its evaluated/normalized interval, not the nominal
  // primary midpoint scaled afterward. Keep this one-bit distinction.
  assert.equal(
    snapshotBefore.request.conversion.interval[1],
    5.0000000000000004e-8,
  );
  assert.equal(nativeWitness.witnessParameter, 2.5000000000000002e-8);
  assert.deepEqual(
    Array.from(nativeWitness.witness),
    [2.5000000000000002e-8, 0, 0],
  );
  assert.deepEqual(prepared.candidate.snapshot(), snapshotBefore);
  nativeWitness.endpoints.start[0] = 100;
  assert.equal(prepared.candidate.snapshot().request.start[0], 0);
  checks++;
  assert.throws(
    () => prepared.candidate.checkSelfConnection(undefined),
    /threshold/,
  );
  assert.deepEqual(prepared.candidate.snapshot(), snapshotBefore);
  assert.ok(!prepared.candidate.wire.IsNull());
  checks++;
  context.selfConnectionKernel = oc;
  const circle = vm.runInContext(
    "new SketchCircleBackend(selfConnectionKernel)",
    context,
  );
  owners.push(circle);
  assert.equal(
    circle.rebuild({ kind: "circle", center: [0, 0, 0], radius: 2 }),
    true,
  );
  const adaptor = new oc.BRepAdaptor_Curve_2(circle.edge);
  try {
    const at = (parameter) => {
      const point = adaptor.Value(parameter);
      try {
        return [point.X(), point.Y(), point.Z()];
      } finally {
        point.delete();
      }
    };
    const first = adaptor.FirstParameter(),
      last = adaptor.LastParameter();
    const loop = check(at(first), at(last), 1e-12, () =>
      at((last + first) * 0.5),
    );
    assert.equal(loop.candidate, true);
    assert.ok(loop.startWitnessDistanceSquared > 15.999999);
    assert.ok(loop.endWitnessDistanceSquared > 15.999999);
  } finally {
    adaptor.delete();
  }
  checks++;
  prepared.candidate.dispose();
  assert.throws(
    () => prepared.candidate.checkSelfConnection(1e-12),
    /disposed/,
  );
  assert.throws(() => prepared.candidate.checkInputInterval(0), /disposed/);
  checks++;
  const distant = check(start, [2e-3, 0, 0], 1e-12, () => {
    throw new Error("unused query");
  });
  assert.equal(distant.candidate, false);
  checks++;
  for (let i = 0; i < 100; i++) {
    assert.equal(
      curve.rebuildCurve({
        kind: "line",
        points: [
          [0, 0, 0],
          [5e-5, 0, 0],
        ],
      }),
      true,
    );
    assert.equal(
      check(
        [0, 0, 0],
        curve.evaluateFraction(1).map((x) => x * 0.001),
        1e-12,
        () => curve.evaluateFraction(0.5).map((x) => x * 0.001),
      ).candidate,
      false,
    );
  }
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Shared worker scalar test with real owned line queries and 100 retirement cycles; no complete native admission or GUI/MCP authoring claim",
    }),
  );
} finally {
  for (const owner of owners) owner.dispose();
  clearTimeout(expiry);
}
