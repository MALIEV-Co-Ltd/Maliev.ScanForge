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
const owned = [];
let checks = 0;
try {
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  assert.equal(typeof classes.SketchLineWireCandidate?.create, "function");
  const source = new classes.SketchLineCurve(oc);
  owned.push(source);
  assert.equal(
    source.rebuildCurve({
      kind: "line",
      points: [
        [1, 2, 3],
        [4, 6, 3],
      ],
    }),
    true,
  );
  const data = () => source.prepareBodyEndpoints(0.001);
  const make = (kernel, request) =>
    classes.SketchLineWireCandidate.create(kernel, request, 5e-9);
  const candidate = make(oc, data());
  owned.push(candidate);
  assert.ok(
    candidate && !candidate.wire.IsNull() && !candidate.firstEdge.IsNull(),
  );
  assert.deepEqual(Object.keys(candidate.snapshot()).sort(), [
    "disposed",
    "hasFirstEdge",
    "hasWire",
    "request",
    "requestedTolerance",
  ]);
  assert.equal("nativeAccepted" in candidate.snapshot(), false);
  assert.equal("builderSucceeded" in candidate.snapshot(), false);
  checks++;

  const inspect = (wire) => {
    const h = [],
      keep = (x) => (h.push(x), x),
      points = [];
    try {
      const checker = keep(new oc.BRepCheck_Analyzer(wire, true));
      assert.equal(checker.IsValid_2(), true);
      const edgeExplorer = keep(
        new oc.TopExp_Explorer_2(
          wire,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      let count = 0;
      while (edgeExplorer.More()) {
        count++;
        edgeExplorer.Next();
      }
      assert.equal(count, 1);
      const vertices = keep(
        new oc.TopExp_Explorer_2(
          wire,
          oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      while (vertices.More()) {
        const raw = keep(vertices.Current()),
          vertex = keep(oc.TopoDS.Vertex_1(raw)),
          point = keep(oc.BRep_Tool.Pnt(vertex));
        points.push([point.X(), point.Y(), point.Z()]);
        vertices.Next();
      }
      return points;
    } finally {
      for (let i = h.length - 1; i >= 0; i--) h[i].delete();
    }
  };
  assert.deepEqual(inspect(candidate.wire), [
    plain(data().start),
    plain(data().end),
  ]);
  const adaptor = new oc.BRepAdaptor_Curve_2(candidate.firstEdge);
  try {
    assert.equal(
      adaptor.GetType().value,
      oc.GeomAbs_CurveType.GeomAbs_Line.value,
    );
    assert.equal(adaptor.FirstParameter(), 0);
    assert.equal(adaptor.LastParameter(), 0.005);
  } finally {
    adaptor.delete();
  }
  checks++;

  const request = data(),
    detached = make(oc, request);
  owned.push(detached);
  request.start[0] = 99;
  request.conversion.origin[0] = 88;
  const snapshot = detached.snapshot();
  snapshot.request.end[1] = 77;
  assert.deepEqual(plain(detached.snapshot().request), plain(data()));
  assert.deepEqual(inspect(detached.wire), [
    plain(data().start),
    plain(data().end),
  ]);
  checks++;

  const signedRequest = {
    conversion: {
      origin: [0, -0, -0],
      direction: [1, -0, -0],
      interval: [0, 0.005],
    },
    start: [0, -0, -0],
    end: [0.005, -0, -0],
  };
  const signed = make(oc, signedRequest);
  owned.push(signed);
  assert.deepEqual(inspect(signed.wire), [
    signedRequest.start,
    signedRequest.end,
  ]);
  checks++;
  for (const points of [
    [
      [4, 6, 3],
      [1, 2, 3],
    ],
    [
      [1, 2, 3],
      [4, 6, 7],
    ],
  ]) {
    const variantSource = new classes.SketchLineCurve(oc);
    owned.push(variantSource);
    variantSource.rebuildCurve({ kind: "line", points });
    const variantData = variantSource.prepareBodyEndpoints(0.001);
    const variant = make(oc, variantData);
    owned.push(variant);
    assert.deepEqual(inspect(variant.wire), [
      plain(variantData.start),
      plain(variantData.end),
    ]);
  }
  checks++;

  let fault,
    handles = [];
  const constructors = new Set([
    "gp_Pnt_3",
    "gp_Dir_4",
    "gp_Lin_3",
    "GC_MakeSegment_2",
    "Handle_Geom_Curve_2",
    "BRep_Builder",
    "TopoDS_Vertex",
    "TopoDS_Edge",
    "BRepBuilderAPI_MakeWire_1",
    "BRepCheck_Analyzer",
    "TopExp_Explorer_2",
  ]);
  const track = (h, label) => {
    handles.push(h);
    if (
      (fault === "cleanup" && label === "gp_Lin_3") ||
      (fault === "dispose" && (label === "wire" || label === "firstEdge"))
    ) {
      const remove = h.delete.bind(h);
      h.delete = () => {
        remove();
        throw new Error("Controlled wire cleanup failure");
      };
    }
    return h;
  };
  const kernel = new Proxy(oc, {
    get(target, key) {
      if (key === "TopoDS")
        return {
          Edge_1(raw) {
            const edge = track(target.TopoDS.Edge_1(raw), "firstEdge");
            if (fault === "firstEdge") edge.IsNull = () => true;
            return edge;
          },
        };
      const value = target[key];
      if (!constructors.has(key)) return value;
      return function (...args) {
        const h = track(new value(...args), key);
        for (const method of ["Value", "Edge", "Wire", "Current"]) {
          if (typeof h[method] !== "function") continue;
          const get = h[method].bind(h);
          h[method] = (...args) => {
            if (fault === "queryThrow" && method === "Current")
              throw new Error("Controlled wire query failure");
            return track(get(...args), method === "Wire" ? "wire" : method);
          };
        }
        if (fault === "edge" && key === "BRep_Builder") h.MakeEdge_2 = () => {};
        if (fault === "vertexUpdate" && key === "BRep_Builder")
          h.UpdateVertex_2 = () => {
            throw new Error("Controlled wire vertex update failure");
          };
        if (fault === "wire" && key === "BRepBuilderAPI_MakeWire_1")
          h.IsDone = () => false;
        if (fault === "validity" && key === "BRepCheck_Analyzer")
          h.IsValid_2 = () => false;
        if (fault === "noEdge" && key === "TopExp_Explorer_2")
          h.More = () => false;
        return h;
      };
    },
  });
  for (const bad of [
    undefined,
    {},
    { ...data(), extra: true },
    { ...data(), start: [1, 2] },
    { ...data(), end: [0, NaN, 0] },
    { ...data(), start: [0, 0, 0] },
    {
      ...data(),
      conversion: { ...data().conversion, interval: [0, Infinity] },
    },
  ]) {
    handles = [];
    assert.throws(() => make(kernel, bad));
    assert.equal(handles.length, 0);
  }
  checks++;

  for (const value of [undefined, null, "0", -1, NaN, Infinity]) {
    handles = [];
    assert.throws(
      () => classes.SketchLineWireCandidate.create(kernel, data(), value),
      /tolerance/i,
    );
    assert.equal(handles.length, 0);
  }
  checks++;
  const shortSource = new classes.SketchLineCurve(oc);
  owned.push(shortSource);
  shortSource.rebuildCurve({
    kind: "line",
    points: [
      [0, 0, 0],
      [5e-5, 0, 0],
    ],
  });
  const shortData = shortSource.prepareBodyEndpoints(0.001);
  const shortWire = make(oc, shortData);
  owned.push(shortWire);
  assert.deepEqual(inspect(shortWire.wire), [
    plain(shortData.start),
    plain(shortData.end),
  ]);
  assert.ok(
    shortData.conversion.interval[1] > 1e-8 &&
      shortData.conversion.interval[1] < 1e-7,
  );
  assert.equal(shortWire.snapshot().requestedTolerance, 5e-9);
  checks++;
  handles = [];
  const zeroTolerance = classes.SketchLineWireCandidate.create(
    kernel,
    data(),
    0,
  );
  assert.equal(zeroTolerance.snapshot().requestedTolerance, 0);
  zeroTolerance.dispose();
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  const zero = data();
  zero.conversion.interval = [0, 0];
  zero.end = [...zero.start];
  handles = [];
  assert.equal(make(kernel, zero), undefined);
  assert.equal(handles.length, 0);
  checks++;
  for (const mode of ["edge", "wire", "validity", "noEdge", "firstEdge"]) {
    fault = mode;
    handles = [];
    assert.equal(make(kernel, data()), undefined);
    assert.ok(handles.length && handles.every((h) => h.isDeleted()), mode);
    checks++;
  }
  for (const mode of ["queryThrow", "cleanup", "vertexUpdate"]) {
    fault = mode;
    handles = [];
    assert.throws(
      () => make(kernel, data()),
      (error) => {
        if (mode === "cleanup")
          return (
            error.name === "AggregateError" &&
            error.errors.some((cause) =>
              /Controlled wire cleanup/.test(cause.message),
            )
          );
        return /Controlled wire (query|vertex)/.test(error.message);
      },
    );
    assert.ok(handles.length && handles.every((h) => h.isDeleted()), mode);
    checks++;
  }
  fault = "dispose";
  handles = [];
  const disposeFault = make(kernel, data());
  assert.throws(() => disposeFault.dispose(), /cleanup/i);
  assert.deepEqual(plain(disposeFault.snapshot()), {
    disposed: true,
    hasWire: false,
    hasFirstEdge: false,
  });
  assert.ok(handles.every((h) => h.isDeleted()));
  disposeFault.dispose();
  checks++;

  fault = undefined;
  handles = [];
  for (let i = 0; i < 100; i++) {
    const wire = make(kernel, data());
    assert.ok(wire && !wire.firstEdge.IsNull());
    wire.dispose();
  }
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  const geometrySettings = {
    linearResolution: 1e-8,
    coordinateDeltaZeroThreshold: 1e-18,
    endpointTolerance: 1e-8,
    coordinateEnvelope: 1000,
    relativeComparisonTolerance: 0,
  };
  handles = [];
  const checked = classes.SketchLineWireCandidate.createChecked(
    kernel,
    data(),
    geometrySettings,
  );
  assert.equal(checked.status, "candidate");
  assert.equal(checked.checks.passed, true);
  assert.equal(checked.candidate.snapshot().requestedTolerance, 5e-9);
  owned.push(checked.candidate);
  checked.checks.prepared.start[0] = 99;
  checked.checks.settings.linearResolution = 88;
  assert.deepEqual(inspect(checked.candidate.wire), [
    plain(data().start),
    plain(data().end),
  ]);
  checked.candidate.dispose();
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  const tiny = {
    conversion: {
      origin: [0, 0, 0],
      direction: [1, 0, 0],
      interval: [0, 1e-8],
    },
    start: [0, 0, 0],
    end: [1e-8, 0, 0],
  };
  handles = [];
  const rejected = classes.SketchLineWireCandidate.createChecked(
    kernel,
    tiny,
    geometrySettings,
  );
  assert.equal(rejected.status, "geometry-rejected");
  assert.equal(rejected.checks.failureStage, "edge-vertices");
  assert.equal(rejected.candidate, undefined);
  assert.equal(handles.length, 0);
  assert.throws(
    () => classes.SketchLineWireCandidate.createChecked(kernel, data(), {}),
    /geometry setting/,
  );
  assert.equal(handles.length, 0);
  checks++;
  const shortAttempt = shortSource.prepareBodyCandidate(
    0.001,
    geometrySettings,
  );
  assert.equal(shortAttempt.status, "candidate");
  owned.push(shortAttempt.candidate);
  assert.deepEqual(inspect(shortAttempt.candidate.wire), [
    plain(shortData.start),
    plain(shortData.end),
  ]);
  checks++;
  const failedProjection = source.prepareBodyCandidate(0.001, {
    ...geometrySettings,
    endpointTolerance: 0,
  });
  assert.equal(failedProjection.status, "geometry-rejected");
  assert.equal(failedProjection.checks.failureStage, "start-projection");
  assert.equal(source.snapshot().hasCurve, true);
  checks++;
  const emptySource = new classes.SketchLineCurve(oc);
  owned.push(emptySource);
  assert.equal(
    emptySource.prepareBodyCandidate(0.001, geometrySettings),
    undefined,
  );
  const trackedSource = new classes.SketchLineCurve(kernel);
  owned.push(trackedSource);
  trackedSource.rebuildCurve({
    kind: "line",
    points: [
      [1, 2, 3],
      [4, 6, 3],
    ],
  });
  handles = [];
  assert.throws(
    () => trackedSource.prepareBodyCandidate(0.001, {}),
    /geometry setting/,
  );
  assert.equal(handles.length, 0);
  assert.equal(trackedSource.snapshot().hasCurve, true);
  checks++;
  fault = "wire";
  handles = [];
  const kernelRejected = classes.SketchLineWireCandidate.createChecked(
    kernel,
    data(),
    geometrySettings,
  );
  assert.equal(kernelRejected.status, "kernel-rejected");
  assert.equal(kernelRejected.checks.passed, true);
  assert.ok(handles.every((h) => h.isDeleted()));
  fault = undefined;
  checks++;
  // Supplied native checker outcomes control ownership, not kernel validity.
  for (const input of [
    { initialStatus: 0, generalStatus: 1, boundsPassed: true },
    { initialStatus: 6, generalStatus: 1, boundsPassed: true },
    { initialStatus: 6, generalStatus: 2, promoteRetainedStatus: false },
  ]) {
    const kept = make(oc, data());
    owned.push(kept);
    const wire = kept.wire,
      edge = kept.firstEdge;
    assert.deepEqual(plain(kept.applyValidationResult(input)), {
      status: input.initialStatus,
      retainCandidate: true,
    });
    assert.equal(wire.isDeleted(), false);
    assert.equal(edge.isDeleted(), false);
    assert.equal(inspect(wire).length, 2);
  }
  checks++;
  for (const input of [
    { initialStatus: 0, generalStatus: 1, boundsPassed: false },
    { initialStatus: 6, generalStatus: 1, boundsPassed: false },
    { initialStatus: 6, generalStatus: 2, promoteRetainedStatus: true },
    { initialStatus: 0, generalStatus: 5, promoteRetainedStatus: false },
    { initialStatus: 6, generalStatus: 6, promoteRetainedStatus: true },
    { initialStatus: 6, generalStatus: 13, promoteRetainedStatus: false },
  ]) {
    const retired = make(oc, data());
    owned.push(retired);
    const wire = retired.wire,
      edge = retired.firstEdge;
    const result = retired.applyValidationResult(input);
    assert.equal(result.retainCandidate, false);
    assert.ok(wire.isDeleted() && edge.isDeleted());
    assert.deepEqual(plain(retired.snapshot()), {
      disposed: true,
      hasWire: false,
      hasFirstEdge: false,
    });
    assert.throws(() => retired.applyValidationResult(input), /disposed/);
    retired.dispose();
    assert.equal(source.snapshot().hasCurve, true);
  }
  checks++;
  const malformedValidation = make(oc, data());
  owned.push(malformedValidation);
  for (const input of [
    {},
    { initialStatus: 6, generalStatus: 2 },
    { initialStatus: 0, generalStatus: 1, boundsPassed: 1 },
  ])
    assert.throws(
      () => malformedValidation.applyValidationResult(input),
      /wire validation/i,
    );
  assert.equal(malformedValidation.snapshot().hasWire, true);
  assert.equal(malformedValidation.snapshot().hasFirstEdge, true);
  checks++;
  fault = "dispose";
  const retirementFault = make(kernel, data());
  owned.push(retirementFault);
  const faultWire = retirementFault.wire,
    faultEdge = retirementFault.firstEdge;
  assert.throws(
    () =>
      retirementFault.applyValidationResult({
        initialStatus: 0,
        generalStatus: 1,
        boundsPassed: false,
      }),
    (e) => e.name === "AggregateError" && e.errors.length === 2,
  );
  assert.ok(faultWire.isDeleted() && faultEdge.isDeleted());
  assert.equal(retirementFault.snapshot().disposed, true);
  retirementFault.dispose();
  fault = undefined;
  checks++;
  const borrowedWire = candidate.wire,
    borrowedEdge = candidate.firstEdge;
  candidate.dispose();
  candidate.dispose();
  assert.ok(borrowedWire.isDeleted() && borrowedEdge.isDeleted());
  assert.throws(() => candidate.wire, /disposed/i);
  assert.throws(() => candidate.firstEdge, /disposed/i);
  assert.deepEqual(inspect(detached.wire), [
    plain(data().start),
    plain(data().end),
  ]);
  assert.equal(source.snapshot().hasCurve, true);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Real converted analytic wire candidate, explicit vertices, first edge, validation and handle retirement; original-native admission and public GUI/MCP acceptance remain unfinished",
    }),
  );
} finally {
  for (const owner of owned.reverse()) owner?.dispose();
  clearTimeout(expiry);
}
