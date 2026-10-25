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
const expiry = setTimeout(() => {
  console.error("Line curve smoke exceeded 90 seconds");
  process.exit(124);
}, 90000);
const plain = (x) => JSON.parse(JSON.stringify(x));
const request = () => ({
  kind: "line",
  points: [
    [1, 2, 3],
    [4, 6, 3],
  ],
});
const owned = [];
let checks = 0;
const near = (actual, expected, tol = 1e-12) =>
  assert.ok(
    actual.every((v, i) => Math.abs(v - expected[i]) <= tol),
    JSON.stringify({ actual, expected }),
  );
try {
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  const curve = new classes.SketchLineCurve(oc);
  owned.push(curve);
  assert.deepEqual(plain(curve.snapshot()), {
    disposed: false,
    hasCurve: false,
  });
  assert.equal(curve.evaluateFraction(0.5), undefined);
  assert.equal(curve.prepareBodyConversion(0.001), undefined);
  assert.equal(curve.prepareBodyEndpoints(0.001), undefined);
  for (const scale of [undefined, null, "0.001", 0, -1, NaN, Infinity])
    assert.throws(() => curve.prepareBodyConversion(scale), /scale/i);
  checks++;
  assert.equal(curve.rebuildCurve(request()), true);
  near(curve.evaluateFraction(0), [1, 2, 3]);
  near(curve.evaluateFraction(1), [4, 6, 3]);
  near(curve.evaluateFraction(0.5), [2.5, 4, 3]);
  const adaptor = new oc.BRepAdaptor_Curve_2(curve.edge);
  try {
    assert.equal(
      adaptor.GetType().value,
      oc.GeomAbs_CurveType.GeomAbs_Line.value,
    );
    assert.equal(adaptor.FirstParameter(), 0);
    assert.equal(adaptor.LastParameter(), 5);
  } finally {
    adaptor.delete();
  }
  assert.equal("builderSucceeded" in curve.snapshot(), false);
  checks++;
  const converted = curve.prepareBodyConversion(0.001);
  near(converted.origin, [0.001, 0.002, 0.003]);
  near(converted.direction, [0.6, 0.8, 0]);
  near(converted.interval, [0, 0.005]);
  assert.deepEqual(Object.keys(converted).sort(), [
    "direction",
    "interval",
    "origin",
  ]);
  converted.origin[0] = 999;
  near(curve.prepareBodyConversion(1).origin, [1, 2, 3]);
  checks++;
  const endpoints = curve.prepareBodyEndpoints(0.001);
  assert.deepEqual(Object.keys(endpoints).sort(), [
    "conversion",
    "end",
    "start",
  ]);
  near(endpoints.start, [0.001, 0.002, 0.003]);
  near(endpoints.end, [0.004, 0.006, 0.003]);
  assert.notEqual(endpoints.start, endpoints.conversion.origin);
  endpoints.start[0] = 99;
  endpoints.end[1] = 88;
  near(curve.prepareBodyEndpoints(0.001).start, [0.001, 0.002, 0.003]);
  assert.equal("body" in endpoints, false);
  assert.equal("firstEdge" in endpoints, false);
  checks++;
  const input = request();
  curve.rebuildCurve(input);
  input.points[0][0] = 99;
  const snapshot = curve.snapshot();
  snapshot.request.points[0][0] = 88;
  assert.deepEqual(plain(curve.snapshot().request), request());
  near(curve.evaluateFraction(0), [1, 2, 3]);
  checks++;
  const retained = curve.edge;
  for (const bad of [
    null,
    [],
    {
      kind: "circle",
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    },
    { ...request(), extra: true },
    {
      kind: "line",
      points: [
        [1, 2],
        [3, 4, 5],
      ],
    },
    {
      kind: "line",
      points: [
        [NaN, 0, 0],
        [1, 0, 0],
      ],
    },
    { kind: "line", points: Array(2) },
  ])
    assert.throws(() => curve.rebuildCurve(bad));
  assert.equal(curve.edge, retained);
  assert.equal(retained.isDeleted(), false);
  checks++;
  assert.equal(
    curve.rebuildCurve({
      kind: "line",
      points: [
        [0, 0, 0],
        [0.5e-7, 0, 0],
      ],
    }),
    false,
  );
  assert.equal(retained.isDeleted(), true);
  assert.equal(curve.snapshot().hasCurve, false);
  assert.equal(curve.evaluateFraction(0.5), undefined);
  checks++;
  curve.rebuildCurve(request());
  const old = curve.edge;
  assert.throws(
    () =>
      curve.rebuildCurve({
        kind: "line",
        points: [
          [1e308, 0, 0],
          [-1e308, 0, 0],
        ],
      }),
    /overflow/,
  );
  assert.equal(old.isDeleted(), true);
  assert.equal(curve.snapshot().hasCurve, false);
  checks++;
  curve.rebuildCurve({
    kind: "line",
    points: [
      [4, 6, 9],
      [1, 2, -3],
    ],
  });
  near(curve.evaluateFraction(-4), [4, 6, 9]);
  near(curve.evaluateFraction(7), [1, 2, -3]);
  near(curve.evaluateFraction(0.5), [2.5, 4, 3]);
  for (const n of [NaN, Infinity, -Infinity])
    assert.throws(() => curve.evaluateFraction(n));
  assert.equal(curve.snapshot().hasCurve, true);
  checks++;
  const handles = [],
    candidateEdges = [];
  let fault,
    segmentCalls = 0;
  const names = new Set([
    "gp_Pnt_3",
    "gp_Dir_4",
    "gp_Lin_3",
    "GC_MakeSegment_2",
    "Handle_Geom_Curve_2",
    "BRepBuilderAPI_MakeEdge_24",
    "BRepAdaptor_Curve_2",
  ]);
  const kernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (!names.has(key)) return value;
      return function (...args) {
        const h = new value(...args);
        handles.push(h);
        if (key === "gp_Lin_3" && fault === "cleanup") {
          const remove = h.delete.bind(h);
          h.delete = () => {
            remove();
            throw new Error("Controlled line cleanup failure");
          };
        }
        if (key === "GC_MakeSegment_2") {
          segmentCalls++;
          const getValue = h.Value.bind(h);
          h.Value = () => {
            if (fault === "segment")
              throw new Error("Controlled line segment failure");
            const result = getValue();
            handles.push(result);
            return result;
          };
        }
        if (key === "BRepBuilderAPI_MakeEdge_24") {
          const getEdge = h.Edge.bind(h);
          h.Edge = () => {
            const edge = getEdge();
            candidateEdges.push(edge);
            return edge;
          };
          if (fault === "edge") h.IsDone = () => false;
        }
        if (key === "BRepAdaptor_Curve_2") {
          const getValue = h.Value.bind(h);
          h.Value = (p) => {
            if (fault === "evaluation")
              throw new Error("Controlled line evaluation failure");
            const result =
              fault === "conversionPoints"
                ? new oc.gp_Pnt_3(...(p === 0 ? [10, 20, 30] : [13, 24, 30]))
                : getValue(p);
            handles.push(result);
            return result;
          };
        }
        return h;
      };
    },
  });
  const tracked = new classes.SketchLineCurve(kernel);
  owned.push(tracked);
  for (const length of [0, 0.5e-7]) {
    const before = segmentCalls;
    assert.equal(
      tracked.rebuildCurve({
        kind: "line",
        points: [
          [0, 0, 0],
          [length, 0, 0],
        ],
      }),
      false,
    );
    assert.equal(segmentCalls, before);
  }
  const before = segmentCalls;
  tracked.rebuildCurve({
    kind: "line",
    points: [
      [0, 0, 0],
      [1e-7, 0, 0],
    ],
  });
  assert.equal(segmentCalls, before + 1);
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  for (const mode of ["segment", "edge", "cleanup"]) {
    fault = undefined;
    handles.length = 0;
    assert.equal(tracked.rebuildCurve(request()), true);
    const original = tracked.edge;
    fault = mode;
    handles.length = 0;
    candidateEdges.length = 0;
    if (mode === "segment")
      assert.throws(() => tracked.rebuildCurve(request()), /Controlled line/);
    else if (mode === "cleanup")
      assert.throws(() => tracked.rebuildCurve(request()), /cleanup failed/);
    else assert.equal(tracked.rebuildCurve(request()), false);
    assert.ok(original.isDeleted());
    assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
    assert.ok(candidateEdges.every((h) => h.isDeleted()));
    assert.equal(tracked.snapshot().hasCurve, false);
    checks++;
  }
  fault = undefined;
  tracked.rebuildCurve(request());
  const queryEdge = tracked.edge;
  handles.length = 0;
  fault = "evaluation";
  assert.throws(
    () => tracked.evaluateFraction(0.5),
    /Controlled line evaluation/,
  );
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  handles.length = 0;
  assert.throws(
    () => tracked.prepareBodyConversion(0.001),
    /Controlled line evaluation/,
  );
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  handles.length = 0;
  assert.throws(
    () => tracked.prepareBodyEndpoints(0.001),
    /Controlled line evaluation/,
  );
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  fault = undefined;
  handles.length = 0;
  assert.throws(() => tracked.prepareBodyConversion(0), /scale/i);
  assert.equal(handles.length, 0);
  assert.throws(() => tracked.prepareBodyConversion(1e308), /overflow/i);
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  handles.length = 0;
  assert.throws(() => tracked.prepareBodyEndpoints(0), /scale/i);
  assert.equal(handles.length, 0);
  assert.throws(() => tracked.prepareBodyEndpoints(1e308), /overflow/i);
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  fault = "conversionPoints";
  handles.length = 0;
  const evaluatedConversion = tracked.prepareBodyConversion(0.001);
  near(evaluatedConversion.origin, [0.01, 0.02, 0.03]);
  near(evaluatedConversion.direction, [0.6, 0.8, 0]);
  near(evaluatedConversion.interval, [0, 0.005]);
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  handles.length = 0;
  const evaluatedEndpoints = tracked.prepareBodyEndpoints(0.001);
  near(evaluatedEndpoints.start, [0.01, 0.02, 0.03]);
  near(evaluatedEndpoints.end, [0.013, 0.024, 0.03]);
  assert.equal(evaluatedEndpoints.end[0], 0.013000000000000001);
  assert.equal(tracked.edge, queryEdge);
  assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
  checks++;
  fault = undefined;
  handles.length = 0;
  for (let i = 0; i < 100; i++) {
    assert.equal(tracked.rebuildCurve(request()), true);
    near(tracked.evaluateFraction(0.5), [2.5, 4, 3]);
    near(tracked.prepareBodyConversion(0.001).interval, [0, 0.005]);
    near(tracked.prepareBodyEndpoints(0.001).end, [0.004, 0.006, 0.003]);
  }
  assert.ok(handles.every((h) => h.isDeleted()));
  checks++;
  curve.dispose();
  curve.dispose();
  assert.equal(curve.snapshot().disposed, true);
  assert.equal(curve.snapshot().hasCurve, false);
  assert.throws(() => curve.edge, /disposed/);
  assert.throws(() => curve.rebuildCurve(request()), /disposed/);
  assert.throws(() => curve.prepareBodyConversion(0.001), /disposed/);
  assert.throws(() => curve.prepareBodyEndpoints(0.001), /disposed/);
  near(tracked.evaluateFraction(0), [1, 2, 3]);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      scope:
        "Primary line curve construction/evaluation/conversion-parameter ownership only; no converted-body, native backend, GUI or MCP acceptance",
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
    }),
  );
} finally {
  for (const o of owned) o.dispose();
  clearTimeout(expiry);
}
