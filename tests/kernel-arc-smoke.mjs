import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { prepareNativeSketchArcRebuild } from "../src/sketch-arc-rebuild.ts";

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
  console.error("Arc smoke exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
const plain = (value) => JSON.parse(JSON.stringify(value));
const frame = [
  [1, 0, 0, 100],
  [0, 1, 0, 200],
  [0, 0, 1, 300],
];
const prior = { radius: 0, closed: false, sourceRecords: [] };
const points = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const request = (p = points, center = [0, 0, 0]) => ({
  kind: "arc",
  points: p,
  center,
});
let backend,
  checks = 0;
const checked = () => {
  checks++;
};
try {
  const oc = await vm.runInContext("kernel()", context);
  context.arcTestKernel = oc;
  backend = vm.runInContext("createSketchArcBackend(arcTestKernel)", context);
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: false,
    kind: "empty",
    records: [],
  });
  checked();

  function measure(expectedStart, expectedMiddle, expectedEnd, expectedRadius) {
    const edge = backend.edge;
    assert.ok(edge && !edge.IsNull());
    assert.equal(edge.ShapeType().value, oc.TopAbs_ShapeEnum.TopAbs_EDGE.value);
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const circle = curve.Circle();
    try {
      assert.equal(
        curve.GetType().value,
        oc.GeomAbs_CurveType.GeomAbs_Circle.value,
      );
      assert.ok(Math.abs(circle.Radius() - expectedRadius) < 1e-12);
      const first = curve.FirstParameter(),
        last = curve.LastParameter();
      assert.ok(last > first && last - first < 2 * Math.PI);
      for (const [t, expected] of [
        [first, expectedStart],
        [(first + last) / 2, expectedMiddle],
        [last, expectedEnd],
      ]) {
        const p = curve.Value(t);
        try {
          [p.X(), p.Y(), p.Z()].forEach((value, i) =>
            assert.ok(
              Math.abs(value - expected[i]) < 1e-12,
              `${value} != ${expected[i]}`,
            ),
          );
        } finally {
          p.delete();
        }
      }
    } finally {
      circle.delete();
      curve.delete();
    }
  }

  const prepared = prepareNativeSketchArcRebuild(points, frame, prior, false);
  assert.equal(backend.rebuild(prepared.backendRequest), true);
  measure(...points, 1);
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: false,
    kind: "arc",
    records: points,
  });
  assert.equal(prepared.sourceRecords.length, 4);
  checked();

  const clockwise = [
    [1, 0, 0],
    [0, -1, 0],
    [-1, 0, 0],
  ];
  assert.equal(backend.rebuild(request(clockwise)), true);
  measure(...clockwise, 1);
  checked();
  assert.equal(
    backend.rebuild(
      request([
        [2, 0, 0],
        [-2, 0, 0],
        [0, 2, 0],
      ]),
    ),
    true,
  );
  measure([2, 0, 0], [-Math.SQRT2, -Math.SQRT2, 0], [0, 2, 0], 2);
  checked();

  // Native gate is scale-dependent: AB is normalized twice; AC is not normalized.
  // The last fixture crosses the admission boundary if the second normalization
  // is removed (single-pass gap is 2^-23; double-pass gap is just smaller).
  for (const [p, accepted] of [
    [
      [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
      ],
      false,
    ],
    [
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
      false,
    ],
    [
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 0],
      ],
      true,
    ],
    [
      [
        [0, 0, 0],
        [1, 0, 0],
        [1 + 2 ** -24, 1, 0],
      ],
      false,
    ],
    [
      [
        [0, 0, 0],
        [1, 0, 0],
        [1 + 2 ** -23, 1, 0],
      ],
      true,
    ],
    [
      [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 1, 0],
      ],
      false,
    ],
    [
      [
        [0, 0, 0],
        [1, 1, 0],
        [0, 1.414213393785701, 0],
      ],
      false,
    ],
  ]) {
    assert.equal(backend.rebuild(request()), true);
    const old = backend.edge;
    assert.equal(backend.rebuild(request(p)), accepted);
    assert.ok(old.isDeleted());
    assert.equal(backend.snapshot().kind, accepted ? "arc" : "empty");
    checked();
  }

  for (const p of [
    [
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ],
    [
      [1, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ]) {
    assert.equal(backend.rebuild(request()), true);
    const old = backend.edge;
    assert.equal(backend.rebuild(request(p)), false);
    assert.ok(old.isDeleted());
    assert.deepEqual(plain(backend.snapshot()), {
      disposed: false,
      kind: "empty",
      records: [],
    });
    checked();
  }
  assert.equal(backend.rebuild(request()), true);
  const closed = prepareNativeSketchArcRebuild(points, frame, prior, true);
  const old = backend.edge;
  assert.equal(closed.fitSucceeded, true);
  assert.equal(backend.rebuild(closed.backendRequest), false);
  assert.ok(old.isDeleted());
  assert.deepEqual(closed.sourceRecords[0], [1, 0, 0]);
  assert.equal(backend.snapshot().kind, "empty");
  checked();

  const detached = request(
    points.map((p) => [...p]),
    [99, 99, 99],
  );
  assert.equal(backend.rebuild(detached), true);
  measure(...points, 1); // Supplied center does not replace the recomputed fit.
  detached.points[0][0] = 77;
  const snap = backend.snapshot();
  snap.records[1][0] = 88;
  assert.deepEqual(plain(backend.snapshot().records), points);
  checked();
  const valid = backend.edge;
  for (const bad of [
    undefined,
    {},
    request([[NaN, 0, 0], points[1], points[2]]),
    request(points, [0, Infinity, 0]),
    { ...request(), points: points.slice(0, 2) },
  ])
    assert.throws(() => backend.rebuild(bad), /finite|three|request/i);
  assert.equal(backend.edge, valid);
  assert.equal(valid.isDeleted(), false);
  checked();

  assert.throws(
    () =>
      backend.rebuild(
        request([
          [1e308, 0, 0],
          [0, 1e308, 0],
          [-1e308, 0, 0],
        ]),
      ),
    /overflow/,
  );
  assert.ok(valid.isDeleted());
  assert.equal(backend.snapshot().kind, "empty");
  checked();

  let fault;
  const allocated = [];
  const constructors = new Set([
    "gp_Pnt_3",
    "GC_MakeArcOfCircle_4",
    "Handle_Geom_Curve_2",
    "BRepBuilderAPI_MakeEdge_24",
  ]);
  context.arcFaultKernel = new Proxy(oc, {
    get(target, key) {
      const value = target[key];
      if (!constructors.has(key)) return value;
      return function (...args) {
        const h = new value(...args);
        allocated.push(h);
        if (key === "GC_MakeArcOfCircle_4") {
          const get = h.Value.bind(h);
          h.Value = () => {
            if (fault === "value")
              throw new Error("Controlled arc Value failure");
            const v = get();
            allocated.push(v);
            return v;
          };
        }
        if (key === "BRepBuilderAPI_MakeEdge_24" && fault === "edge")
          h.IsDone = () => false;
        return h;
      };
    },
  });
  const failing = vm.runInContext(
    "createSketchArcBackend(arcFaultKernel)",
    context,
  );
  try {
    for (const mode of ["value", "edge"]) {
      fault = undefined;
      allocated.length = 0;
      assert.equal(failing.rebuild(request()), true);
      assert.ok(allocated.every((h) => h.isDeleted()));
      const old = failing.edge;
      allocated.length = 0;
      fault = mode;
      if (mode === "value")
        assert.throws(() => failing.rebuild(request()), /Controlled arc/);
      else assert.equal(failing.rebuild(request()), false);
      assert.ok(old.isDeleted());
      assert.ok(allocated.length > 0 && allocated.every((h) => h.isDeleted()));
      assert.equal(failing.snapshot().kind, "empty");
      checked();
    }
  } finally {
    failing.dispose();
  }

  for (let i = 0; i < 32; i++) {
    const old = backend.edge,
      r = i + 1,
      x = 2 * i,
      y = -i;
    const p = [
      [x + r, y, 0],
      [x, y + r, 0],
      [x - r, y, 0],
    ];
    assert.equal(backend.rebuild(request(p)), true);
    if (old) assert.ok(old.isDeleted());
    measure(...p, r);
  }
  checked();
  const finalEdge = backend.edge;
  backend.dispose();
  backend.dispose();
  assert.ok(finalEdge.isDeleted());
  assert.deepEqual(plain(backend.snapshot()), {
    disposed: true,
    kind: "empty",
    records: [],
  });
  assert.throws(() => backend.rebuild(request()), /disposed/);
  assert.throws(() => backend.edge, /disposed/);
  checked();
  assert.equal(vm.runInContext("shapes.size", context), 0);
  assert.equal(typeof helperSha256, "string");
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      replacementCycles: 32,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Real bundled-kernel arcs and ownership; native numerical parity remains unverified",
    }),
  );
} finally {
  backend?.dispose();
  clearTimeout(expiry);
}
