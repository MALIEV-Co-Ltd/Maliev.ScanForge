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
let checks = 0;
const owners = [];
try {
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  assert.equal(typeof classes.SketchLineBackendDraft, "function");
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
      [5, 6, 7],
    ],
  });
  const make = (kernel = oc) => {
    const d = new classes.SketchLineBackendDraft(kernel);
    owners.push(d);
    return d;
  };
  const d = make();
  assert.deepEqual(plain(d.snapshot()), {
    disposed: false,
    kind: "empty",
    records: [],
    hasCurve: false,
    hasBodyCandidate: false,
    hasFirstEdge: false,
  });
  assert.deepEqual(plain(d.midpoint()), [0, 0, 0]);
  checks++;
  const built = d.rebuild(request(), 0.001, settings);
  assert.equal(built.attempt.status, "pending-validation");
  assert.equal(built.kind, "line");
  assert.equal(built.hasCurve, true);
  assert.equal(built.hasBodyCandidate, true);
  assert.equal(built.hasFirstEdge, true);
  assert.deepEqual(plain(built.records), request().points);
  assert.deepEqual(plain(d.midpoint()), [3, 4, 5]);
  assert.equal("builderSucceeded" in built, false);
  assert.equal("nativeAccepted" in built, false);
  checks++;
  const oldPrimary = d.edge,
    oldWire = d.wire,
    oldFirst = d.firstEdge;
  for (const [r, scale, s] of [
    [{}, 0.001, settings],
    [request(), 0, settings],
    [request(), 0.001, {}],
  ])
    assert.throws(() => d.rebuild(r, scale, s));
  assert.equal(d.edge, oldPrimary);
  assert.equal(d.wire, oldWire);
  assert.equal(oldFirst.isDeleted(), false);
  checks++;
  built.records[0][0] = 99;
  built.attempt.checks.prepared.start[0] = 100;
  assert.deepEqual(plain(d.snapshot().records), request().points);
  assert.deepEqual(plain(d.midpoint()), [3, 4, 5]);
  checks++;
  const failed = d.rebuild(
    {
      kind: "line",
      points: [
        [0, 0, 0],
        [0.000001, 0, 0],
      ],
    },
    0.001,
    settings,
  );
  assert.equal(failed.attempt.status, "geometry-rejected");
  assert.ok(
    failed.attempt.checks.nativeFailurePath,
    "missing native failure path",
  );
  assert.deepEqual(plain(failed.attempt.checks.nativeFailurePath), {
    edgeStatus: 2,
    generalStatus: 3,
    wireStatus: 4,
  });
  assert.equal(failed.kind, "line");
  assert.equal(failed.hasCurve, true);
  assert.equal(failed.hasBodyCandidate, false);
  assert.deepEqual(plain(failed.records), [
    [0, 0, 0],
    [0.000001, 0, 0],
  ]);
  assert.deepEqual(plain(d.midpoint()), [0, 0, 0]);
  assert.ok(
    oldPrimary.isDeleted() && oldWire.isDeleted() && oldFirst.isDeleted(),
  );
  checks++;
  const projectionRejected = make();
  const pr = projectionRejected.rebuild(request(), 0.001, {
    ...settings,
    endpointTolerance: 0,
  });
  assert.equal(pr.attempt.checks.failureStage, "start-projection");
  assert.deepEqual(plain(pr.attempt.checks.nativeFailurePath), {
    edgeStatus: 3,
    generalStatus: 12,
    wireStatus: 4,
  });
  assert.equal(pr.hasCurve, true);
  assert.equal(pr.hasBodyCandidate, false);
  checks++;
  const envelopeRejected = make();
  const er = envelopeRejected.rebuild(
    {
      kind: "line",
      points: [
        [500001, 0, 0],
        [500002, 0, 0],
      ],
    },
    0.001,
    settings,
  );
  assert.equal(er.attempt.checks.failureStage, "envelope");
  assert.deepEqual(plain(er.attempt.checks.nativeFailurePath), {
    generalStatus: 1,
    wireStatus: 4,
  });
  assert.equal(er.hasCurve, true);
  assert.equal(er.hasBodyCandidate, false);
  checks++;
  const retainedPrimary = d.edge;
  const short = d.rebuild(
    {
      kind: "line",
      points: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    0.001,
    settings,
  );
  assert.equal(short.attempt.status, "primary-rejected");
  assert.equal(short.kind, "empty");
  assert.deepEqual(plain(short.records), []);
  assert.equal(short.hasCurve, false);
  assert.ok(retainedPrimary.isDeleted());
  checks++;
  d.rebuild(request(), 0.001, settings);
  const primary = d.edge,
    wire = d.wire,
    first = d.firstEdge;
  const rejected = d.applyValidationResult({
    initialStatus: 0,
    generalStatus: 1,
    boundsPassed: false,
  });
  assert.equal(rejected.status, 4);
  assert.equal(d.snapshot().attempt.status, "validation-rejected");
  assert.ok(wire.isDeleted() && first.isDeleted());
  assert.equal(primary.isDeleted(), false);
  assert.deepEqual(plain(d.snapshot().records), request().points);
  assert.deepEqual(plain(d.midpoint()), [0, 0, 0]);
  checks++;
  d.rebuild(request(), 0.001, settings);
  const keepWire = d.wire;
  assert.deepEqual(
    plain(
      d.applyValidationResult({
        initialStatus: 6,
        generalStatus: 2,
        promoteRetainedStatus: false,
      }),
    ),
    { status: 6, retainCandidate: true },
  );
  assert.equal(d.snapshot().attempt.status, "validation-retained");
  assert.equal(keepWire.isDeleted(), false);
  assert.deepEqual(plain(d.midpoint()), [3, 4, 5]);
  assert.throws(() => d.applyValidationResult({}));
  assert.equal(keepWire.isDeleted(), false);
  checks++;
  const badKernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (key !== "BRepBuilderAPI_MakeWire_1") return value;
      return function (...args) {
        const h = new value(...args);
        h.IsDone = () => false;
        return h;
      };
    },
  });
  const rejectedKernel = make(badKernel);
  const kr = rejectedKernel.rebuild(request(), 0.001, settings);
  assert.equal(kr.attempt.status, "kernel-rejected");
  assert.equal(kr.kind, "line");
  assert.equal(kr.hasCurve, true);
  assert.equal(kr.hasBodyCandidate, false);
  checks++;
  const events = [];
  const control = { failRetirement: false, failQuery: false };
  function tracked(handle, label) {
    const remove = handle.delete.bind(handle);
    handle.delete = () => {
      events.push(label);
      remove();
      if (control.failRetirement)
        throw Error("Controlled draft retirement failure");
    };
    return handle;
  }
  const trackedKernel = new Proxy(oc, {
    get(target, key) {
      if (key === "TopoDS")
        return {
          Edge_1(raw) {
            return tracked(target.TopoDS.Edge_1(raw), "firstEdge");
          },
        };
      const value = target[key];
      if (
        ![
          "BRepBuilderAPI_MakeEdge_24",
          "BRepBuilderAPI_MakeWire_1",
          "BRepAdaptor_Curve_2",
        ].includes(key)
      )
        return value;
      return function (...args) {
        const h = new value(...args);
        if (key === "BRepAdaptor_Curve_2") {
          const evaluate = h.Value.bind(h);
          h.Value = (...a) => {
            if (control.failQuery)
              throw Error("Controlled draft query failure");
            return evaluate(...a);
          };
        } else {
          const method = key === "BRepBuilderAPI_MakeEdge_24" ? "Edge" : "Wire";
          const get = h[method].bind(h);
          h[method] = (...a) =>
            tracked(get(...a), method === "Edge" ? "primary" : "wire");
        }
        return h;
      };
    },
  });
  const resetFault = make(trackedKernel);
  resetFault.rebuild(request(), 0.001, settings);
  const resetHandles = [resetFault.edge, resetFault.wire, resetFault.firstEdge];
  events.length = 0;
  control.failRetirement = true;
  assert.throws(
    () => resetFault.rebuild(request(), 0.001, settings),
    (e) => e.name === "AggregateError" && e.errors.length === 2,
  );
  assert.deepEqual(events, ["primary", "firstEdge", "wire"]);
  assert.ok(resetHandles.every((h) => h.isDeleted()));
  assert.equal(resetFault.snapshot().kind, "empty");
  assert.deepEqual(plain(resetFault.snapshot().records), []);
  assert.equal(resetFault.snapshot().attempt.during, "reset");
  control.failRetirement = false;
  resetFault.rebuild(request(), 0.001, settings);
  assert.equal(resetFault.snapshot().attempt.status, "pending-validation");
  checks++;
  const validationFault = make(trackedKernel);
  validationFault.rebuild(request(), 0.001, settings);
  const livePrimary = validationFault.edge,
    invalidWire = validationFault.wire,
    invalidFirst = validationFault.firstEdge;
  control.failRetirement = true;
  assert.throws(
    () =>
      validationFault.applyValidationResult({
        initialStatus: 0,
        generalStatus: 1,
        boundsPassed: false,
      }),
    (e) => e.name === "AggregateError",
  );
  assert.ok(invalidWire.isDeleted() && invalidFirst.isDeleted());
  assert.equal(livePrimary.isDeleted(), false);
  assert.equal(validationFault.snapshot().hasBodyCandidate, false);
  control.failRetirement = false;
  assert.equal(validationFault.snapshot().attempt.status, "error");
  assert.equal(validationFault.snapshot().attempt.during, "validation");
  checks++;
  const queryFault = make(trackedKernel);
  control.failQuery = true;
  assert.throws(
    () => queryFault.rebuild(request(), 0.001, settings),
    /Controlled draft query failure/,
  );
  assert.equal(queryFault.snapshot().hasCurve, true);
  assert.equal(queryFault.snapshot().kind, "empty");
  assert.deepEqual(plain(queryFault.snapshot().records), []);
  assert.equal(queryFault.snapshot().attempt.during, "conversion");
  assert.deepEqual(plain(queryFault.midpoint()), [0, 0, 0]);
  control.failQuery = false;
  checks++;
  for (let i = 0; i < 100; i++) {
    const x = make();
    x.rebuild(request(), 0.001, settings);
    const a = x.edge,
      b = x.wire,
      c = x.firstEdge;
    x.dispose();
    x.dispose();
    assert.ok(a.isDeleted() && b.isDeleted() && c.isDeleted());
    assert.equal(x.snapshot().hasCurve, false);
    assert.equal(x.snapshot().hasBodyCandidate, false);
  }
  checks++;
  d.dispose();
  assert.equal(d.snapshot().disposed, true);
  assert.throws(() => d.midpoint(), /disposed/);
  assert.throws(() => d.rebuild(request(), 0.001, settings), /disposed/);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Actual primary/body-candidate draft ownership, recovered reset order, retained records after body failure, body-gated midpoint, explicit validation retention and 100 retirement cycles; complete native admission and public editor remain unfinished",
    }),
  );
} finally {
  for (const owner of owners.reverse()) owner.dispose();
  clearTimeout(expiry);
}
