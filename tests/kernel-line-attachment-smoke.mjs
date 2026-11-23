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
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  const settings = {
    linearResolution: 1e-8,
    coordinateDeltaZeroThreshold: 1e-18,
    endpointTolerance: 1e-8,
    coordinateEnvelope: 1000,
    relativeComparisonTolerance: 1.6e-14,
  };
  const request = {
    kind: "line",
    points: [
      [1, 2, 3],
      [4, 6, 8],
    ],
  };
  const make = () => {
    const d = new classes.SketchLineBackendDraft(oc);
    owners.push(d);
    assert.equal(
      d.rebuild(request, 0.001, settings).attempt.status,
      "pending-validation",
    );
    return d;
  };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const d = make(),
    primary = d.edge,
    wire = d.wire,
    edge = d.firstEdge;
  const range = d.applyAttachmentResult({ stage: "edge-range", status: 5 });
  assert.equal(range.continues, true);
  assert.equal(range.wireStatus, undefined);
  assert.equal(d.wire, wire);
  assert.equal(d.edge, primary);
  assert.equal(d.snapshot().attempt.status, "pending-validation");
  checks++;
  const failed = d.applyAttachmentResult({ stage: "edge-curve", status: 5 });
  assert.equal(failed.wireStatus, 1);
  assert.equal(wire.isDeleted(), true);
  assert.equal(edge.isDeleted(), true);
  assert.equal(primary.isDeleted(), false);
  assert.equal(d.wire, undefined);
  assert.equal(d.snapshot().kind, "line");
  assert.deepEqual(plain(d.snapshot().records), request.points);
  assert.equal(d.snapshot().attempt.status, "attachment-rejected");
  assert.deepEqual(Array.from(d.midpoint()), [0, 0, 0]);
  checks++;
  for (const [stage, status, wireStatus] of [
    ["start-point", 5, 4],
    ["end-point", 5, 4],
    ["edge-range", 2, 4],
    ["edge-curve", 2, 4],
  ]) {
    const fresh = make(),
      p = fresh.edge,
      w = fresh.wire,
      e = fresh.firstEdge;
    assert.equal(
      fresh.applyAttachmentResult({ stage, status }).wireStatus,
      wireStatus,
    );
    assert.equal(w.isDeleted(), true);
    assert.equal(e.isDeleted(), true);
    assert.equal(p.isDeleted(), false);
    assert.equal(fresh.snapshot().hasBodyCandidate, false);
  }
  checks++;
  const valid = make(),
    snapshot = plain(valid.snapshot()),
    w = valid.wire;
  for (const input of [
    { stage: "unknown", status: 1 },
    { stage: "edge-range", status: true },
    { stage: "edge-range", status: 5, accepted: true },
  ]) {
    assert.throws(() => valid.applyAttachmentResult(input));
    assert.deepEqual(plain(valid.snapshot()), snapshot);
    assert.equal(valid.wire, w);
    assert.equal(w.isDeleted(), false);
  }
  checks++;
  for (const stage of ["start-point", "end-point", "edge-range", "edge-curve"])
    assert.equal(
      valid.applyAttachmentResult({ stage, status: 1 }).continues,
      true,
    );
  valid.applyValidationResult({
    initialStatus: 0,
    generalStatus: 1,
    boundsPassed: true,
  });
  assert.throws(
    () => valid.applyAttachmentResult({ stage: "edge-curve", status: 5 }),
    /construction phase/,
  );
  assert.equal(valid.wire, w);
  assert.equal(w.isDeleted(), false);
  checks++;
  const broken = make(),
    savedPrimary = broken.edge,
    brokenEdge = broken.firstEdge,
    brokenWire = broken.wire;
  const destroy = brokenEdge.delete.bind(brokenEdge);
  brokenEdge.delete = () => {
    destroy();
    throw new Error("Controlled attachment cleanup failure");
  };
  assert.throws(
    () => broken.applyAttachmentResult({ stage: "edge-curve", status: 5 }),
    (error) =>
      error.name === "AggregateError" &&
      error.errors.some((cause) =>
        /Controlled attachment cleanup/.test(cause.message),
      ),
  );
  assert.equal(brokenEdge.isDeleted(), true);
  assert.equal(brokenWire.isDeleted(), true);
  assert.equal(savedPrimary.isDeleted(), false);
  assert.equal(broken.snapshot().hasBodyCandidate, false);
  assert.equal(broken.snapshot().attempt.status, "error");
  assert.equal(broken.snapshot().attempt.during, "attachment");
  checks++;
  const repeat = make();
  for (let i = 0; i < 100; i++) {
    repeat.rebuild(request, 0.001, settings);
    const w = repeat.wire,
      e = repeat.firstEdge;
    repeat.applyAttachmentResult({ stage: "edge-curve", status: 5 });
    assert.equal(w.isDeleted(), true);
    assert.equal(e.isDeleted(), true);
    assert.equal(repeat.snapshot().hasCurve, true);
  }
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      retirementCycles: 100,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Actual owned primary/wire resources with supplied controlled attachment events; not observed native return values, whole body admission or GUI/MCP acceptance.",
    }),
  );
} finally {
  for (const owner of owners) owner.dispose();
  clearTimeout(expiry);
}
