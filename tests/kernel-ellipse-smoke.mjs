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
  console.error("Ellipse smoke exceeded 90 seconds");
  process.exit(124);
}, 90000);
const plain = (x) => JSON.parse(JSON.stringify(x));
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const points = [
  [-1, 0, 9],
  [1, 0, 8],
  [0, 3, 7],
];
const owned = [];
let checks = 0;
try {
  const oc = await vm.runInContext("kernel()", context);
  context.ellipseKernel = oc;
  const classes = vm.runInContext("loadSketchBackends()", context);
  const backend = () => new classes.SketchEllipseBackend(oc);
  const sourceBackend = backend();
  const child = new classes.SketchEllipseChild(frame, sourceBackend);
  owned.push(child);
  assert.equal(child.snapshot().preparation, undefined);
  assert.equal(child.rebuildRecords(points).builderSucceeded, true);
  const state = child.snapshot();
  assert.equal(state.preparation.sourceRecords.length, 5);
  assert.deepEqual(plain(state.backend.records), [
    [0, 3, 0],
    [0, -3, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ]);
  const curve = new oc.BRepAdaptor_Curve_2(child.edge);
  const ellipse = curve.Ellipse(),
    location = ellipse.Location(),
    position = ellipse.Position(),
    direction = position.XDirection();
  try {
    assert.equal(
      curve.GetType().value,
      oc.GeomAbs_CurveType.GeomAbs_Ellipse.value,
    );
    assert.equal(ellipse.MajorRadius(), 3);
    assert.equal(ellipse.MinorRadius(), 1);
    assert.deepEqual([location.X(), location.Y(), location.Z()], [0, 0, 0]);
    assert.ok(
      direction.X() === 0 && direction.Y() === -1 && direction.Z() === 0,
    );
    assert.ok(
      Math.abs(curve.FirstParameter()) < 1e-14 &&
        Math.abs(curve.LastParameter() - 2 * Math.PI) < 1e-14,
    );
    for (const [parameter, expected] of [
      [0, [0, -3, 0]],
      [Math.PI / 2, [1, 0, 0]],
    ]) {
      const p = curve.Value(parameter);
      try {
        assert.ok(
          [p.X(), p.Y(), p.Z()].every(
            (n, i) => Math.abs(n - expected[i]) < 1e-12,
          ),
        );
      } finally {
        p.delete();
      }
    }
  } finally {
    direction.delete();
    position.delete();
    location.delete();
    ellipse.delete();
    curve.delete();
  }
  checks++;

  const retained = child.edge;
  assert.equal(child.rebuildRecords([[5, 6, 7]]).builderSucceeded, false);
  assert.equal(child.edge, retained);
  assert.deepEqual(plain(child.snapshot().preparation.sourceRecords), [
    [5, 6, 7],
  ]);
  assert.equal(
    child.rebuildRecords([
      [0, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
    ]).builderSucceeded,
    false,
  );
  assert.deepEqual(plain(child.snapshot().preparation.sourceRecords), []);
  assert.equal(child.edge, retained);
  assert.equal(retained.isDeleted(), false);
  const copied = child.fork(backend);
  owned.push(copied);
  assert.deepEqual(copied.snapshot(), child.snapshot());
  assert.notEqual(copied.edge, retained);
  checks++;

  const collection = new classes.SketchChildCollection("ellipse-owner", frame);
  owned.push(collection);
  collection.splice(0, 0, [{ id: "ellipse", child: copied }]);
  const candidate = child.fork(backend);
  owned.push(candidate);
  candidate.rebuildRecords([
    [-2, 0, 0],
    [2, 0, 0],
    [0, 1, 0],
  ]);
  const stage = collection.stageSplice(0, 1, [
    { id: "ellipse", child: candidate },
  ]);
  assert.equal(stage.snapshot().sources.children[0].records.length, 5);
  assert.equal(collection.snapshot().sources.children[0].records.length, 0);
  const retired = stage.accept();
  retired[0].child.dispose();
  assert.equal(retained.isDeleted(), false);
  collection.dispose();
  assert.equal(candidate.snapshot().disposed, true);
  checks++;

  const abort = new AbortController();
  abort.abort();
  assert.throws(
    () => child.rebuildRecords(points, abort.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(child.edge, retained);
  assert.throws(() => child.rebuildRecords([[NaN, 0, 0]]));
  assert.equal(child.edge, retained);
  assert.throws(() => child.fork(() => sourceBackend), /independent/);
  assert.equal(retained.isDeleted(), false);
  checks++;

  const handles = [];
  let fault;
  const names = new Set([
    "gp_Pnt_3",
    "gp_Dir_4",
    "gp_Ax2_2",
    "gp_Elips_2",
    "GC_MakeEllipse_1",
    "Handle_Geom_Curve_2",
    "BRepBuilderAPI_MakeEdge_24",
  ]);
  const faultKernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (!names.has(key)) return value;
      return function (...args) {
        const h = new value(...args);
        handles.push(h);
        if (key === "GC_MakeEllipse_1") {
          const getValue = h.Value.bind(h);
          h.Value = () => {
            if (fault === "value")
              throw new Error("Controlled ellipse value failure");
            const result = getValue();
            handles.push(result);
            return result;
          };
        }
        if (key === "BRepBuilderAPI_MakeEdge_24" && fault === "edge")
          h.IsDone = () => false;
        return h;
      };
    },
  });
  const faultBackend = new classes.SketchEllipseBackend(faultKernel);
  owned.push(faultBackend);
  const request = {
    kind: "ellipse",
    center: [1, 2, 3],
    axis: [1, 0, 0],
    majorRadius: 4,
    minorRadius: 2,
  };
  for (const mode of ["value", "edge"]) {
    fault = undefined;
    handles.length = 0;
    assert.equal(faultBackend.rebuild(request), true);
    assert.ok(handles.every((h) => h.isDeleted()));
    const old = faultBackend.edge;
    fault = mode;
    handles.length = 0;
    if (mode === "value")
      assert.throws(() => faultBackend.rebuild(request), /Controlled ellipse/);
    else assert.equal(faultBackend.rebuild(request), false);
    assert.ok(old.isDeleted());
    assert.ok(handles.length > 0 && handles.every((h) => h.isDeleted()));
    assert.equal(faultBackend.snapshot().kind, "empty");
    checks++;
  }
  fault = undefined;
  faultBackend.rebuild(request);
  const valid = faultBackend.edge;
  assert.throws(() =>
    faultBackend.rebuild({ ...request, majorRadius: Infinity }),
  );
  assert.equal(faultBackend.edge, valid);
  assert.throws(() => faultBackend.rebuild({ ...request, majorRadius: -1 }));
  assert.ok(valid.isDeleted());
  assert.equal(faultBackend.snapshot().kind, "empty");
  checks++;
  const failingChild = new classes.SketchEllipseChild(frame, faultBackend);
  owned.push(failingChild);
  assert.equal(failingChild.rebuildRecords(points).builderSucceeded, true);
  const failingOldEdge = failingChild.edge;
  fault = "value";
  assert.throws(
    () => failingChild.rebuildRecords(points),
    /Controlled ellipse/,
  );
  assert.equal(failingOldEdge.isDeleted(), true);
  const emptyCopy = failingChild.fork(backend);
  owned.push(emptyCopy);
  assert.equal(emptyCopy.snapshot().backend.kind, "empty");
  assert.equal(emptyCopy.edge, undefined);
  assert.equal(emptyCopy.snapshot().preparation.fitSucceeded, true);
  assert.match(emptyCopy.snapshot().outcome.error, /Controlled ellipse/);
  checks++;

  const midAbort = new AbortController();
  const abortBackend = backend();
  let abortedEdge;
  const abortChild = new classes.SketchEllipseChild(frame, {
    snapshot: () => abortBackend.snapshot(),
    get edge() {
      return abortBackend.edge;
    },
    dispose: () => abortBackend.dispose(),
    rebuild(request) {
      const result = abortBackend.rebuild(request);
      abortedEdge = abortBackend.edge;
      midAbort.abort();
      return result;
    },
  });
  owned.push(abortChild);
  assert.throws(
    () => abortChild.rebuildRecords(points, midAbort.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(abortChild.snapshot().disposed, true);
  assert.equal(abortedEdge.isDeleted(), true);
  assert.equal(retained.isDeleted(), false);
  checks++;

  const editor = new classes.SketchEllipseChild(frame, backend());
  owned.push(editor);
  editor.rebuildRecords(points);
  const beforeNoop = editor.edge;
  const noMovement = editor.editPoint(4, [0, 0, 2 ** -23]);
  assert.equal(noMovement.builderSucceeded, false);
  assert.equal(noMovement.backendAttempted, false);
  assert.equal(editor.edge, beforeNoop);
  const tooSmall = editor.editPoint(1, [0.00001, 0, 0]);
  assert.equal(tooSmall.backendAttempted, false);
  assert.equal(editor.edge, beforeNoop);
  checks++;

  assert.equal(editor.editPoint(4, [5, 6, 7]).builderSucceeded, true);
  assert.equal(beforeNoop.isDeleted(), true);
  assert.deepEqual(
    plain(editor.snapshot().preparation.geometry.center),
    [5, 6, 7],
  );
  const translatedCurve = new oc.BRepAdaptor_Curve_2(editor.edge);
  const translatedEllipse = translatedCurve.Ellipse();
  const translatedCenter = translatedEllipse.Location();
  try {
    assert.deepEqual(
      [translatedCenter.X(), translatedCenter.Y(), translatedCenter.Z()],
      [5, 6, 7],
    );
  } finally {
    translatedCenter.delete();
    translatedEllipse.delete();
    translatedCurve.delete();
  }
  checks++;

  editor.rebuildRecords(points);
  assert.equal(editor.editPoint(2, [0, 3, 4]).builderSucceeded, true);
  assert.deepEqual(
    plain(editor.snapshot().preparation.geometry.axis),
    [0.6, 0, -0.8],
  );
  assert.deepEqual(
    plain(editor.snapshot().preparation.sourceRecords[2]),
    [0, 3, -4],
  );
  const spatialCurve = new oc.BRepAdaptor_Curve_2(editor.edge);
  const spatialEllipse = spatialCurve.Ellipse();
  try {
    assert.equal(spatialEllipse.MajorRadius(), 5);
    assert.equal(spatialEllipse.MinorRadius(), 1);
  } finally {
    spatialEllipse.delete();
    spatialCurve.delete();
  }
  checks++;

  const replacementFrame = [
    [0, -1, 0, 5],
    [1, 0, 0, 6],
    [0, 0, 1, 7],
  ];
  assert.equal(
    editor.replacePlacedRecords(
      [
        [5, 4, 100],
        [5, 8, 200],
        [4, 6, 300],
      ],
      replacementFrame,
    ).builderSucceeded,
    true,
  );
  assert.deepEqual(plain(editor.snapshot().frame), replacementFrame);
  assert.equal(editor.snapshot().preparation.geometry.radius1, 2);
  assert.equal(editor.snapshot().preparation.geometry.radius2, 1);
  const placedEdge = editor.edge;
  editor.replacePlacedRecords([[11, 22, 33]], frame);
  assert.deepEqual(plain(editor.snapshot().preparation.sourceRecords), [
    [1, 2, 3],
  ]);
  assert.deepEqual(plain(editor.snapshot().frame), replacementFrame);
  assert.equal(editor.edge, placedEdge);
  assert.throws(() => editor.editPoint(4, [5, 6, 7]), /selected source/);
  assert.equal(editor.edge, placedEdge);
  const placedCopy = editor.fork(backend);
  owned.push(placedCopy);
  assert.deepEqual(placedCopy.snapshot(), editor.snapshot());
  placedCopy.dispose();
  assert.equal(placedEdge.isDeleted(), false);
  checks++;

  const pointAbort = new AbortController();
  pointAbort.abort();
  assert.throws(
    () => editor.replacePlacedRecords(points, frame, pointAbort.signal),
    (e) => e.name === "AbortError",
  );
  assert.throws(
    () => editor.editPoint(0, [1, 2, 3], pointAbort.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(editor.edge, placedEdge);
  editor.rebuildRecords(points);
  const editStageOwner = new classes.SketchChildCollection(
    "edited-ellipse",
    frame,
  );
  owned.push(editStageOwner);
  editStageOwner.splice(0, 0, [{ id: "ellipse", child: editor }]);
  const editCandidate = editor.fork(backend);
  owned.push(editCandidate);
  editCandidate.editPoint(1, [4, 0, 0]);
  const editStage = editStageOwner.stageSplice(0, 1, [
    { id: "ellipse", child: editCandidate },
  ]);
  assert.equal(
    editStage.snapshot().children[0].state.preparation.geometry.radius1,
    4,
  );
  assert.equal(
    editStageOwner.snapshot().children[0].state.preparation.geometry.radius1,
    1,
  );
  const editCandidateEdge = editCandidate.edge;
  editStage.discard();
  assert.equal(editCandidateEdge.isDeleted(), true);
  assert.equal(editor.edge.isDeleted(), false);
  checks++;

  child.dispose();
  child.dispose();
  assert.ok(retained.isDeleted());
  assert.throws(() => child.rebuildRecords(points), /disposed/);
  assert.equal(vm.runInContext("shapes.size", context), 0);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Real bundled kernel ellipse geometry, separate records, failed-fit retention, staged ownership and fault cleanup; no native executable or public GUI/MCP acceptance",
    }),
  );
} finally {
  for (const object of owned.reverse()) object.dispose();
  clearTimeout(expiry);
}
