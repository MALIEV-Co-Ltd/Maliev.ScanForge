import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { prepareNativeSketchCircleRebuild } from "../src/sketch-circle-rebuild.ts";

// Real bundled OpenCascade, with no server, browser or native executable calls.
// Run under resource admission and an owned finite process lease.
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
  setTimeout,
  clearTimeout,
  self: { location: { href: new URL("public/cad-worker.js", root).href } },
});
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context);
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
);
const expiry = setTimeout(() => {
  console.error("Circle backend smoke exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
const frame = [
  [1, 0, 0, 100],
  [0, 1, 0, 200],
  [0, 0, 1, 300],
];
let backend;
let checks = 0;
const checked = () => {
  checks++;
};
const plain = (value) => JSON.parse(JSON.stringify(value));
try {
  const oc = await vm.runInContext("kernel()", context);
  context.circleTestKernel = oc;
  backend = vm.runInContext(
    "new SketchCircleBackend(circleTestKernel)",
    context,
  );
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: false,
    kind: "empty",
    records: [],
  });
  checked();

  const measure = (center, radius) => {
    const edge = backend.edge;
    assert.ok(edge && !edge.IsNull());
    assert.equal(edge.ShapeType().value, oc.TopAbs_ShapeEnum.TopAbs_EDGE.value);
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const circle = curve.Circle();
    const location = circle.Location();
    const axis = circle.Position();
    const z = axis.Direction(),
      x = axis.XDirection();
    try {
      assert.equal(
        curve.GetType().value,
        oc.GeomAbs_CurveType.GeomAbs_Circle.value,
      );
      assert.deepEqual([location.X(), location.Y(), location.Z()], center);
      assert.equal(circle.Radius(), radius);
      assert.deepEqual([z.X(), z.Y(), z.Z()], [0, 0, 1]);
      // The kernel recomputes an orthogonal basis and may produce signed zero.
      assert.ok(x.X() === 1 && x.Y() === 0 && x.Z() === 0);
      assert.ok(Math.abs(curve.FirstParameter()) < 1e-14);
      assert.ok(Math.abs(curve.LastParameter() - 2 * Math.PI) < 1e-14);
      for (const [parameter, expected] of [
        [0, [center[0] + radius, center[1], center[2]]],
        [Math.PI / 2, [center[0], center[1] + radius, center[2]]],
      ]) {
        const point = curve.Value(parameter);
        try {
          assert.ok(Math.abs(point.X() - expected[0]) < 1e-12);
          assert.ok(Math.abs(point.Y() - expected[1]) < 1e-12);
          assert.ok(Math.abs(point.Z() - expected[2]) < 1e-12);
        } finally {
          point.delete();
        }
      }
    } finally {
      x.delete();
      z.delete();
      axis.delete();
      location.delete();
      circle.delete();
      curve.delete();
    }
  };

  const prepared = prepareNativeSketchCircleRebuild(
    [
      [4, 5, 17],
      [3, 6, -8],
      [2, 5, 9],
    ],
    frame,
  );
  assert.equal(backend.rebuild(prepared.backendRequest), true);
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: false,
    kind: "circle",
    records: [[3, 5, 0]],
    radius: 1,
  });
  let fault;
  const allocated = [];
  const constructors = new Set([
    "gp_Pnt_3",
    "gp_Dir_4",
    "gp_Ax2_2",
    "gp_Circ_2",
    "GC_MakeCircle_1",
    "Handle_Geom_Curve_2",
    "BRepBuilderAPI_MakeEdge_24",
  ]);
  const faultKernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (!constructors.has(key)) return value;
      return function (...args) {
        const handle = new value(...args);
        allocated.push(handle);
        if (key === "GC_MakeCircle_1") {
          const getValue = handle.Value.bind(handle);
          handle.Value = () => {
            if (fault === "value")
              throw new Error("Controlled kernel value failure");
            const result = getValue();
            allocated.push(result);
            return result;
          };
        }
        if (fault === "edge" && key === "BRepBuilderAPI_MakeEdge_24")
          handle.IsDone = () => false;
        return handle;
      };
    },
  });
  context.circleTestFaultKernel = faultKernel;
  const faultBackend = vm.runInContext(
    "new SketchCircleBackend(circleTestFaultKernel)",
    context,
  );
  try {
    for (const mode of ["value", "edge"]) {
      fault = undefined;
      assert.equal(faultBackend.rebuild(prepared.backendRequest), true);
      assert.ok(
        allocated.every((handle) => handle.isDeleted()),
        "successful construction releases constructor and returned-handle temporaries",
      );
      const old = faultBackend.edge;
      allocated.length = 0;
      fault = mode;
      if (mode === "value")
        assert.throws(
          () => faultBackend.rebuild(prepared.backendRequest),
          /Controlled kernel value failure/,
        );
      else assert.equal(faultBackend.rebuild(prepared.backendRequest), false);
      assert.ok(old.isDeleted(), "rebuild failure retires the old edge");
      assert.ok(
        allocated.length > 0 && allocated.every((handle) => handle.isDeleted()),
        "partial construction releases actual kernel temporaries",
      );
      assert.deepEqual(plain(faultBackend.snapshot()), {
        disposed: false,
        kind: "empty",
        records: [],
      });
      checked();
    }
  } finally {
    faultBackend.dispose();
  }

  assert.equal(
    prepared.sourceRecords.length,
    4,
    "child records remain separate from backend center-only records",
  );
  measure([3, 5, 0], 1);
  checked();

  const previous = backend.edge;
  const failed = prepareNativeSketchCircleRebuild(
    [
      [0, 0, 0],
      [2, 0, 0],
      [7, 0, 0],
    ],
    frame,
  );
  assert.equal(failed.fitSucceeded, false);
  assert.equal(backend.rebuild(failed.backendRequest), false);
  assert.ok(
    previous.isDeleted(),
    "fit failure must retire the prior backend edge",
  );
  assert.equal(backend.edge, undefined);
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: false,
    kind: "empty",
    records: [],
  });
  assert.deepEqual(failed.sourceRecords[3], [2, 0, 0]);
  checked();

  for (const radius of [0, -1, -Number.MAX_VALUE, 2 ** -23 - 2 ** -76]) {
    assert.equal(
      backend.rebuild({ kind: "circle", center: [0, 0, 0], radius }),
      false,
    );
    assert.equal(backend.snapshot().kind, "empty");
    checked();
  }
  assert.equal(
    backend.rebuild({ kind: "circle", center: [0, 0, 0], radius: 2 ** -23 }),
    true,
    "backend admits equality independently of fitting",
  );
  measure([0, 0, 0], 2 ** -23);
  checked();

  const input = { kind: "circle", center: [1, 2, 3], radius: 4 };
  assert.equal(backend.rebuild(input), true);
  const snap = backend.snapshot();
  input.center[0] = 999;
  snap.records[0][1] = 999;
  assert.deepEqual(plain(backend.snapshot().records), [[1, 2, 3]]);
  measure([1, 2, 3], 4);
  checked();

  const beforeInvalid = backend.edge;
  for (const invalid of [
    null,
    { kind: "arc", center: [0, 0, 0], radius: 1 },
    { kind: "circle", center: [NaN, 0, 0], radius: 1 },
    { kind: "circle", center: [0, 0], radius: 1 },
    { kind: "circle", center: [0, 0, 0], radius: Infinity },
  ]) {
    assert.throws(() => backend.rebuild(invalid), /circle|finite/i);
    assert.equal(
      backend.edge,
      beforeInvalid,
      "malformed application requests validate before mutation",
    );
    assert.ok(!beforeInvalid.isDeleted());
    checked();
  }

  for (let index = 0; index < 32; index++) {
    const old = backend.edge;
    assert.equal(
      backend.rebuild({
        kind: "circle",
        center: [index, -index, 0],
        radius: index + 1,
      }),
      true,
    );
    assert.ok(old?.isDeleted() ?? true);
    measure([index, -index, 0], index + 1);
  }
  checked();
  const last = backend.edge;
  backend.dispose();
  backend.dispose();
  assert.ok(last.isDeleted());
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: true,
    kind: "empty",
    records: [],
  });
  assert.throws(() => backend.rebuild(prepared.backendRequest), /disposed/i);
  assert.throws(() => backend.edge, /disposed/i);
  checked();

  assert.equal(
    vm.runInContext("shapes.size", context),
    0,
    "internal curve backend does not publish scene CAD shapes",
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      replacementCycles: 32,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Real bundled kernel circle edge, local basis, threshold, replacement and disposal; no native-program numerical comparison",
    }),
  );
} finally {
  backend?.dispose();
  clearTimeout(expiry);
}
