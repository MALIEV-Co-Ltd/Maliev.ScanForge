import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Exercise the actual classic-worker protocol without a server or detached worker.
// Run only after resource admission: WASM initialization requires substantial RAM.
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const requests = new Map();
let id = 0;
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
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) {
        requests.get(reply.id)?.onProgress?.(reply.progress);
        return;
      }
      const pending = requests.get(reply.id);
      requests.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error));
      else pending.resolve(reply.result);
    },
  },
});
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context, {
    filename: "opencascade.js",
  });
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8").replace(
    "error instanceof Error ? error.message",
    "error instanceof Error ? error.stack",
  ),
  context,
  { filename: "cad-worker.js" },
);
function request(operation, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    requests.set(requestId, { resolve, reject, onProgress });
    context.self.onmessage({ data: { id: requestId, operation, payload } });
  });
}
const expiry = setTimeout(() => {
  console.error("CAD smoke exceeded 90 seconds.");
  process.exit(1);
}, 90_000);
function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-6,
    `${message}: ${actual} versus ${expected}`,
  );
}
try {
  const oc = await vm.runInContext("kernel()", context);
  const circle = [
    {
      kind: "arc",
      start: [2, 0],
      end: [-2, 0],
      center: [0, 0],
      clockwise: false,
    },
    {
      kind: "arc",
      start: [-2, 0],
      end: [2, 0],
      center: [0, 0],
      clockwise: false,
    },
  ];
  const created = [];
  const measure = (result, expected, label) => {
    const shape = vm.runInContext(`shapes.get("${result.kernelId}")`, context);
    const props = new oc.GProp_GProps_1(),
      checker = new oc.BRepCheck_Analyzer(shape, true);
    try {
      assert(checker.IsValid_2(), label + " validity");
      oc.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
      close(props.Mass(), expected, label + " outward-oriented volume");
    } finally {
      props.delete();
      checker.delete();
    }
  };
  for (const clockwise of [false, true]) {
    const result = await request("extrudeCurves", {
      edges: circle.map((e) => ({ ...e, clockwise })),
      height: 3,
    });
    created.push(result.kernelId);
    measure(result, Math.PI * 12, "analytic cylinder");
    const shape = vm.runInContext(`shapes.get("${result.kernelId}")`, context);
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let cylinders = 0,
      planes = 0;
    try {
      while (explorer.More()) {
        const raw = explorer.Current(),
          face = oc.TopoDS.Face_1(raw),
          surface = new oc.BRepAdaptor_Surface_2(face, true);
        try {
          const kind = surface.GetType();
          if (kind === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) cylinders++;
          if (kind === oc.GeomAbs_SurfaceType.GeomAbs_Plane) planes++;
        } finally {
          surface.delete();
          face.delete();
          raw.delete();
        }
        explorer.Next();
      }
    } finally {
      explorer.delete();
    }
    assert.equal(cylinders, 2, "two exact semicylindrical faces");
    assert.equal(planes, 2);
  }
  const d = [{ kind: "line", start: [-2, 0], end: [2, 0] }, circle[0]];
  const framed = await request("extrudeCurves", {
    edges: d,
    height: 5,
    frame: {
      origin: [10, 20, 30],
      u: [0, 1, 0],
      v: [0, 0, 1],
      normal: [1, 0, 0],
    },
  });
  created.push(framed.kernelId);
  measure(framed, Math.PI * 10, "placed half cylinder");
  const major = await request("extrudeCurves", {
    edges: [
      {
        kind: "arc",
        start: [2, 0],
        end: [0, -2],
        center: [0, 0],
        clockwise: false,
      },
      { kind: "line", start: [0, -2], end: [0, 0] },
      { kind: "line", start: [0, 0], end: [2, 0] },
    ],
    height: 3,
  });
  created.push(major.kernelId);
  measure(major, Math.PI * 9, "major arc sector");
  const step = await request("export", created);
  const imported = await request("import", { data: step, extension: "step" });
  created.push(imported.kernelId);
  measure(imported, Math.PI * 43, "STEP roundtrip");
  const lines = (points) =>
    points.map((start, i) => ({
      kind: "line",
      start,
      end: points[(i + 1) % points.length],
    }));
  let invalidIndex = 0;
  for (const edges of [
    [circle[0]],
    [circle[0], { ...circle[1], start: [-3, 0] }],
    [{ ...circle[0], center: [1, 0] }, circle[1]],
    lines([
      [0, 0],
      [4, 3],
      [0, 3],
      [3, 0],
    ]),
    [{ kind: "line", start: [0, 0], end: [0, 0] }, ...d],
    [circle[0], { ...circle[1], clockwise: true }],
  ])
    await assert.rejects(
      request("extrudeCurves", { edges, height: 3 }),
      "invalid profile " + invalidIndex++,
    );
  for (const height of [0, -1, Infinity, 1e10])
    await assert.rejects(request("extrudeCurves", { edges: circle, height }));
  for (const kernelId of created) await request("release", [kernelId]);
  assert.equal(
    vm.runInContext("shapes.size", context),
    0,
    "all CAD handles released",
  );
  console.log("Analytic sketch extrusion kernel checks passed.");
} finally {
  clearTimeout(expiry);
}
