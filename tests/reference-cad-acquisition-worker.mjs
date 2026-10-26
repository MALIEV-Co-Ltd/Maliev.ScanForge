// Real bundled-kernel acquisition protocol. Run only after resource admission.
// No direct guessed OCCT vertex/curve binding names: only worker protocol outcomes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const pending = new Map();
let nextId = 0;
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
  setTimeout,
  clearTimeout,
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) return;
      const p = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.error) p.reject(Error(reply.error));
      else p.resolve(structuredClone(reply.result));
    },
  },
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
  { filename: "cad-worker.js" },
);
const request = (operation, payload) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    context.self.onmessage({ data: { id, operation, payload } });
  });
const watchdog = setTimeout(() => {
  console.error(
    "Private numeric CAD acquisition kernel check exceeded90seconds",
  );
  process.exit(124);
}, 90000);
const owned = new Set();
const results = [];
const plain = (value) => JSON.parse(JSON.stringify(value));
async function body(input) {
  const result = await request("primitive", input);
  owned.add(result.kernelId);
  return result;
}
async function transformed(source) {
  const result = await request("transform", {
    kernelId: source.kernelId,
    translation: [10, 20, 30],
    rotation: [0, 0, 0],
    scale: 1,
  });
  owned.add(result.kernelId);
  return result;
}
const features = (body, family, offset = 0, limit = 100) =>
  request("referenceFeatures", {
    kernelId: body.kernelId,
    family,
    offset,
    limit,
  });
