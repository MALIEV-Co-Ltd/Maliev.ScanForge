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
const plain = (x) => JSON.parse(JSON.stringify(x));
const children = [];
let checks = 0;
try {
  const oc = await vm.runInContext("kernel()", context);
  const classes = vm.runInContext("loadSketchBackends()", context);
  assert.equal(typeof classes.SketchLineChild, "function");
  const initial = () => ({
    frame: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ],
    start: [1, 2, 3],
    middle: [3, 4, 5],
    end: [5, 6, 7],
    sourceRecords: [
      [10, 20, 0],
      [30, 40, 0],
    ],
  });
  const settings = {
    linearResolution: 1e-8,
    coordinateDeltaZeroThreshold: 1e-18,
    endpointTolerance: 1e-8,
    coordinateEnvelope: 1000,
    relativeComparisonTolerance: 1.6e-14,
  };
  function fixture() {
    const curve = new classes.SketchLineCurve(oc);
    let candidate,
      calls = 0,
      midpointCalls = 0;
    const backend = {
      get edge() {
        return curve.edge;
      },
      snapshot() {
        return curve.snapshot();
      },
      rebuild(request) {
        calls++;
        candidate?.dispose();
        candidate = undefined;
        if (curve.rebuildCurve(request))
          candidate = curve.prepareBodyCandidate(0.001, settings)?.candidate;
        // Native complete admission is unavailable in this adapter. Real primary
        // and candidate handles must not cause the child to publish success.
        return false;
      },
      midpoint() {
        midpointCalls++;
        return curve.evaluateFraction(0.5);
      },
      dispose() {
        try {
          candidate?.dispose();
        } finally {
          curve.dispose();
        }
      },
    };
    const child = new classes.SketchLineChild(initial(), backend);
    children.push(child);
    return {
      child,
      curve,
      get candidate() {
        return candidate;
      },
      get calls() {
        return calls;
      },
      get midpointCalls() {
        return midpointCalls;
      },
    };
  }
  const f = fixture();
  const result = f.child.replaceLocalRecords([
    [1, 2, 3],
    [5, 6, 7],
  ]);
  assert.equal(result.builderSucceeded, false);
  assert.equal(f.curve.snapshot().hasCurve, true);
  assert.equal(f.candidate.snapshot().hasWire, true);
  assert.equal(f.midpointCalls, 0);
  assert.deepEqual(
    plain(f.child.snapshot().state.sourceRecords),
    initial().sourceRecords,
  );
  checks++;
  const oldPrimary = f.child.edge,
    oldWire = f.candidate.wire,
    oldFirst = f.candidate.firstEdge;
  const edit = f.child.editPoint(1, [9, 8, 7]);
  assert.equal(edit.admitted, true);
  assert.equal(edit.builderSucceeded, false);
  assert.equal(edit.attempts.length, 2);
  assert.equal(f.calls, 3);
  assert.equal(f.curve.snapshot().hasCurve, false);
  assert.equal(f.candidate, undefined);
  assert.ok(
    oldPrimary.isDeleted() && oldWire.isDeleted() && oldFirst.isDeleted(),
  );
  assert.deepEqual(plain(f.child.snapshot().state.start), [1, 2, 3]);
  assert.deepEqual(plain(f.child.snapshot().state.end), [1, 2, 3]);
  assert.deepEqual(
    plain(f.child.snapshot().state.sourceRecords),
    initial().sourceRecords,
  );
  checks++;
  const controller = new AbortController();
  controller.abort();
  const before = f.calls;
  assert.throws(
    () =>
      f.child.replaceLocalRecords(
        [
          [1, 2, 3],
          [5, 6, 7],
        ],
        controller.signal,
      ),
    /cancelled/,
  );
  assert.equal(f.calls, before);
  f.child.dispose();
  f.child.dispose();
  checks++;
  const owner = new classes.SketchChildCollection("owner", initial().frame);
  try {
    const original = fixture();
    original.child.replaceLocalRecords([
      [1, 2, 3],
      [5, 6, 7],
    ]);
    const oldPrimary = original.child.edge,
      oldWire = original.candidate.wire;
    owner.splice(0, 0, [{ id: "line", child: original.child }]);
    assert.deepEqual(
      plain(owner.snapshot().sources.children[0].records),
      initial().sourceRecords,
    );
    const replacement = fixture();
    replacement.child.replaceLocalRecords([
      [11, 12, 13],
      [15, 16, 17],
    ]);
    const stage = owner.stageSplice(0, 1, [
      { id: "line", child: replacement.child },
    ]);
    assert.deepEqual(
      plain(stage.snapshot().sources.children[0].records),
      initial().sourceRecords,
    );
    const retired = stage.accept();
    assert.equal(retired[0].child, original.child);
    assert.equal(oldPrimary.isDeleted(), false);
    retired[0].child.dispose();
    assert.ok(oldPrimary.isDeleted() && oldWire.isDeleted());
    assert.equal(replacement.child.edge.isDeleted(), false);
    const snapshot = owner.snapshot();
    snapshot.sources.children[0].records[0][0] = 999;
    assert.deepEqual(
      plain(owner.snapshot().sources.children[0].records),
      initial().sourceRecords,
    );
  } finally {
    owner.dispose();
  }
  checks++;
  for (let i = 0; i < 100; i++) {
    const x = fixture();
    x.child.replaceLocalRecords([
      [1, 2, 3],
      [5, 6, 7],
    ]);
    const primary = x.child.edge,
      wire = x.candidate.wire,
      first = x.candidate.firstEdge;
    const collection = new classes.SketchChildCollection(
      "owner",
      initial().frame,
    );
    collection.splice(0, 0, [{ id: "line", child: x.child }]);
    assert.deepEqual(
      plain(collection.snapshot().sources.children[0].records),
      initial().sourceRecords,
    );
    collection.dispose();
    x.child.dispose();
    assert.ok(primary.isDeleted() && wire.isDeleted() && first.isDeleted());
    assert.equal(x.curve.snapshot().hasCurve, false);
    assert.equal(x.child.snapshot().state, undefined);
    assert.equal(x.child.snapshot().preparation, undefined);
  }
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Actual primary/candidate ownership under unavailable complete native admission, exact point recovery and 100 retirement cycles; successful child publication tested only with controlled backend results; native full acceptance remains unfinished",
    }),
  );
} finally {
  for (const child of children.reverse()) child.dispose();
  clearTimeout(expiry);
}
