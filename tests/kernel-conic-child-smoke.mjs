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
  console.error("Conic child smoke exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
const plain = (value) => JSON.parse(JSON.stringify(value));
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const points = [
  [1, 0, 9],
  [0, 1, 8],
  [-1, 0, 7],
];
const arcInput = (p = points, close = false) => ({
  kind: "arc",
  points: p,
  frame,
  close,
});
const circleInput = (p = points) => ({ kind: "circle", points: p, frame });
const children = [];
let checks = 0;
const checked = () => {
  checks++;
};
try {
  const oc = await vm.runInContext("kernel()", context);
  context.childKernel = oc;
  const create = (kind) => {
    context.childKind = kind;
    const c = vm.runInContext(
      "createSketchConicChild(childKind, childKernel)",
      context,
    );
    children.push(c);
    return c;
  };
  const arc = create("arc"),
    circle = create("circle");
  assert.equal(arc.snapshot().validity, "uninitialized");
  assert.equal(arc.snapshot().preparation, undefined);
  assert.equal(arc.edge, undefined);
  checked();

  let result = arc.rebuild(
    arcInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  assert.equal(result.validity, "uninitialized");
  assert.equal(result.preparation.radius, undefined);
  assert.equal(result.outcome.backendAttempted, false);
  assert.equal(result.outcome.backendSucceeded, undefined);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.equal(result.backend.kind, "empty");
  checked();

  result = arc.rebuild(arcInput());
  assert.equal(result.validity, "valid");
  assert.equal(result.outcome.builderSucceeded, true);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.backendSucceeded, true);
  assert.equal(result.preparation.sourceRecords.length, 4);
  assert.equal(result.backend.records.length, 3);
  const old = arc.edge;
  assert.ok(old && !old.IsNull());
  checked();

  result = arc.rebuild(
    arcInput([
      [0, 0, 9],
      [1, 0, 8],
      [3, 0, 7],
    ]),
  );
  assert.equal(result.outcome.builderSucceeded, false);
  assert.equal(result.outcome.backendAttempted, false);
  assert.equal(result.validity, "valid"); // Native predicate is distinct from last builder success.
  assert.equal(arc.edge, old);
  assert.equal(old.isDeleted(), false);
  assert.deepEqual(plain(result.preparation.center), [1, 0, 0]);
  assert.deepEqual(plain(result.preparation.sourceRecords[3]), [0, 0, 0]);
  assert.deepEqual(plain(result.backend.records), [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
  ]);
  checked();

  result = arc.rebuild(
    arcInput([
      [3, 4, 0],
      [3, 4, 0],
      [3, 4, 0],
    ]),
  );
  assert.equal(result.preparation.radius, 0);
  assert.equal(result.validity, "invalid");
  assert.equal(result.backend.kind, "arc");
  assert.equal(arc.edge, old);
  checked();

  result = arc.rebuild(arcInput());
  const beforeClosed = arc.edge;
  result = arc.rebuild(arcInput(points, true));
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.backendSucceeded, false);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.equal(result.validity, "invalid");
  assert.ok(beforeClosed.isDeleted());
  assert.deepEqual(plain(result.preparation.sourceRecords[0]), [1, 0, 0]);
  assert.deepEqual(plain(result.preparation.points[0]), [-1, 0, 0]);
  checked();

  result = circle.rebuild(circleInput());
  assert.equal(result.validity, "valid");
  assert.equal(result.preparation.sourceRecords.length, 4);
  assert.equal(result.backend.records.length, 1);
  const circleEdge = circle.edge;
  result = circle.rebuild(
    circleInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  assert.equal(result.preparation.fitSucceeded, false);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.backendSucceeded, false);
  assert.equal(result.validity, "invalid");
  assert.ok(circleEdge.isDeleted());
  checked();

  const input = structuredClone(circleInput());
  result = circle.rebuild(input);
  input.points[0][0] = 99;
  input.frame[0][3] = 99;
  result.preparation.sourceRecords[0][0] = 88;
  result.backend.records[0][0] = 88;
  const saved = circle.snapshot();
  assert.deepEqual(plain(saved.preparation.sourceRecords[0]), [1, 0, 0]);
  assert.equal(saved.preparation.frame[0][3], 10);
  assert.deepEqual(plain(saved.backend.records), [[0, 0, 0]]);
  checked();

  const live = circle.edge;
  const beforeInvalid = plain(circle.snapshot());
  for (const bad of [
    null,
    {},
    arcInput(),
    { ...circleInput(), unexpected: true },
    circleInput([[NaN, 0, 0], points[1], points[2]]),
  ])
    assert.throws(() => circle.rebuild(bad));
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  assert.deepEqual(plain(circle.snapshot()), beforeInvalid);
  checked();

  const preAbort = new AbortController();
  preAbort.abort();
  assert.throws(
    () => circle.rebuild(circleInput(), preAbort.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  assert.deepEqual(plain(circle.snapshot()), beforeInvalid);
  checked();

  arc.rebuild(arcInput());
  const retainedEdge = arc.edge;
  const replacement = [
    [1, 0, 0],
    [0.001, 1, 0],
    [-1, 0, 0],
    [91, 92, 93],
  ];
  result = arc.replaceLocalArcRecords(replacement);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.preparation.points), [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
  ]);
  assert.ok(retainedEdge.isDeleted());
  assert.notEqual(arc.edge, retainedEdge);
  const retainedNewEdge = arc.edge;
  result = arc.replaceLocalArcRecords(replacement.slice(0, 3));
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.preparation.points[1][0], 0.001);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.ok(retainedNewEdge.isDeleted());
  checked();

  arc.rebuild(arcInput());
  const beforeFailedReplacement = arc.edge;
  arc.rebuild(
    arcInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  assert.equal(arc.edge, beforeFailedReplacement);
  result = arc.replaceLocalArcRecords([
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 0],
    [99, 99, 99],
  ]);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.deepEqual(plain(result.preparation.sourceRecords[3]), [1, 0, 0]);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.equal(result.validity, "invalid");
  assert.ok(beforeFailedReplacement.isDeleted());
  checked();

  arc.rebuild(arcInput(points, true));
  result = arc.replaceLocalArcRecords([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 0],
  ]);
  assert.equal(result.preparation.closed, false);
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.validity, "valid");
  checked();

  const beforeBadRecords = arc.snapshot(),
    beforeBadEdge = arc.edge;
  const stopped = new AbortController();
  stopped.abort();
  assert.throws(
    () => arc.replaceLocalArcRecords(replacement, stopped.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(() => arc.replaceLocalArcRecords([[0, 0, 0]]));
  assert.deepEqual(arc.snapshot(), beforeBadRecords);
  assert.equal(arc.edge, beforeBadEdge);
  assert.throws(() => circle.replaceLocalArcRecords(replacement), /arc/);
  assert.throws(
    () => create("arc").replaceLocalArcRecords(replacement),
    /prepared/,
  );
  checked();

  const placedFrame = [
    [0, 0, 1, 10],
    [1, 0, 0, 20],
    [0, 1, 0, 30],
  ];
  const placedRecords = [
    [10, 21, 30],
    [10, 20, 31],
    [10, 19, 30],
    [17, 25, 36],
  ];
  arc.rebuild(arcInput());
  const beforePlaced = arc.edge;
  result = arc.replacePlacedArcRecords(placedRecords, placedFrame);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.preparation.frame), frame);
  assert.deepEqual(plain(result.preparation.center), [5, 6, 7]);
  assert.deepEqual(plain(result.backend.records), [
    [6, 6, 7],
    [5, 7, 7],
    [4, 6, 7],
  ]);
  assert.ok(beforePlaced.isDeleted());
  const measured = new oc.BRepAdaptor_Curve_2(arc.edge);
  const measuredCircle = measured.Circle(),
    measuredCenter = measuredCircle.Location();
  try {
    assert.ok(Math.abs(measuredCircle.Radius() - 1) < 1e-12);
    [measuredCenter.X(), measuredCenter.Y(), measuredCenter.Z()].forEach(
      (n, i) => assert.ok(Math.abs(n - [5, 6, 7][i]) < 1e-12),
    );
  } finally {
    measuredCenter.delete();
    measuredCircle.delete();
    measured.delete();
  }
  checked();

  const beforePlacedRefit = arc.edge;
  result = arc.replacePlacedArcRecords(
    [
      [109, 22, 30],
      [109, 20, 32],
      [109, 18, 30],
    ],
    placedFrame,
  );
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.preparation.frame), placedFrame);
  assert.deepEqual(plain(result.backend.records), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
  ]);
  assert.ok(beforePlacedRefit.isDeleted());
  const beforePlacedInvalid = arc.snapshot(),
    placedLive = arc.edge;
  assert.throws(
    () =>
      arc.replacePlacedArcRecords(placedRecords, placedFrame, stopped.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(() => arc.replacePlacedArcRecords(placedRecords, [[0]]));
  assert.throws(
    () => circle.replacePlacedArcRecords(placedRecords, placedFrame),
    /arc/,
  );
  assert.throws(
    () => create("arc").replacePlacedArcRecords(placedRecords, placedFrame),
    /prepared/,
  );
  assert.deepEqual(arc.snapshot(), beforePlacedInvalid);
  assert.equal(arc.edge, placedLive);
  checked();

  arc.rebuild(arcInput());
  arc.replacePlacedArcRecords(placedRecords, placedFrame);
  const beforePointMove = arc.edge;
  result = arc.editArcPoint(3, [8, 9, 99]);
  assert.deepEqual(plain(result.preparation.center), [8, 9, 7]);
  assert.deepEqual(plain(result.backend.records), [
    [9, 9, 7],
    [8, 10, 7],
    [7, 9, 7],
  ]);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.validity, "valid");
  assert.ok(beforePointMove.isDeleted());
  const pointCurve = new oc.BRepAdaptor_Curve_2(arc.edge),
    pointCircle = pointCurve.Circle(),
    pointCenter = pointCircle.Location();
  try {
    assert.ok(Math.abs(pointCircle.Radius() - 1) < 1e-12);
    [pointCenter.X(), pointCenter.Y(), pointCenter.Z()].forEach((n, i) =>
      assert.ok(Math.abs(n - [8, 9, 7][i]) < 1e-12),
    );
  } finally {
    pointCenter.delete();
    pointCircle.delete();
    pointCurve.delete();
  }
  const beforePointRefit = arc.edge;
  result = arc.editArcPoint(1, [8, 10.25, 123]);
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.backend.records), [
    [9, 9, 0],
    [8, 10.25, 0],
    [7, 9, 0],
  ]);
  assert.ok(beforePointRefit.isDeleted());
  checked();

  arc.rebuild(arcInput());
  const pointFailureEdge = arc.edge;
  result = arc.editArcPoint(1, [0, 0, 99]);
  assert.equal(result.outcome.backendAttempted, false);
  assert.equal(arc.edge, pointFailureEdge);
  assert.equal(result.validity, "valid");
  result = arc.editArcPoint(3, [5, 6, 99]);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.backendSucceeded, false);
  assert.ok(pointFailureEdge.isDeleted());
  checked();

  arc.rebuild(arcInput(points, true));
  result = arc.editArcPoint(0, [2, 0, 0]);
  assert.equal(result.preparation.closed, true);
  assert.equal(result.preparation.fitSucceeded, true);
  assert.deepEqual(plain(result.preparation.sourceRecords[0]), [2, 0, 0]);
  assert.deepEqual(plain(result.preparation.points[0]), [-1, 0, 0]);
  assert.equal(result.outcome.backendSucceeded, false);
  result = arc.editArcPoint(3, [4, 5, 99]);
  assert.equal(result.preparation.closed, true);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.outcome.backendSucceeded, false);
  const beforeBadPoint = arc.snapshot();
  assert.throws(
    () => arc.editArcPoint(0, [0, 0, 0], stopped.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(() => arc.editArcPoint(4, [0, 0, 0]));
  assert.throws(() => arc.editArcPoint(1, [NaN, 0, 0]));
  assert.throws(() => circle.editArcPoint(0, [0, 0, 0]), /arc/);
  assert.throws(() => create("arc").editArcPoint(0, [0, 0, 0]), /prepared/);
  assert.deepEqual(arc.snapshot(), beforeBadPoint);
  checked();

  const transformed = create("arc");
  transformed.rebuild(arcInput());
  const localTransform = [
    [1, 0, 0, 3],
    [0, 1, 0, 4],
    [0, 0, 1, 100],
  ];
  const beforeTransform = transformed.edge;
  result = transformed.transformArcLocalPoints(localTransform);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.preparation.center), [3, 4, 0]);
  assert.deepEqual(plain(result.preparation.frame), frame);
  assert.deepEqual(plain(result.backend.records), [
    [4, 4, 0],
    [3, 5, 0],
    [2, 4, 0],
  ]);
  assert.ok(beforeTransform.isDeleted());
  const transformedCurve = new oc.BRepAdaptor_Curve_2(transformed.edge),
    transformedCircle = transformedCurve.Circle(),
    transformedCenter = transformedCircle.Location();
  try {
    assert.ok(Math.abs(transformedCircle.Radius() - 1) < 1e-12);
    [
      transformedCenter.X(),
      transformedCenter.Y(),
      transformedCenter.Z(),
    ].forEach((n, i) => assert.ok(Math.abs(n - [3, 4, 0][i]) < 1e-12));
  } finally {
    transformedCenter.delete();
    transformedCircle.delete();
    transformedCurve.delete();
  }
  checked();

  const beforeCollapse = transformed.edge;
  result = transformed.transformArcLocalPoints([
    [1, 0, 0, 0],
    [0, 0, -1, 0],
    [0, 1, 0, 0],
  ]);
  assert.equal(result.outcome.backendAttempted, false);
  assert.equal(result.preparation.radius, 1);
  assert.equal(transformed.edge, beforeCollapse);
  result = transformed.rebuildArcRecords([
    [1, 0, 99],
    [0.001, 1, 99],
    [-1, 0, 99],
    [999, 999, 999],
  ]);
  assert.equal(result.preparation.fitSucceeded, true);
  assert.equal(result.validity, "valid");
  assert.deepEqual(plain(result.backend.records), [
    [1, 0, 0],
    [0.001, 1, 0],
    [-1, 0, 0],
  ]);
  assert.ok(beforeCollapse.isDeleted());
  checked();

  transformed.rebuild(arcInput(points, true));
  result = transformed.rebuildArcRecords([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 0],
  ]);
  assert.equal(result.preparation.closed, true);
  assert.equal(result.outcome.backendSucceeded, false);
  result = transformed.transformArcLocalPoints(localTransform);
  assert.equal(result.preparation.closed, true);
  assert.equal(result.outcome.backendAttempted, false);
  const beforeInvalidRoute = transformed.snapshot();
  assert.throws(
    () => transformed.transformArcLocalPoints(localTransform, stopped.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(
    () => transformed.rebuildArcRecords(points, stopped.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(() => transformed.transformArcLocalPoints([[0]]));
  assert.throws(() => transformed.rebuildArcRecords([]));
  assert.throws(() => circle.transformArcLocalPoints(localTransform), /arc/);
  assert.throws(() => circle.rebuildArcRecords(points), /arc/);
  const unpreparedRoutes = create("arc");
  assert.throws(
    () => unpreparedRoutes.transformArcLocalPoints(localTransform),
    /prepared/,
  );
  assert.throws(() => unpreparedRoutes.rebuildArcRecords(points), /prepared/);
  assert.deepEqual(transformed.snapshot(), beforeInvalidRoute);
  checked();

  // Real kernel allocations; the callback only injects an exception or marks a
  // local signal during synchronous construction. No native program execution.
  let mode, controller;
  const owned = [];
  const tracked = new Set([
    "gp_Pnt_3",
    "GC_MakeArcOfCircle_4",
    "GC_MakeCircle_1",
    "gp_Dir_4",
    "gp_Ax2_2",
    "gp_Circ_2",
    "Handle_Geom_Curve_2",
    "BRepBuilderAPI_MakeEdge_24",
  ]);
  context.childFaultKernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (!tracked.has(key)) return value;
      return function (...args) {
        const h = new value(...args);
        owned.push(h);
        if (key === "GC_MakeArcOfCircle_4" || key === "GC_MakeCircle_1") {
          const get = h.Value.bind(h);
          h.Value = () => {
            if (mode === "throw")
              throw new Error("Controlled child kernel exception");
            const result = get();
            owned.push(result);
            if (mode === "abort") controller.abort();
            return result;
          };
        }
        if (key === "BRepBuilderAPI_MakeEdge_24") {
          const edge = h.Edge.bind(h);
          h.Edge = () => {
            const result = edge();
            owned.push(result);
            return result;
          };
        }
        return h;
      };
    },
  });
  const faulty = vm.runInContext(
    "createSketchConicChild('arc', childFaultKernel)",
    context,
  );
  children.push(faulty);
  faulty.rebuild(arcInput());
  const previous = faulty.edge;
  owned.length = 0;
  mode = "throw";
  assert.throws(
    () =>
      faulty.rebuild(
        arcInput([
          [2, 0, 0],
          [0, 2, 0],
          [-2, 0, 0],
        ]),
      ),
    /Controlled child/,
  );
  assert.ok(previous.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  result = faulty.snapshot();
  assert.equal(result.preparation.radius, 2);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.match(result.outcome.error, /Controlled child/);
  assert.equal(result.validity, "invalid");
  checked();

  mode = undefined;
  faulty.rebuild(arcInput());
  const beforeAbort = faulty.edge;
  owned.length = 0;
  mode = "abort";
  controller = new AbortController();
  assert.throws(
    () => faulty.rebuild(arcInput(), controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeAbort.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(faulty.snapshot().disposed, true);
  assert.equal(faulty.snapshot().preparation, undefined);
  assert.equal(faulty.snapshot().validity, "invalid");
  assert.throws(() => faulty.rebuild(arcInput()), /disposed/);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  mode = undefined;
  const replacementFaulty = vm.runInContext(
    "createSketchConicChild('arc', childFaultKernel)",
    context,
  );
  children.push(replacementFaulty);
  replacementFaulty.rebuild(arcInput());
  const beforeReplacementThrow = replacementFaulty.edge;
  mode = "throw";
  owned.length = 0;
  assert.throws(
    () => replacementFaulty.replaceLocalArcRecords(replacement),
    /Controlled child/,
  );
  assert.ok(beforeReplacementThrow.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(
    replacementFaulty.snapshot().preparation.fitSucceeded,
    undefined,
  );
  assert.match(replacementFaulty.snapshot().outcome.error, /Controlled child/);
  mode = undefined;
  replacementFaulty.rebuild(arcInput());
  const beforeReplacementAbort = replacementFaulty.edge;
  controller = new AbortController();
  mode = "abort";
  owned.length = 0;
  assert.throws(
    () =>
      replacementFaulty.replaceLocalArcRecords(replacement, controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeReplacementAbort.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(replacementFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  checked();

  mode = undefined;
  const placedFaulty = vm.runInContext(
    "createSketchConicChild('arc', childFaultKernel)",
    context,
  );
  children.push(placedFaulty);
  placedFaulty.rebuild(arcInput());
  const beforePlacedThrow = placedFaulty.edge;
  mode = "throw";
  owned.length = 0;
  assert.throws(
    () => placedFaulty.replacePlacedArcRecords(placedRecords, placedFrame),
    /Controlled child/,
  );
  assert.ok(beforePlacedThrow.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.deepEqual(
    plain(placedFaulty.snapshot().preparation.center),
    [5, 6, 7],
  );
  assert.match(placedFaulty.snapshot().outcome.error, /Controlled child/);
  mode = undefined;
  placedFaulty.rebuild(arcInput());
  const beforePlacedAbort = placedFaulty.edge;
  controller = new AbortController();
  mode = "abort";
  owned.length = 0;
  assert.throws(
    () =>
      placedFaulty.replacePlacedArcRecords(
        placedRecords,
        placedFrame,
        controller.signal,
      ),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforePlacedAbort.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(placedFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  checked();

  mode = undefined;
  const pointFaulty = vm.runInContext(
    "createSketchConicChild('arc', childFaultKernel)",
    context,
  );
  children.push(pointFaulty);
  pointFaulty.rebuild(arcInput());
  const beforePointThrow = pointFaulty.edge;
  mode = "throw";
  owned.length = 0;
  assert.throws(
    () => pointFaulty.editArcPoint(3, [4, 5, 99]),
    /Controlled child/,
  );
  assert.ok(beforePointThrow.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.deepEqual(plain(pointFaulty.snapshot().preparation.center), [4, 5, 0]);
  mode = undefined;
  pointFaulty.rebuild(arcInput());
  const beforePointAbort = pointFaulty.edge;
  controller = new AbortController();
  mode = "abort";
  owned.length = 0;
  assert.throws(
    () => pointFaulty.editArcPoint(1, [0, 1.25, 99], controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforePointAbort.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(pointFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  checked();

  mode = undefined;
  const routesFaulty = vm.runInContext(
    "createSketchConicChild('arc', childFaultKernel)",
    context,
  );
  children.push(routesFaulty);
  routesFaulty.rebuild(arcInput());
  const beforeTransformThrow = routesFaulty.edge;
  mode = "throw";
  owned.length = 0;
  assert.throws(
    () => routesFaulty.transformArcLocalPoints(localTransform),
    /Controlled child/,
  );
  assert.ok(beforeTransformThrow.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.deepEqual(
    plain(routesFaulty.snapshot().preparation.center),
    [3, 4, 0],
  );
  mode = undefined;
  routesFaulty.rebuild(arcInput());
  const beforeCollectionAbort = routesFaulty.edge;
  controller = new AbortController();
  mode = "abort";
  owned.length = 0;
  assert.throws(
    () =>
      routesFaulty.rebuildArcRecords(
        [
          [1, 0, 0],
          [0, 1.25, 0],
          [-1, 0, 0],
        ],
        controller.signal,
      ),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeCollectionAbort.isDeleted());
  assert.ok(owned.every((h) => h.isDeleted()));
  assert.equal(routesFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  checked();

  const editedCircle = create("circle");
  assert.throws(() => editedCircle.editCirclePoint(0, points[0]), /prepared/);
  assert.throws(
    () => editedCircle.transformCircleLocalPoints(frame),
    /prepared/,
  );
  assert.throws(() => arc.editCirclePoint(0, points[0]), /circle child/);
  assert.throws(() => arc.transformCircleLocalPoints(frame), /circle child/);
  editedCircle.rebuild(circleInput());
  const beforeCircleMove = editedCircle.edge;
  result = editedCircle.editCirclePoint(3, [5, 6, 100]);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.deepEqual(plain(result.backend.records), [[5, 6, 0]]);
  assert.ok(beforeCircleMove.isDeleted());
  const circleCurve = new oc.BRepAdaptor_Curve_2(editedCircle.edge);
  const circleGeometry = circleCurve.Circle();
  const circleCenter = circleGeometry.Location();
  try {
    assert.ok(Math.abs(circleGeometry.Radius() - 1) < 1e-12);
    assert.ok(Math.abs(circleCenter.X() - 5) < 1e-12);
    assert.ok(Math.abs(circleCenter.Y() - 6) < 1e-12);
    assert.equal(circleCenter.Z(), 0);
  } finally {
    circleCenter.delete();
    circleGeometry.delete();
    circleCurve.delete();
  }
  const beforeInvalidCircle = editedCircle.snapshot();
  assert.throws(() => editedCircle.editCirclePoint(4, [0, 0, 0]), /index/);
  assert.throws(() => editedCircle.transformCircleLocalPoints([]));
  const stoppedCircle = new AbortController();
  stoppedCircle.abort();
  assert.throws(
    () => editedCircle.editCirclePoint(0, points[0], stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(
    () => editedCircle.transformCircleLocalPoints(frame, stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.deepEqual(editedCircle.snapshot(), beforeInvalidCircle);
  checked();

  editedCircle.rebuild(circleInput());
  const beforeCircleScale = editedCircle.edge;
  result = editedCircle.transformCircleLocalPoints([
    [2, 0, 0, 0],
    [0, 3, 0, 0],
    [0, 0, 1, 0],
  ]);
  assert.equal(result.validity, "valid");
  assert.ok(beforeCircleScale.isDeleted());
  const scaledCurve = new oc.BRepAdaptor_Curve_2(editedCircle.edge);
  const scaledCircle = scaledCurve.Circle();
  try {
    assert.ok(Math.abs(scaledCircle.Radius() - 13 / 6) < 1e-12);
  } finally {
    scaledCircle.delete();
    scaledCurve.delete();
  }
  const beforeCircleCollapse = editedCircle.edge;
  result = editedCircle.transformCircleLocalPoints([
    [1, 0, 0, 0],
    [0, 0, -1, 0],
    [0, 1, 0, 0],
  ]);
  assert.equal(result.outcome.backendAttempted, true);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.equal(result.backend.kind, "empty");
  assert.ok(beforeCircleCollapse.isDeleted());
  result = editedCircle.editCirclePoint(3, [5, 6, 9]);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.outcome.builderSucceeded, false);
  result = editedCircle.editCirclePoint(1, [0, 3, 100]);
  assert.equal(result.validity, "valid");
  checked();

  mode = undefined;
  const circleFaulty = vm.runInContext(
    "createSketchConicChild('circle', childFaultKernel)",
    context,
  );
  children.push(circleFaulty);
  circleFaulty.rebuild(circleInput());
  const beforeCircleThrow = circleFaulty.edge;
  owned.length = 0;
  mode = "throw";
  assert.throws(
    () => circleFaulty.editCirclePoint(3, [5, 6, 0]),
    /Controlled child/,
  );
  assert.ok(beforeCircleThrow.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(circleFaulty.snapshot().validity, "invalid");
  assert.equal(circleFaulty.snapshot().preparation.fitSucceeded, undefined);
  mode = undefined;
  circleFaulty.rebuild(circleInput());
  const beforeCircleAbort = circleFaulty.edge;
  owned.length = 0;
  mode = "abort";
  controller = new AbortController();
  assert.throws(
    () => circleFaulty.transformCircleLocalPoints(frame, controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeCircleAbort.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(circleFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  const resizedCircle = create("circle");
  assert.throws(() => resizedCircle.editCircleRadius(2), /prepared/);
  assert.throws(() => arc.editCircleRadius(2), /circle child/);
  resizedCircle.rebuild(circleInput());
  const beforeResize = resizedCircle.edge;
  result = resizedCircle.editCircleRadius(-2);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.backend.radius, 2);
  assert.ok(beforeResize.isDeleted());
  const resizedCurve = new oc.BRepAdaptor_Curve_2(resizedCircle.edge);
  const resizedGeometry = resizedCurve.Circle();
  try {
    assert.ok(Math.abs(resizedGeometry.Radius() - 2) < 1e-12);
  } finally {
    resizedGeometry.delete();
    resizedCurve.delete();
  }
  const beforeBadRadius = resizedCircle.snapshot();
  assert.throws(() => resizedCircle.editCircleRadius(Infinity));
  assert.throws(
    () => resizedCircle.editCircleRadius(2, stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.deepEqual(resizedCircle.snapshot(), beforeBadRadius);
  result = resizedCircle.editCircleRadius(0);
  assert.equal(result.backend.radius, 0.01);
  assert.equal(result.validity, "valid");
  resizedCircle.rebuild(
    circleInput([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]),
  );
  result = resizedCircle.editCircleRadius(3);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.deepEqual(plain(result.preparation.sourceRecords), [
    [0, 0, 0],
    [0, 3, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  checked();

  mode = undefined;
  const radiusFaulty = vm.runInContext(
    "createSketchConicChild('circle', childFaultKernel)",
    context,
  );
  children.push(radiusFaulty);
  radiusFaulty.rebuild(circleInput());
  const beforeRadiusThrow = radiusFaulty.edge;
  owned.length = 0;
  mode = "throw";
  assert.throws(() => radiusFaulty.editCircleRadius(2), /Controlled child/);
  assert.ok(beforeRadiusThrow.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(radiusFaulty.snapshot().preparation.backendRequest.radius, 2);
  mode = undefined;
  radiusFaulty.rebuild(circleInput());
  const beforeRadiusAbort = radiusFaulty.edge;
  owned.length = 0;
  mode = "abort";
  controller = new AbortController();
  assert.throws(
    () => radiusFaulty.editCircleRadius(4, controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeRadiusAbort.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(radiusFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  const recordsCircle = create("circle");
  assert.throws(
    () => recordsCircle.replaceLocalCircleRecords(points),
    /prepared/,
  );
  assert.throws(() => recordsCircle.rebuildCircleRecords(points), /prepared/);
  assert.throws(() => arc.replaceLocalCircleRecords(points), /circle child/);
  assert.throws(() => arc.rebuildCircleRecords(points), /circle child/);
  recordsCircle.rebuild(circleInput());
  const circleRecords = [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [5, 6, 7],
  ];
  const beforeRecordsMove = recordsCircle.edge;
  result = recordsCircle.replaceLocalCircleRecords(circleRecords);
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.equal(result.outcome.builderSucceeded, true);
  assert.deepEqual(plain(result.backend.records), [[5, 6, 7]]);
  assert.ok(beforeRecordsMove.isDeleted());
  const recordCurve = new oc.BRepAdaptor_Curve_2(recordsCircle.edge);
  const recordCircle = recordCurve.Circle();
  const recordCenter = recordCircle.Location();
  try {
    assert.equal(recordCenter.Z(), 7);
    assert.equal(recordCenter.X(), 5);
    assert.equal(recordCenter.Y(), 6);
    assert.ok(Math.abs(recordCircle.Radius() - 1) < 1e-12);
  } finally {
    recordCenter.delete();
    recordCircle.delete();
    recordCurve.delete();
  }
  const beforeInvalidRecords = recordsCircle.snapshot();
  assert.throws(() => recordsCircle.rebuildCircleRecords([]));
  assert.throws(() => recordsCircle.replaceLocalCircleRecords([]));
  assert.throws(
    () => recordsCircle.rebuildCircleRecords(points, stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(
    () => recordsCircle.replaceLocalCircleRecords(points, stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.deepEqual(recordsCircle.snapshot(), beforeInvalidRecords);
  const beforeRecordsRefit = recordsCircle.edge;
  result = recordsCircle.rebuildCircleRecords(circleRecords);
  assert.equal(result.preparation.fitSucceeded, true);
  assert.deepEqual(plain(result.backend.records), [[0, 0, 0]]);
  assert.ok(beforeRecordsRefit.isDeleted());
  const beforeRecordsFailure = recordsCircle.edge;
  result = recordsCircle.replaceLocalCircleRecords([
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 0],
  ]);
  assert.equal(result.outcome.builderSucceeded, false);
  assert.ok(beforeRecordsFailure.isDeleted());
  checked();

  mode = undefined;
  const recordsFaulty = vm.runInContext(
    "createSketchConicChild('circle', childFaultKernel)",
    context,
  );
  children.push(recordsFaulty);
  recordsFaulty.rebuild(circleInput());
  const beforeRecordsThrow = recordsFaulty.edge;
  owned.length = 0;
  mode = "throw";
  assert.throws(
    () => recordsFaulty.replaceLocalCircleRecords(circleRecords),
    /Controlled child/,
  );
  assert.ok(beforeRecordsThrow.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  mode = undefined;
  recordsFaulty.rebuild(circleInput());
  const beforeRecordsAbort = recordsFaulty.edge;
  owned.length = 0;
  mode = "abort";
  controller = new AbortController();
  assert.throws(
    () => recordsFaulty.rebuildCircleRecords(circleRecords, controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforeRecordsAbort.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(recordsFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  const placedCircle = create("circle");
  const circleWorldFrame = [
    [0, 0, 1, 10],
    [1, 0, 0, 20],
    [0, 1, 0, 30],
  ];
  const circleWorldRecords = [
    [10, 21, 30],
    [10, 20, 31],
    [10, 19, 30],
    [17, 25, 36],
  ];
  assert.throws(
    () =>
      placedCircle.replacePlacedCircleRecords(
        circleWorldRecords,
        circleWorldFrame,
      ),
    /prepared/,
  );
  assert.throws(
    () => arc.replacePlacedCircleRecords(circleWorldRecords, circleWorldFrame),
    /circle child/,
  );
  placedCircle.rebuild(circleInput());
  const beforePlacedCircle = placedCircle.edge;
  result = placedCircle.replacePlacedCircleRecords(
    circleWorldRecords,
    circleWorldFrame,
  );
  assert.equal(result.preparation.fitSucceeded, undefined);
  assert.deepEqual(plain(result.preparation.frame), frame);
  assert.deepEqual(plain(result.backend.records), [[5, 6, 7]]);
  assert.ok(beforePlacedCircle.isDeleted());
  const placedCircleCurve = new oc.BRepAdaptor_Curve_2(placedCircle.edge);
  const placedCircleGeometry = placedCircleCurve.Circle();
  const placedCircleCenter = placedCircleGeometry.Location();
  try {
    assert.equal(placedCircleCenter.X(), 5);
    assert.equal(placedCircleCenter.Y(), 6);
    assert.equal(placedCircleCenter.Z(), 7);
    assert.ok(Math.abs(placedCircleGeometry.Radius() - 1) < 1e-12);
  } finally {
    placedCircleCenter.delete();
    placedCircleGeometry.delete();
    placedCircleCurve.delete();
  }
  const beforeInvalidPlacedCircle = placedCircle.snapshot();
  assert.throws(() =>
    placedCircle.replacePlacedCircleRecords([], circleWorldFrame),
  );
  assert.throws(() =>
    placedCircle.replacePlacedCircleRecords(circleWorldRecords, []),
  );
  assert.throws(
    () =>
      placedCircle.replacePlacedCircleRecords(
        circleWorldRecords,
        circleWorldFrame,
        stoppedCircle.signal,
      ),
    (e) => e.name === "AbortError",
  );
  assert.deepEqual(placedCircle.snapshot(), beforeInvalidPlacedCircle);
  const beforePlacedCircleRefit = placedCircle.edge;
  result = placedCircle.replacePlacedCircleRecords(
    circleWorldRecords.slice(0, 3),
    circleWorldFrame,
  );
  assert.equal(result.preparation.fitSucceeded, true);
  assert.deepEqual(plain(result.preparation.frame), circleWorldFrame);
  assert.deepEqual(plain(result.backend.records), [[0, 0, 0]]);
  assert.ok(beforePlacedCircleRefit.isDeleted());
  checked();

  mode = undefined;
  const placedCircleFaulty = vm.runInContext(
    "createSketchConicChild('circle', childFaultKernel)",
    context,
  );
  children.push(placedCircleFaulty);
  placedCircleFaulty.rebuild(circleInput());
  const beforePlacedCircleThrow = placedCircleFaulty.edge;
  mode = "throw";
  owned.length = 0;
  assert.throws(
    () =>
      placedCircleFaulty.replacePlacedCircleRecords(
        circleWorldRecords,
        circleWorldFrame,
      ),
    /Controlled child/,
  );
  assert.ok(beforePlacedCircleThrow.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  mode = undefined;
  placedCircleFaulty.rebuild(circleInput());
  const beforePlacedCircleAbort = placedCircleFaulty.edge;
  mode = "abort";
  owned.length = 0;
  controller = new AbortController();
  assert.throws(
    () =>
      placedCircleFaulty.replacePlacedCircleRecords(
        circleWorldRecords.slice(0, 3),
        circleWorldFrame,
        controller.signal,
      ),
    (e) => e.name === "AbortError",
  );
  assert.ok(beforePlacedCircleAbort.isDeleted());
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(placedCircleFaulty.snapshot().disposed, true);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  const freshBackend = (kind, kernel = oc) => {
    context.forkKernel = kernel;
    return vm.runInContext(
      kind === "arc"
        ? "createSketchArcBackend(forkKernel)"
        : "new SketchCircleBackend(forkKernel)",
      context,
    );
  };
  const forkSource = create("arc");
  forkSource.rebuild(arcInput());
  const forkRetainedEdge = forkSource.edge;
  forkSource.rebuild(
    arcInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  assert.equal(forkSource.snapshot().outcome.builderSucceeded, false);
  assert.equal(forkSource.snapshot().validity, "valid");
  const forkedArc = forkSource.fork(() => freshBackend("arc"));
  children.push(forkedArc);
  assert.deepEqual(forkedArc.snapshot(), forkSource.snapshot());
  assert.notEqual(forkedArc.edge, forkRetainedEdge);
  const forkCurve = new oc.BRepAdaptor_Curve_2(forkedArc.edge);
  const forkCircle = forkCurve.Circle();
  try {
    assert.ok(Math.abs(forkCircle.Radius() - 1) < 1e-12);
  } finally {
    forkCircle.delete();
    forkCurve.delete();
  }
  forkedArc.rebuild(arcInput());
  forkedArc.editArcPoint(3, [5, 6, 0]);
  forkedArc.dispose();
  assert.equal(forkSource.edge, forkRetainedEdge);
  assert.equal(forkRetainedEdge.isDeleted(), false);
  checked();

  const blankArc = create("arc");
  const emptyBackendFork = recordsCircle.fork(() => freshBackend("circle"));
  children.push(emptyBackendFork);
  assert.deepEqual(emptyBackendFork.snapshot(), recordsCircle.snapshot());
  assert.equal(emptyBackendFork.edge, undefined);
  const blankFork = blankArc.fork(() => freshBackend("arc"));
  children.push(blankFork);
  assert.deepEqual(blankFork.snapshot(), blankArc.snapshot());
  blankArc.rebuild(
    arcInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  const failedFork = blankArc.fork(() => freshBackend("arc"));
  children.push(failedFork);
  assert.deepEqual(failedFork.snapshot(), blankArc.snapshot());
  assert.equal(failedFork.edge, undefined);
  const circleForkSource = create("circle");
  circleForkSource.rebuild(circleInput());
  circleForkSource.replaceLocalCircleRecords([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [4, 5, 6],
  ]);
  const circleFork = circleForkSource.fork(() => freshBackend("circle"));
  children.push(circleFork);
  assert.deepEqual(circleFork.snapshot(), circleForkSource.snapshot());
  const independentlyOwnedCircle = circleFork.edge;
  circleForkSource.dispose();
  assert.equal(independentlyOwnedCircle.isDeleted(), false);
  checked();

  let forkFactoryCalls = 0;
  assert.throws(
    () =>
      forkSource.fork(() => {
        forkFactoryCalls++;
        return freshBackend("arc");
      }, stoppedCircle.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(forkFactoryCalls, 0);
  assert.throws(
    () =>
      circleForkSource.fork(() => {
        forkFactoryCalls++;
        return freshBackend("circle");
      }),
    /disposed/,
  );
  assert.equal(forkFactoryCalls, 0);
  const failedBackend = freshBackend("arc");
  failedBackend.rebuild = () => false;
  assert.throws(() => forkSource.fork(() => failedBackend), /restore/);
  assert.equal(failedBackend.snapshot().disposed, true);
  assert.equal(forkRetainedEdge.isDeleted(), false);
  checked();

  mode = "throw";
  owned.length = 0;
  let throwingForkBackend;
  assert.throws(
    () =>
      forkSource.fork(
        () =>
          (throwingForkBackend = freshBackend("arc", context.childFaultKernel)),
      ),
    /Controlled child/,
  );
  assert.equal(throwingForkBackend.snapshot().disposed, true);
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  mode = "abort";
  owned.length = 0;
  controller = new AbortController();
  let cancelledForkBackend;
  assert.throws(
    () =>
      forkSource.fork(
        () =>
          (cancelledForkBackend = freshBackend(
            "arc",
            context.childFaultKernel,
          )),
        controller.signal,
      ),
    (e) => e.name === "AbortError",
  );
  assert.equal(cancelledForkBackend.snapshot().disposed, true);
  assert.ok(owned.length > 0 && owned.every((h) => h.isDeleted()));
  assert.equal(forkSource.edge, forkRetainedEdge);
  assert.equal(forkRetainedEdge.isDeleted(), false);
  assert.equal(circle.edge, live);
  assert.equal(live.isDeleted(), false);
  checked();

  const ordered = vm.runInContext(
    "new (loadSketchBackends().SketchChildCollection)('ordered', [[1,0,0,10],[0,1,0,20],[0,0,1,30]])",
    context,
  );
  const orderedArc = create("arc"),
    orderedCircle = create("circle");
  orderedArc.rebuild(arcInput());
  orderedArc.rebuild(
    arcInput([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ]),
  );
  orderedCircle.rebuild(circleInput());
  ordered.splice(0, 0, [
    { id: "arc", child: orderedArc },
    { id: "circle", child: orderedCircle },
  ]);
  const orderedBefore = ordered.snapshot();
  assert.equal(orderedBefore.children[0].state.validity, "valid");
  assert.equal(orderedBefore.children[0].state.outcome.builderSucceeded, false);
  assert.deepEqual(
    plain(orderedBefore.sources.children[0].records.slice(0, 3)),
    [
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ],
  );
  ordered.reorder(["circle", "arc"]);
  assert.deepEqual(
    plain(ordered.snapshot().sources.children.map((c) => c.id)),
    ["circle", "arc"],
  );
  const stagedCollection = ordered.fork((child) =>
    child.fork(() => freshBackend(child.snapshot().kind)),
  );
  assert.deepEqual(stagedCollection.snapshot(), ordered.snapshot());
  const replacementCircle = orderedCircle.fork(() => freshBackend("circle"));
  children.push(replacementCircle);
  replacementCircle.editCircleRadius(4);
  const replacementStage = stagedCollection.stageSplice(0, 1, [
    { id: "circle", child: replacementCircle },
  ]);
  assert.equal(replacementStage.snapshot().children[0].state.backend.radius, 4);
  assert.equal(stagedCollection.snapshot().children[0].state.backend.radius, 1);
  const retired = replacementStage.accept();
  const retiredEdge = retired[0].child.edge;
  assert.equal(retiredEdge.isDeleted(), false);
  retired[0].child.dispose();
  assert.equal(retiredEdge.isDeleted(), true);
  assert.equal(stagedCollection.snapshot().children[0].state.backend.radius, 4);
  assert.equal(ordered.snapshot().children[0].state.backend.radius, 1);
  assert.equal(orderedBefore.children[0].id, "arc");
  stagedCollection.dispose();
  assert.equal(orderedCircle.edge.isDeleted(), false);
  assert.equal(orderedArc.edge.isDeleted(), false);
  checked();

  let partialCollectionEdge;
  assert.throws(
    () =>
      ordered.fork((child, id) => {
        if (id === "arc") throw new Error("Controlled collection copy failure");
        const copied = child.fork(() => freshBackend(child.snapshot().kind));
        partialCollectionEdge = copied.edge;
        return copied;
      }),
    /Controlled collection/,
  );
  assert.ok(partialCollectionEdge.isDeleted());
  assert.equal(orderedCircle.edge.isDeleted(), false);
  assert.equal(orderedArc.edge.isDeleted(), false);
  assert.throws(() => ordered.fork((child) => child), /owned/);

  const cancelledCandidate = orderedCircle.fork(() => freshBackend("circle"));
  children.push(cancelledCandidate);
  const cancelledStageEdge = cancelledCandidate.edge;
  const stageAbort = new AbortController();
  const cancelledStage = ordered.stageSplice(
    0,
    1,
    [{ id: "circle", child: cancelledCandidate }],
    stageAbort.signal,
  );
  stageAbort.abort();
  assert.equal(cancelledStageEdge.isDeleted(), false);
  assert.throws(
    () => cancelledStage.accept(),
    (e) => e.name === "AbortError",
  );
  assert.equal(cancelledStageEdge.isDeleted(), true);
  assert.equal(orderedCircle.edge.isDeleted(), false);
  checked();

  const staleCandidate = orderedArc.fork(() => freshBackend("arc"));
  children.push(staleCandidate);
  const staleStageEdge = staleCandidate.edge;
  const staleStage = ordered.stageSplice(1, 1, [
    { id: "arc", child: staleCandidate },
  ]);
  assert.equal(
    staleStage.snapshot().children[1].state.outcome.builderSucceeded,
    false,
  );
  assert.equal(staleStage.snapshot().children[1].state.validity, "valid");
  ordered.reorder(["arc", "circle"]);
  assert.throws(() => staleStage.accept(), /stale/);
  assert.equal(staleStageEdge.isDeleted(), true);
  assert.equal(orderedArc.edge.isDeleted(), false);
  ordered.reorder(["circle", "arc"]);
  checked();

  const acceptedCandidate = orderedArc.fork(() => freshBackend("arc"));
  children.push(acceptedCandidate);
  const acceptedStageEdge = acceptedCandidate.edge,
    originalStageEdge = orderedArc.edge;
  const acceptedStage = ordered.stageSplice(1, 1, [
    { id: "arc", child: acceptedCandidate },
  ]);
  const acceptedRetired = acceptedStage.accept();
  assert.equal(acceptedRetired[0].child, orderedArc);
  assert.equal(originalStageEdge.isDeleted(), false);
  acceptedRetired[0].child.dispose();
  assert.equal(originalStageEdge.isDeleted(), true);
  assert.equal(acceptedStageEdge.isDeleted(), false);
  assert.equal(
    ordered.snapshot().children[1].state.outcome.builderSucceeded,
    false,
  );
  checked();

  const afterFailedCopy = ordered.snapshot();
  assert.equal(afterFailedCopy.children[0].state.backend.radius, 1);
  const pendingCandidate = orderedCircle.fork(() => freshBackend("circle"));
  children.push(pendingCandidate);
  const pendingStageEdge = pendingCandidate.edge;
  ordered.stageSplice(0, 1, [{ id: "circle", child: pendingCandidate }]);
  ordered.dispose();
  ordered.dispose();
  assert.throws(() => ordered.snapshot(), /disposed/);
  assert.equal(orderedArc.snapshot().disposed, true);
  assert.equal(orderedCircle.snapshot().disposed, true);
  assert.equal(pendingStageEdge.isDeleted(), true);
  assert.equal(acceptedStageEdge.isDeleted(), true);
  checked();

  for (const child of [arc, circle]) {
    const kind = child.snapshot().kind;
    child.rebuild(kind === "arc" ? arcInput() : circleInput());
    const edge = child.edge;
    child.dispose();
    child.dispose();
    assert.ok(edge.isDeleted());
    assert.equal(child.snapshot().preparation, undefined);
    assert.equal(child.snapshot().backend.kind, "empty");
    assert.throws(() => child.edge, /disposed/);
  }
  checked();
  assert.equal(vm.runInContext("shapes.size", context), 0);
  assert.equal(typeof helperSha256, "string");
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Real worker-local conic child ownership and outcomes; public editor/native parity not established",
    }),
  );
} finally {
  for (const child of children) child.dispose();
  clearTimeout(expiry);
}
