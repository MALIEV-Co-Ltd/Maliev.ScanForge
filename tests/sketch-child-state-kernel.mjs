import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import vm from "node:vm";

// Application-kernel integration only. Run after the normal kernel preparation,
// under the parent-owned bounded runner; this is not original QuickSurface parity.
const root = new URL("../", import.meta.url);
const wasm = readFileSync(new URL("public/kernel/opencascade.wasm.wasm", root));
const worker = readFileSync(new URL("public/cad-worker.js", root));
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
  vm.runInContext(bytes.toString("utf8"), context, { filename: url });
  if (new URL(url).pathname.endsWith("/sketch-backend.js"))
    helperSha256 = createHash("sha256").update(bytes).digest("hex");
  if (new URL(url).pathname.endsWith("/opencascade.js")) {
    const factory = context.opencascade;
    context.opencascade = (options) =>
      factory({ ...options, wasmBinary: wasm });
  }
};
vm.runInContext(worker.toString("utf8"), context, {
  filename: "cad-worker.js",
});
const expiry = setTimeout(() => {
  console.error(
    "Application sketch-child restoration kernel test exceeded 90 seconds.",
  );
  process.exit(124);
}, 90_000);

const roundTrip = (value) => deserialize(serialize(value));
const frame = [
  [1, -0, 0, 10.000000000000002],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const precise = 2 ** -30;
const conicPoints = [
  [1 + precise, 0, 9],
  [precise, 1, 8],
  [-1 + precise, 0, 7],
];
const collinear = [
  [0, 0, 9],
  [1, 0, 8],
  [3, 0, 7],
];
const owned = new Set();
const borrowedEdges = new Set();
const cases = [];
const own = (child) => (owned.add(child), child);
const edge = (child) => {
  const value = child.edge;
  assert.ok(value && !value.IsNull(), "Expected an actual OCCT edge");
  borrowedEdges.add(value);
  return value;
};
const deleted = (value, expected) => {
  if (typeof value.isDeleted === "function")
    assert.equal(value.isDeleted(), expected);
};

try {
  const oc = await vm.runInContext("kernel()", context);
  context.ownedStateKernel = oc;
  const classes = vm.runInContext("loadSketchBackends()", context);
  const arcBackend = () => new classes.SketchArcBackend(oc);
  const circleBackend = () =>
    vm.runInContext("new SketchCircleBackend(ownedStateKernel)", context);
  const ellipseBackend = () => new classes.SketchEllipseBackend(oc);
  const brep = (value) => context.serializeBrep(oc, value);

  function verifyRestoration(child, restore) {
    const before = roundTrip(child.snapshot());
    const exported = roundTrip(child.exportState());
    const restored = own(restore(exported));
    assert.deepEqual(roundTrip(restored.snapshot()), before);
    assert.deepEqual(roundTrip(restored.exportState()), exported);
    const placement = exported.frame ?? exported.preparation.frame;
    assert.ok(
      Object.is(placement[0][1], -0),
      "V8 state must retain signed zero",
    );
    assert.equal(placement[0][3], 10.000000000000002);
    assert.notEqual(placement[0][3], Math.fround(placement[0][3]));
    return restored;
  }

  // Failed arc preparation changes latest source/center fields without touching
  // the existing edge. Rebuilding the latest preparation would lose that edge.
  const arc = own(
    vm.runInContext("createSketchConicChild('arc', ownedStateKernel)", context),
  );
  assert.equal(
    arc.rebuild({ kind: "arc", points: conicPoints, frame, close: false })
      .outcome.builderSucceeded,
    true,
  );
  const arcEdge = edge(arc),
    arcBrep = brep(arcEdge);
  const arcRequest = roundTrip(arc.exportState().lastBackendRequest);
  assert.equal(arcRequest.points[0][0], 1 + precise);
  assert.notEqual(
    arcRequest.points[0][0],
    Math.fround(arcRequest.points[0][0]),
  );
  const failedArc = arc.rebuild({
    kind: "arc",
    points: collinear,
    frame,
    close: false,
  });
  assert.equal(failedArc.preparation.fitSucceeded, false);
  assert.equal(failedArc.preparation.backendRequest, undefined);
  assert.equal(failedArc.outcome.backendAttempted, false);
  assert.equal(failedArc.outcome.builderSucceeded, false);
  assert.equal(failedArc.validity, "valid");
  assert.equal(arc.edge, arcEdge);
  assert.equal(brep(arcEdge), arcBrep);
  assert.deepEqual(roundTrip(arc.exportState().lastBackendRequest), arcRequest);
  const restoredArc = verifyRestoration(arc, (state) =>
    classes.SketchConicChild.restoreState(state, arcBackend),
  );
  const forkArc = own(arc.fork(arcBackend));
  for (const copy of [restoredArc, forkArc]) {
    assert.notEqual(edge(copy), arcEdge);
    assert.deepEqual(roundTrip(copy.snapshot()), roundTrip(failedArc));
    assert.equal(brep(copy.edge), arcBrep);
  }
  arc.dispose();
  deleted(arcEdge, true);
  for (const copy of [restoredArc, forkArc]) {
    deleted(copy.edge, false);
    assert.equal(
      brep(copy.edge),
      arcBrep,
      "Source disposal must not invalidate its independent copies",
    );
  }
  cases.push(
    "arc retained older BREP after failed latest fit, V8 restore and fork",
  );

  // First prove a successful circle restores real geometry, then clear only the
  // source with its canonical failed-fit sentinel and verify empty-state restore.
  const circle = own(
    vm.runInContext(
      "createSketchConicChild('circle', ownedStateKernel)",
      context,
    ),
  );
  assert.equal(
    circle.rebuild({ kind: "circle", points: conicPoints, frame }).outcome
      .builderSucceeded,
    true,
  );
  const circleEdge = edge(circle),
    circleBrep = brep(circleEdge);
  const restoredCircle = verifyRestoration(circle, (state) =>
    classes.SketchConicChild.restoreState(state, circleBackend),
  );
  const forkCircle = own(circle.fork(circleBackend));
  for (const copy of [restoredCircle, forkCircle]) {
    assert.notEqual(edge(copy), circleEdge);
    assert.equal(brep(copy.edge), circleBrep);
  }
  cases.push("circle successful BREP survives V8 restore and fork");
  const failedCircle = circle.rebuild({
    kind: "circle",
    points: collinear,
    frame,
  });
  assert.equal(failedCircle.preparation.fitSucceeded, false);
  assert.equal(failedCircle.outcome.backendAttempted, true);
  assert.equal(failedCircle.outcome.backendSucceeded, false);
  assert.equal(failedCircle.backend.kind, "empty");
  assert.equal(circle.edge, undefined);
  deleted(circleEdge, true);
  assert.ok(
    circle.exportState().lastBackendRequest,
    "Historical request survives even though current backend is empty",
  );
  const emptyCircle = verifyRestoration(circle, (state) =>
    classes.SketchConicChild.restoreState(state, circleBackend),
  );
  const emptyCircleFork = own(circle.fork(circleBackend));
  for (const copy of [emptyCircle, emptyCircleFork]) {
    assert.equal(
      copy.edge,
      undefined,
      "Restoration must not resurrect a cleared circle",
    );
    assert.deepEqual(roundTrip(copy.snapshot()), roundTrip(failedCircle));
    assert.equal(copy.exportState().backendEmpty, true);
  }
  for (const copy of [restoredCircle, forkCircle]) {
    deleted(copy.edge, false);
    assert.equal(
      brep(copy.edge),
      circleBrep,
      "Failed source rebuild must preserve independent circle copies",
    );
  }
  cases.push(
    "circle failed-fit empty backend remains empty through V8 restore and fork",
  );

  const ellipse = own(new classes.SketchEllipseChild(frame, ellipseBackend()));
  assert.equal(
    ellipse.rebuildRecords([
      [-2 + precise, 0, 9],
      [2 + precise, 0, 8],
      [precise, 1, 7],
    ]).builderSucceeded,
    true,
  );
  const ellipseEdge = edge(ellipse),
    ellipseBrep = brep(ellipseEdge);
  const ellipseRequest = roundTrip(ellipse.exportState().lastBackendRequest);
  const failedEllipseOutcome = ellipse.rebuildRecords([
    [5, 6, 7],
    [5, 6, 8],
    [8, 9, 10],
  ]);
  const failedEllipse = ellipse.snapshot();
  assert.equal(failedEllipseOutcome.builderSucceeded, false);
  assert.equal(failedEllipseOutcome.backendAttempted, false);
  assert.equal(failedEllipse.preparation.fitSucceeded, false);
  assert.equal(failedEllipse.preparation.backendRequest, undefined);
  assert.equal(failedEllipse.preparation.sourceRecords.length, 0);
  assert.equal(ellipse.edge, ellipseEdge);
  assert.equal(brep(ellipseEdge), ellipseBrep);
  assert.deepEqual(
    roundTrip(ellipse.exportState().lastBackendRequest),
    ellipseRequest,
  );
  const restoredEllipse = verifyRestoration(ellipse, (state) =>
    classes.SketchEllipseChild.restoreState(state, ellipseBackend),
  );
  const forkEllipse = own(ellipse.fork(ellipseBackend));
  for (const copy of [restoredEllipse, forkEllipse]) {
    assert.notEqual(edge(copy), ellipseEdge);
    assert.deepEqual(roundTrip(copy.snapshot()), roundTrip(failedEllipse));
    assert.equal(brep(copy.edge), ellipseBrep);
  }
  ellipse.dispose();
  deleted(ellipseEdge, true);
  for (const copy of [restoredEllipse, forkEllipse]) {
    deleted(copy.edge, false);
    assert.equal(brep(copy.edge), ellipseBrep);
  }
  cases.push(
    "ellipse retained older BREP after failed latest diameter, V8 restore and fork",
  );
  assert.equal(
    vm.runInContext("shapes.size", context),
    0,
    "Internal child restoration must not publish scene shapes",
  );
  assert.equal(
    oc.FS.analyzePath("s.brep").exists,
    false,
    "BREP comparison must retire its virtual temporary file",
  );
  assert.equal(
    typeof helperSha256,
    "string",
    "Exercise the actual generated sketch backend bundle",
  );
} finally {
  try {
    // Edges are borrowed from their children. Dispose only the owning children,
    // then check the handles; deleting a borrowed edge separately would double-free.
    const errors = [];
    for (const child of [...owned].reverse()) {
      try {
        child.dispose();
        assert.equal(child.snapshot().disposed, true);
        assert.equal(child.snapshot().backend.kind, "empty");
      } catch (error) {
        errors.push(error);
      }
    }
    for (const value of borrowedEdges) {
      try {
        deleted(value, true);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Sketch child kernel cleanup failed");
  } finally {
    clearTimeout(expiry);
  }
}
console.log(
  JSON.stringify({
    passed: true,
    scope:
      "Application generated classic-worker bundle and real OpenCascade restoration only; no original QuickSurface numerical or GUI/MCP acceptance claim",
    cases,
    ownedChildrenDisposed: owned.size,
    borrowedEdgesRetired: borrowedEdges.size,
    helperSha256,
    workerSha256: createHash("sha256").update(worker).digest("hex"),
    wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  }),
);
