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
const settings = {
  linearResolution: 1e-8,
  coordinateDeltaZeroThreshold: 1e-18,
  endpointTolerance: 1e-8,
  coordinateEnvelope: 1000,
  relativeComparisonTolerance: 1.6e-14,
};
const compare = (actual, expected) =>
  assert.ok(
    actual.every((x, a) => Object.is(x, expected[a])),
    JSON.stringify({ actual, expected }),
  );
try {
  const oc = await vm.runInContext("kernel()", context),
    classes = vm.runInContext("loadSketchBackends()", context);
  const curve = new classes.SketchLineCurve(oc);
  owners.push(curve);
  const inspect = (candidate, prepared) => {
    const temporaries = [],
      keep = (x) => (temporaries.push(x), x);
    try {
      const edges = keep(
        new oc.TopExp_Explorer_2(
          candidate.wire,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      assert.equal(edges.More(), true);
      const rawEdge = keep(edges.Current()),
        edge = keep(oc.TopoDS.Edge_1(rawEdge));
      edges.Next();
      assert.equal(edges.More(), false);
      assert.equal(edge.IsSame(candidate.firstEdge), true);
      assert.equal(
        edge.Orientation_1().value,
        oc.TopAbs_Orientation.TopAbs_FORWARD.value,
      );
      assert.equal(edge.Closed_1(), false);
      assert.equal(candidate.wire.Closed_1(), false);
      const explorer = keep(
        new oc.TopExp_Explorer_2(
          edge,
          oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      const vertices = [];
      while (explorer.More()) {
        const raw = keep(explorer.Current()),
          vertex = keep(oc.TopoDS.Vertex_1(raw));
        vertices.push(vertex);
        explorer.Next();
      }
      assert.equal(vertices.length, 2);
      assert.equal(vertices[0].IsSame(vertices[1]), false);
      assert.deepEqual(
        vertices.map((v) => v.Orientation_1().value),
        [
          oc.TopAbs_Orientation.TopAbs_FORWARD.value,
          oc.TopAbs_Orientation.TopAbs_REVERSED.value,
        ],
      );
      for (let a = 0; a < 2; a++) {
        const point = keep(oc.BRep_Tool.Pnt(vertices[a]));
        compare(
          [point.X(), point.Y(), point.Z()],
          a === 0 ? prepared.start : prepared.end,
        );
        assert.equal(oc.BRep_Tool.Tolerance_3(vertices[a]), 1e-7);
      }
      const adaptor = keep(new oc.BRepAdaptor_Curve_2(edge));
      assert.equal(adaptor.FirstParameter(), prepared.conversion.interval[0]);
      assert.equal(adaptor.LastParameter(), prepared.conversion.interval[1]);
      const checker = keep(new oc.BRepCheck_Analyzer(candidate.wire, true));
      assert.equal(checker.IsValid_2(), true);
      assert.equal(candidate.snapshot().requestedTolerance, 5e-9);
    } finally {
      for (const h of temporaries.reverse()) h.delete();
    }
  };
  const fixtures = [
    [
      [0, 0, 0],
      [5, 0, 0],
    ],
    [
      [0, 0, 0],
      [5e-5, 0, 0],
    ],
    [
      [0, 0, 0],
      [2e-5, 0, 0],
    ],
    [
      [3, 2, 1],
      [-5, -4, -3],
    ],
    [
      [-0, -0, 0],
      [0.05, -0, 0],
    ],
    [
      [-44.81225521303713, -48.52493875660002, -10.334359342232347],
      [-85.58758161962032, 34.50572811998427, -66.68801661580801],
    ],
  ];
  for (const points of fixtures) {
    assert.equal(curve.rebuildCurve({ kind: "line", points }), true);
    const prepared = curve.prepareBodyEndpoints(0.001),
      attempt = curve.prepareBodyCandidate(0.001, settings);
    assert.equal(attempt.status, "candidate");
    try {
      inspect(attempt.candidate, prepared);
      checks++;
    } finally {
      attempt.candidate.dispose();
    }
  }
  for (let i = 0; i < 100; i++) {
    assert.equal(
      curve.rebuildCurve({
        kind: "line",
        points: fixtures[i % fixtures.length],
      }),
      true,
    );
    const prepared = curve.prepareBodyEndpoints(0.001),
      attempt = curve.prepareBodyCandidate(0.001, settings);
    assert.equal(attempt.status, "candidate");
    try {
      inspect(attempt.candidate, prepared);
    } finally {
      attempt.candidate.dispose();
    }
  }
  checks++;
  assert.equal(
    curve.rebuildCurve({
      kind: "line",
      points: [
        [0, 0, 0],
        [1e-6, 0, 0],
      ],
    }),
    true,
  );
  const rejected = curve.prepareBodyCandidate(0.001, settings);
  assert.equal(rejected.status, "geometry-rejected");
  assert.equal(rejected.candidate, undefined);
  assert.equal(curve.snapshot().hasCurve, true);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      fixtureCount: fixtures.length,
      retirementCycles: 100,
      helperSha256,
      wasmSha256: createHash("sha256").update(binary).digest("hex"),
      scope:
        "Shared candidate open-edge topology, exact prepared vertices, distinct identities, orientation and resource cycles; selected static native branches, not full original-native body admission or GUI/MCP acceptance.",
    }),
  );
} finally {
  for (const owner of owners) owner.dispose();
  clearTimeout(expiry);
}