const coordinate = (body, selection) =>
  request("referenceCoordinate", { kernelId: body.kernelId, selection });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceBrep = async (body) => {
  context.sourceId = body.kernelId;
  return vm.runInContext(
    "serializeBrep(awaitedKernel, shapes.get(sourceId))",
    context,
  );
};
const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  context.awaitedKernel = await vm.runInContext("kernel()", context);
  const box = await body({ kind: "box", center: [0, 0, 0], size: [2, 4, 6] });
  await check(
    "box exposes8unique topological vertices with stable paging",
    async () => {
      const first = await features(box, "vertices", 0, 3),
        second = await features(box, "vertices", 3, 100),
        again = await features(box, "vertices", 0, 3);
      assert.equal(first.total, 8);
      assert.equal(first.nextOffset, 3);
      assert.deepEqual(plain(first), plain(again));
      assert.equal(first.rows.length + second.rows.length, 8);
      const coordinates = [...first.rows, ...second.rows].map((row) =>
        row.position.join(","),
      );
      assert.equal(new Set(coordinates).size, 8);
      assert.deepEqual(
        [...first.rows, ...second.rows].map((row) => row.index),
        [0, 1, 2, 3, 4, 5, 6, 7],
      );
    },
  );
  await check("box exposes12stable unique edge indices", async () => {
    const list = await features(box, "edges");
    assert.equal(list.total, 12);
    assert.deepEqual(
      list.rows.map((row) => row.index),
      Array.from({ length: 12 }, (_, i) => i),
    );
    assert.ok(
      list.rows.every(
        (row) =>
          row.eligible &&
          !row.degenerate &&
          Number.isFinite(row.firstParameter) &&
          Number.isFinite(row.lastParameter),
      ),
    );
    assert.deepEqual(plain(await features(box, "edges")), plain(list));
  });
  await check(
    "finite edge endpoints and fractional parameter agree on box edge geometry",
    async () => {
      const a = await coordinate(box, {
          kind: "edge-endpoint",
          edgeIndex: 0,
          endpoint: "start",
        }),
        b = await coordinate(box, {
          kind: "edge-endpoint",
          edgeIndex: 0,
          endpoint: "end",
        });
      const middle = await coordinate(box, {
        kind: "edge-fraction",
        edgeIndex: 0,
        fraction: 0.5,
      });
      for (let i = 0; i < 3; i++)
        near(middle.position[i], (a.position[i] + b.position[i]) * 0.5);
      assert.deepEqual(
        plain(
          (
            await coordinate(box, {
              kind: "edge-fraction",
              edgeIndex: 0,
              fraction: 0,
            })
          ).position,
        ),
        plain(a.position),
      );
      assert.deepEqual(
        plain(
          (
            await coordinate(box, {
              kind: "edge-fraction",
              edgeIndex: 0,
              fraction: 1,
            })
          ).position,
        ),
        plain(b.position),
      );
      const cylinder = await body({
        kind: "cylinder",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 3,
        height: 4,
      });
      let verifiedCircle = false;
      for (const row of (await features(cylinder, "edges")).rows.filter(
        (row) => row.eligible,
      )) {
        const start = (
          await coordinate(cylinder, {
            kind: "edge-endpoint",
            edgeIndex: row.index,
            endpoint: "start",
          })
        ).position;
        const end = (
          await coordinate(cylinder, {
            kind: "edge-endpoint",
            edgeIndex: row.index,
            endpoint: "end",
          })
        ).position;
        const mid = (
          await coordinate(cylinder, {
            kind: "edge-fraction",
            edgeIndex: row.index,
            fraction: 0.5,
          })
        ).position;
        if (
          Math.hypot(...start.map((x, i) => x - end[i])) < 1e-7 &&
          Math.hypot(...start.map((x, i) => x - mid[i])) > 5.9
        ) {
          const quarter = (
            await coordinate(cylinder, {
              kind: "edge-fraction",
              edgeIndex: row.index,
              fraction: 0.25,
            })
          ).position;
          near(Math.hypot(quarter[0], quarter[1]), 3, 1e-7);
          near(
            Math.hypot(...start.map((x, i) => x - quarter[i])),
            Math.sqrt(18),
            1e-7,
          );
          verifiedCircle = true;
          break;
        }
      }
      assert.ok(
        verifiedCircle,
        "cylinder must expose an exact closed circular edge",
      );
    },
  );
  await check(
    "exact CAD vertex query preserves large-origin Double detail absent from Float32 display",
    async () => {
      const precise = await body({
        kind: "box",
        center: [100000000.125, 0, 0],
        size: [0.125, 2, 2],
      });
      const list = await features(precise, "vertices");
      assert.deepEqual(
        [...new Set(list.rows.map((row) => row.position[0]))].sort(
          (a, b) => a - b,
        ),
        [100000000.0625, 100000000.1875],
      );
      const row = list.rows[0],
        p = await coordinate(precise, {
          kind: "vertex",
          vertexIndex: row.index,
        });
      assert.deepEqual(plain(p.position), plain(row.position));
      assert.notEqual(Math.fround(p.position[0]), p.position[0]);
    },
  );
  await check(
    "placed CAD vertex location is applied exactly once",
    async () => {
      const moved = await transformed(box),
        list = await features(moved, "vertices");
      const lower = [0, 1, 2].map((i) =>
          Math.min(...list.rows.map((row) => row.position[i])),
        ),
        upper = [0, 1, 2].map((i) =>
          Math.max(...list.rows.map((row) => row.position[i])),
        );
      assert.deepEqual(lower, [9, 18, 27]);
      assert.deepEqual(upper, [11, 22, 33]);
    },
  );
  await check(
    "face inventory shares canonical converter triangle traversal without remeshing",
    async () => {
      const before = hash(await sourceBrep(box)),
        list = await features(box, "faces"),
        mesh = await request("alignmentMesh", {
          kernelId: box.kernelId,
          includeUVs: false,
        });
      let first = 0;
      for (const row of list.rows) {
        assert.equal(row.firstTriangle, first);
        assert.ok(row.triangleCount > 0);
        first += row.triangleCount;
      }
      assert.equal(first, mesh.triangles.length / 3);
      assert.equal(hash(await sourceBrep(box)), before);
    },
  );
  await check(
    "reflected face conversion keeps face mapping and winding aligned with canonical normals",
    async () => {
      const mirror = await request("mirror", {
        kernelId: box.kernelId,
        planeOrigin: [0, 0, 0],
        normal: [1, 0, 0],
      });
      owned.add(mirror.kernelId);
      const list = await features(mirror, "faces"),
        mesh = await request("alignmentMesh", {
          kernelId: mirror.kernelId,
          includeUVs: false,
        });
      assert.equal(
        list.rows.reduce((s, row) => s + row.triangleCount, 0),
        mesh.triangles.length / 3,
      );
      for (let k = 0; k < mesh.triangles.length; k += 3) {
        const ids = [
            mesh.triangles[k],
            mesh.triangles[k + 1],
            mesh.triangles[k + 2],
          ],
          p = ids.map((id) =>
            Array.from(mesh.vertices.slice(id * 3, id * 3 + 3)),
          ),
          u = p[1].map((v, i) => v - p[0][i]),
          v = p[2].map((n, i) => n - p[0][i]),
          n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ],
          normal = Array.from(mesh.normals.slice(ids[0] * 3, ids[0] * 3 + 3));
        assert.ok(n.reduce((s, x, i) => s + x * normal[i], 0) >= -1e-6);
      }
    },
  );
  await check(
    "invalid and degenerate feature queries fail without losing source availability",
    async () => {
      await assert.rejects(
        coordinate(box, { kind: "vertex", vertexIndex: 99999 }),
        /index|range|vertex/i,
      );
      await assert.rejects(
        coordinate(box, { kind: "edge-fraction", edgeIndex: 0, fraction: 1.1 }),
        /fraction|parameter|range/i,
      );
      const sphere = await body({
          kind: "sphere",
          center: [0, 0, 0],
          radius: 3,
        }),
        edges = await features(sphere, "edges"),
        degenerate = edges.rows.find((row) => row.degenerate);
      assert.ok(degenerate, "sphere pole degenerate edge must remain indexed");
      await assert.rejects(
        coordinate(sphere, {
          kind: "edge-endpoint",
          edgeIndex: degenerate.index,
          endpoint: "start",
        }),
        /degenerate|unavailable/i,
      );
      assert.equal((await features(box, "vertices")).total, 8);
    },
  );
  await check(
    "repeated query owns no registered CAD bodies and leaves BREP unchanged",
    async () => {
      const count = vm.runInContext("shapes.size", context),
        before = hash(await sourceBrep(box));
      for (let i = 0; i < 8; i++) {
        await features(box, "vertices");
        await features(box, "edges");
        await coordinate(box, { kind: "vertex", vertexIndex: 0 });
      }
      assert.equal(vm.runInContext("shapes.size", context), count);
      assert.equal(hash(await sourceBrep(box)), before);
    },
  );
  await check(
    "acquisition conversion admits a small cold source and rejects oversized cached metadata before copying",
    async () => {
      context.referenceBoundId = box.kernelId;
      vm.runInContext("dropAlignmentMesh(referenceBoundId)", context);
      const small = await request("alignmentMesh", {
        kernelId: box.kernelId,
        includeUVs: false,
        referenceAcquisition: true,
      });
      assert.ok(small.triangles.length > 0);
      const before = hash(await sourceBrep(box));
      // Metadata fault injection exercises admission without allocating a huge
      // geometry or claiming this is original-native/runtime performance proof.
      vm.runInContext(
        "globalThis.savedReferenceCache = alignmentMeshes.get(referenceBoundId)",
        context,
      );
      try {
        for (const [nodes, triangles] of [
          [3, 2000001],
          [6000001, 1],
        ]) {
          context.referenceNodeCount = nodes;
          context.referenceTriangleCount = triangles;
          vm.runInContext(
            "alignmentMeshes.set(referenceBoundId, {bytes: 0, mesh: {vertices: {length: referenceNodeCount * 3}, triangles: {length: referenceTriangleCount * 3}}})",
            context,
          );
          await assert.rejects(
            request("alignmentMesh", {
              kernelId: box.kernelId,
              includeUVs: false,
              referenceAcquisition: true,
            }),
            /conversion exceeds.*nodes.*triangles/i,
          );
        }
      } finally {
        vm.runInContext(
          "if (savedReferenceCache) alignmentMeshes.set(referenceBoundId, savedReferenceCache); else alignmentMeshes.delete(referenceBoundId); delete globalThis.savedReferenceCache",
          context,
        );
      }
      assert.equal(hash(await sourceBrep(box)), before);
      assert.deepEqual(
        plain(
          (
            await request("alignmentMesh", {
              kernelId: box.kernelId,
              includeUVs: false,
            })
          ).triangles,
        ),
        plain(small.triangles),
      );
    },
  );
  await check("released kernel IDs cannot resolve stale topology", async () => {
    const disposable = await body({
      kind: "box",
      center: [0, 0, 0],
      size: [1, 1, 1],
    });
    await request("release", [disposable.kernelId]);
    owned.delete(disposable.kernelId);
    await assert.rejects(
      features(disposable, "vertices"),
      /handle|unavailable|shape/i,
    );
  });
  assert.equal(results.length, 11);
  console.log(
    JSON.stringify({
      scope:
        "application real bundled OCCT query protocol; not original-native viewport parity",
      checks: results,
    }),
  );
} finally {
  try {
    if (owned.size) await request("release", [...owned]);
  } finally {
    clearTimeout(watchdog);
  }
}
