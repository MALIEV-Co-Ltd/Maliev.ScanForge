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
  const { SketchLineBackendDraft } = vm.runInContext(
    "loadSketchBackends()",
    context,
  );
  const settings = {
    linearResolution: 1e-8,
    coordinateDeltaZeroThreshold: 1e-18,
    endpointTolerance: 1e-8,
    coordinateEnvelope: 1000,
    relativeComparisonTolerance: 1.6e-14,
  };
  const request = () => ({
    kind: "line",
    points: [
      [1, 2, 3],
      [4, 6, 8],
    ],
  });
  const make = (kernel = oc) => {
    const d = new SketchLineBackendDraft(kernel);
    owners.push(d);
    return d;
  };
  const fork = (source, signal) => {
    const d = source.fork(signal);
    owners.push(d);
    return d;
  };
  const points = (edge) => {
    const adaptor = new oc.BRepAdaptor_Curve_2(edge);
    try {
      return [adaptor.FirstParameter(), adaptor.LastParameter()].map((t) => {
        const p = adaptor.Value(t);
        try {
          return [p.X(), p.Y(), p.Z()];
        } finally {
          p.delete();
        }
      });
    } finally {
      adaptor.delete();
    }
  };
  const pending = make();
  pending.rebuild(request(), 0.001, settings);
  const copied = fork(pending);
  assert.deepEqual(copied.snapshot(), pending.snapshot());
  assert.equal(copied.edge.IsSame(pending.edge), false);
  assert.equal(copied.wire.IsSame(pending.wire), false);
  assert.equal(copied.firstEdge.IsSame(pending.firstEdge), false);
  assert.deepEqual(points(copied.edge), points(pending.edge));
  assert.deepEqual(points(copied.firstEdge), points(pending.firstEdge));
  const snapshot = copied.snapshot();
  snapshot.records[0][0] = 999;
  assert.equal(pending.snapshot().records[0][0], 1);
  const originalPoints = points(pending.edge);
  const originalHandles = [pending.edge, pending.wire, pending.firstEdge];
  const copiedHandles = [copied.edge, copied.wire, copied.firstEdge];
  pending.dispose();
  assert.ok(originalHandles.every((h) => h.isDeleted()));
  assert.ok(copiedHandles.every((h) => !h.isDeleted()));
  assert.deepEqual(points(copied.edge), originalPoints);
  copied.dispose();
  assert.ok(copiedHandles.every((h) => h.isDeleted()));
  checks++;

  const empty = make(),
    emptyCopy = fork(empty);
  assert.deepEqual(emptyCopy.snapshot(), empty.snapshot());
  assert.equal(emptyCopy.edge, undefined);
  assert.equal(emptyCopy.wire, undefined);
  empty.rebuild(
    {
      kind: "line",
      points: [
        [0, 0, 0],
        [1e-8, 0, 0],
      ],
    },
    0.001,
    settings,
  );
  assert.equal(empty.snapshot().attempt.status, "primary-rejected");
  assert.deepEqual(fork(empty).snapshot(), empty.snapshot());
  empty.dispose();
  assert.throws(() => empty.fork(), /disposed/);
  checks++;

  const retained = make();
  retained.rebuild(request(), 0.001, settings);
  retained.applyValidationResult({
    initialStatus: 0,
    generalStatus: 1,
    boundsPassed: true,
  });
  const retainedCopy = fork(retained);
  assert.deepEqual(retainedCopy.snapshot(), retained.snapshot());
  retainedCopy.applyValidationResult({
    initialStatus: 0,
    generalStatus: 13,
    promoteRetainedStatus: false,
  });
  assert.equal(retainedCopy.wire, undefined);
  assert.equal(retainedCopy.snapshot().hasCurve, true);
  const rejectedCopy = fork(retainedCopy);
  assert.deepEqual(rejectedCopy.snapshot(), retainedCopy.snapshot());
  assert.equal(rejectedCopy.wire, undefined);
  assert.equal(retained.snapshot().hasBodyCandidate, true);
  assert.equal(retained.snapshot().attempt.status, "validation-retained");
  checks++;

  for (const rejected of ["attachment", "geometry"]) {
    const source = make();
    source.rebuild(
      request(),
      0.001,
      rejected === "geometry"
        ? { ...settings, endpointTolerance: 0 }
        : settings,
    );
    if (rejected === "attachment")
      source.applyAttachmentResult({ stage: "edge-curve", status: 5 });
    const copy = fork(source);
    assert.deepEqual(copy.snapshot(), source.snapshot());
    assert.equal(copy.snapshot().hasCurve, true);
    assert.equal(copy.wire, undefined);
    assert.deepEqual(points(copy.edge), points(source.edge));
    assert.deepEqual(Array.from(copy.midpoint()), [0, 0, 0]);
  }
  checks++;

  const queryKernel = new Proxy(oc, {
    get(target, key) {
      const C = target[key];
      if (key !== "BRepAdaptor_Curve_2") return C;
      return function (...args) {
        const h = new C(...args);
        h.Value = () => {
          throw Error("fork source query failure");
        };
        return h;
      };
    },
  });
  const partial = make(queryKernel);
  assert.throws(
    () => partial.rebuild(request(), 0.001, settings),
    /fork source query failure/,
  );
  assert.equal(partial.snapshot().kind, "empty");
  assert.equal(partial.snapshot().hasCurve, true);
  const partialCopy = fork(partial);
  assert.deepEqual(partialCopy.snapshot(), partial.snapshot());
  assert.deepEqual(points(partialCopy.edge), points(partial.edge));
  assert.equal(partialCopy.wire, undefined);
  checks++;

  const control = {
    armed: false,
    rejectCandidate: false,
    cleanupFault: false,
    onEdge: undefined,
    onFirstEdge: undefined,
  };
  const stagedEdges = [];
  const stagedWires = [],
    stagedFirstEdges = [];
  const faultKernel = new Proxy(oc, {
    get(target, key) {
      if (key === "TopoDS")
        return {
          Edge_1(raw) {
            const h = target.TopoDS.Edge_1(raw);
            if (control.armed) {
              stagedFirstEdges.push(h);
              control.onFirstEdge?.();
            }
            return h;
          },
        };
      const C = target[key];
      if (key === "BRepBuilderAPI_MakeEdge_24")
        return function (...args) {
          const maker = new C(...args),
            edge = maker.Edge.bind(maker);
          maker.Edge = (...a) => {
            const h = edge(...a);
            if (control.armed) {
              stagedEdges.push(h);
              if (control.cleanupFault) {
                const remove = h.delete.bind(h);
                h.delete = () => {
                  remove();
                  throw Error("fork cleanup failure");
                };
              }
              control.onEdge?.();
            }
            return h;
          };
          return maker;
        };
      if (key === "BRepBuilderAPI_MakeWire_1")
        return function (...args) {
          const h = new C(...args);
          const wire = h.Wire.bind(h);
          h.Wire = (...a) => {
            const shape = wire(...a);
            if (control.armed) stagedWires.push(shape);
            return shape;
          };
          if (control.armed && control.rejectCandidate) h.IsDone = () => false;
          return h;
        };
      return C;
    },
  });
  const faultSource = make(faultKernel);
  faultSource.rebuild(request(), 0.001, settings);
  const faultBefore = faultSource.snapshot(),
    originalWire = faultSource.wire;
  control.armed = true;
  control.rejectCandidate = true;
  assert.throws(() => faultSource.fork(), /restore.*candidate/i);
  assert.ok(stagedEdges.every((h) => h.isDeleted()));
  assert.deepEqual(faultSource.snapshot(), faultBefore);
  assert.equal(originalWire.isDeleted(), false);
  checks++;

  const abortBefore = new AbortController();
  abortBefore.abort();
  const beforeCount = stagedEdges.length;
  assert.throws(
    () => faultSource.fork(abortBefore.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(stagedEdges.length, beforeCount);
  control.rejectCandidate = false;
  const abortAfter = new AbortController();
  control.onEdge = () => abortAfter.abort();
  assert.throws(
    () => faultSource.fork(abortAfter.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(stagedEdges.every((h) => h.isDeleted()));
  assert.deepEqual(faultSource.snapshot(), faultBefore);
  control.onEdge = undefined;
  checks++;

  const abortAfterCandidate = new AbortController();
  control.onFirstEdge = () => abortAfterCandidate.abort();
  assert.throws(
    () => faultSource.fork(abortAfterCandidate.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(
    [...stagedEdges, ...stagedWires, ...stagedFirstEdges].every((h) =>
      h.isDeleted(),
    ),
  );
  assert.deepEqual(faultSource.snapshot(), faultBefore);
  assert.equal(originalWire.isDeleted(), false);
  control.onFirstEdge = undefined;
  checks++;

  control.onEdge = () =>
    faultSource.applyAttachmentResult({ stage: "edge-curve", status: 5 });
  assert.throws(() => faultSource.fork(), /changed while copying/);
  assert.ok(stagedEdges.every((h) => h.isDeleted()));
  assert.equal(faultSource.snapshot().attempt.status, "attachment-rejected");
  assert.equal(faultSource.snapshot().hasCurve, true);
  assert.equal(faultSource.wire, undefined);
  control.onEdge = undefined;
  control.armed = false;
  faultSource.rebuild(request(), 0.001, settings);
  checks++;

  control.armed = true;
  control.rejectCandidate = true;
  control.cleanupFault = true;
  assert.throws(
    () => faultSource.fork(),
    (e) =>
      e.name === "AggregateError" &&
      /restore.*candidate/i.test(e.errors[0].message) &&
      e.errors[1].name === "AggregateError",
  );
  assert.ok(stagedEdges.every((h) => h.isDeleted()));
  assert.equal(faultSource.snapshot().hasBodyCandidate, true);
  control.armed = false;
  control.cleanupFault = false;
  control.rejectCandidate = false;
  checks++;

  for (let i = 0; i < 100; i++) {
    const source = make();
    source.rebuild(request(), 0.001, settings);
    const copy = fork(source);
    const handles = [
      source.edge,
      source.wire,
      source.firstEdge,
      copy.edge,
      copy.wire,
      copy.firstEdge,
    ];
    source.dispose();
    assert.ok(handles.slice(3).every((h) => !h.isDeleted()));
    copy.dispose();
    assert.ok(handles.every((h) => h.isDeleted()));
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
        "Owned draft staging copies preserve primary/candidate presence and supplied diagnostics; not native cloning, complete backend admission, child publication or GUI/MCP acceptance.",
    }),
  );
} finally {
  for (const d of owners.reverse()) d.dispose();
  clearTimeout(expiry);
}
