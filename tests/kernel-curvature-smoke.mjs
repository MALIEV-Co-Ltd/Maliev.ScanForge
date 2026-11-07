import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { webcrypto, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply.ts";
import { noiseNormals } from "../src/scan-native-noise.ts";

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
  Float32Array,
  Float64Array,
  Uint32Array,
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

const expiry = setTimeout(() => process.exit(124), 90000);
try {
  const reference = JSON.parse(
    readFileSync(
      new URL("tests/fixtures/curvature-grid-open-kernel.json", root),
      "utf8",
    ),
  );
  const c = 0.3366671042986859,
    s = 0.9416237363634893;
  const matrix = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0.2566666702429453];
  const before = vm.runInContext("shapes.size", context);
  const result = await request("curvatureSurface", {
    patch: reference.patch,
    matrix,
  });
  assert.equal(result.vertices.length / 3, 1529);
  assert.equal(result.triangles.length / 3, 2984);
  assert.equal(result.uvs.length, result.vertices.length);
  assert.equal(vm.runInContext("shapes.size", context), before + 1);
  const points = await request("curvatureEvaluate", {
    kernelId: result.kernelId,
    uvs: new Float64Array([0.5, 0.5, 0, -0.1, 1.1, 0]),
  });
  assert(points instanceof Float32Array);
  assert.equal(points.length, 6);
  assert([...points].every(Number.isFinite));
  await assert.rejects(request("surface", reference.patch), /control counts/);
  await assert.rejects(
    request("curvatureSurface", { patch: reference.patch, matrix: [NaN] }),
    /frame|placement/,
  );
  await assert.rejects(
    request("curvatureEvaluate", {
      kernelId: result.kernelId,
      uvs: new Float64Array([NaN, 0, 0]),
    }),
    /finite|UV/,
  );
  assert.equal(vm.runInContext("shapes.size", context), before + 1);
  await request("release", [result.kernelId]);
  await assert.rejects(
    request("curvatureEvaluate", {
      kernelId: result.kernelId,
      uvs: new Float64Array([0, 0, 0]),
    }),
    /expired/,
  );
  assert.equal(vm.runInContext("shapes.size", context), before);

  const code = await build({
    stdin: {
      contents: `export {runScanEditAsync} from "./src/scan-edit"; export {nativeStlTopology} from "./src/scan-native-stl-topology"; export {analyzeIndexedMesh} from "./src/mesh-processing";`,
      resolveDir: fileURLToPath(root),
      sourcefile: "curvature-test.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const { runScanEditAsync, nativeStlTopology, analyzeIndexedMesh } =
    await import(
      "data:text/javascript;base64," +
        Buffer.from(code.outputFiles[0].text).toString("base64")
    );
  const workers = [];
  const originalWorker = globalThis.Worker,
    originalSelf = globalThis.self;
  globalThis.self = {
    location: { href: new URL("assets/processing-worker.js", root).href },
  };
  globalThis.Worker = class {
    constructor() {
      workers.push(this);
      this.terminated = false;
    }
    postMessage(message) {
      request(message.operation, message.payload).then(
        (result) => {
          if (!this.terminated)
            this.onmessage?.({ data: { id: message.id, result } });
        },
        (error) => {
          if (!this.terminated)
            this.onmessage?.({
              data: { id: message.id, error: error.message },
            });
        },
      );
    }
    terminate() {
      this.terminated = true;
    }
  };
  try {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "tests/fixtures/hole-fill-observed-curvature-annulus.json",
          root,
        ),
        "utf8",
      ),
    );
    const positions = Float32Array.from(
        fixture.source.faces.flatMap((face) =>
          face.flatMap((id) => fixture.source.vertices[id]),
        ),
      ),
      unchanged = positions.slice();
    const indexed = nativeStlTopology(positions),
      topology = analyzeIndexedMesh(
        Float64Array.from(indexed.vertices),
        indexed.triangles,
      );
    const inner = topology.boundaryLoops.findIndex((loop) =>
      loop.every(
        (id) =>
          Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
          2.01,
      ),
    );
    const cache = { positions, tolerance: 1e-6, topology };
    const edited = await runScanEditAsync(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions,
        indices: [inner],
        algorithm: "curvature",
      },
      { topologyCache: cache },
    );
    assert.deepEqual(positions, unchanged);
    assert.equal(edited.positions.length / 9, fixture.nativeFacets);
    assert.equal(edited.diagnostics.filledHoles, 1);
    assert.equal(cache.positions, edited.positions);
    assert.equal(cache.topology.vertices.length / 3, 884);
    const actual = cache.topology,
      map = new Map(),
      distances = [];
    for (let id = 0; id < actual.vertices.length / 3; id++) {
      let closest = -1,
        distance = Infinity;
      for (let j = 0; j < fixture.native.vertices.length; j++) {
        const squared = fixture.native.vertices[j].reduce(
          (sum, value, axis) =>
            sum + (value - actual.vertices[id * 3 + axis]) ** 2,
          0,
        );
        if (squared < distance) {
          distance = squared;
          closest = j;
        }
      }
      map.set(id, closest);
      distances.push(Math.sqrt(distance));
    }
    const oriented = (ids) =>
      [0, 1, 2]
        .map((i) => [...ids.slice(i), ...ids.slice(0, i)].join(","))
        .sort()[0];
    const expectedFaces = new Set(fixture.native.faces.map(oriented));
    const actualFaces = new Set(
      Array.from({ length: actual.triangles.length / 3 }, (_, i) =>
        oriented(
          Array.from(actual.triangles.slice(i * 3, i * 3 + 3)).map((id) =>
            map.get(id),
          ),
        ),
      ),
    );
    const maxDistance = Math.max(...distances),
      missing = [...expectedFaces].filter(
        (face) => !actualFaces.has(face),
      ).length,
      extra = [...actualFaces].filter(
        (face) => !expectedFaces.has(face),
      ).length;
    assert.equal(new Set(map.values()).size, 884);
    assert.equal(missing, 0);
    assert.equal(extra, 0);
    assert.equal(maxDistance, 0);
    assert.equal(workers.length, 1);
    assert(workers[0].terminated);
    assert.equal(vm.runInContext("shapes.size", context), before);
    console.log(
      JSON.stringify({
        scope:
          "Shared async scan edit with actual pinned CAD protocol; VM transport, not browser/MCP",
        facets: 1702,
        vertices: 884,
        maxDistance,
        missing,
        extra,
        ownedWorkerTerminated: true,
        remainingHandles: before,
      }),
    );
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
  console.log(
    JSON.stringify({
      scope: "Actual pinned CAD worker protocol; not GUI/public MCP",
      checks: 11,
      vertices: 1529,
      facets: 2984,
      remainingHandles: before,
    }),
  );
} finally {
  clearTimeout(expiry);
}
