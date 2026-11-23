import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import createPoisson from "../public/poisson/poisson.mjs";

const out = new URL(
  "../docs/evidence/cloudcompare-20261029/poisson/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
const bytes = await readFile(
  new URL(
    "../docs/evidence/cloudcompare-20261028/fixtures/sphere-normals.ply",
    import.meta.url,
  ),
);
const records = bytes
  .toString()
  .split(/end_header\r?\n/)[1]
  .trim()
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/).map(Number));
const warnings = [],
  module = await createPoisson({
    print: () => {},
    printErr: (text) => warnings.push(text),
  });
const positions = Float32Array.from(records.flatMap((r) => r.slice(0, 3))),
  normals = Float32Array.from(records.flatMap((r) => r.slice(3, 6)));
const p = module._malloc(positions.byteLength),
  n = module._malloc(normals.byteLength);
assert(p && n);
module.HEAPF32.set(positions, p / 4);
module.HEAPF32.set(normals, n / 4);
const started = performance.now();
try {
  const result = module._sf_poisson_reconstruct(
    p,
    n,
    records.length,
    8,
    2,
    1.5,
  );
  assert(result, module.UTF8ToString(module._sf_poisson_error()));
  const vertices = module.HEAPF32.slice(
    module._sf_poisson_vertices() / 4,
    module._sf_poisson_vertices() / 4 + module._sf_poisson_vertex_count() * 3,
  );
  const triangles = module.HEAPU32.slice(
    module._sf_poisson_triangles() / 4,
    module._sf_poisson_triangles() / 4 +
      module._sf_poisson_triangle_count() * 3,
  );
  const density = module.HEAPF32.slice(
    module._sf_poisson_density() / 4,
    module._sf_poisson_density() / 4 + module._sf_poisson_vertex_count(),
  );
  assert(vertices.every(Number.isFinite));
  assert(density.every(Number.isFinite));
  assert(triangles.every((i) => i < vertices.length / 3));
  const radial = [];
  for (let i = 0; i < vertices.length; i += 3)
    radial.push(Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]) - 10);
  const report = {
    passed: true,
    execution:
      "Actual compiled upstream WASM in Node; browser/worker integration separate",
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    wasmSha256: createHash("sha256")
      .update(
        await readFile(
          new URL("../public/poisson/poisson.wasm", import.meta.url),
        ),
      )
      .digest("hex"),
    inputPoints: records.length,
    vertices: vertices.length / 3,
    triangles: triangles.length / 3,
    elapsedMs: performance.now() - started,
    heapBytes: module.HEAPF32.buffer.byteLength,
    vertexRadialRmsMm: Math.sqrt(
      radial.reduce((s, v) => s + v * v, 0) / radial.length,
    ),
    maxVertexRadialErrorMm: Math.max(...radial.map(Math.abs)),
    densityRange: [Math.min(...density), Math.max(...density)],
    warnings,
  };
  assert(report.vertexRadialRmsMm < 0.1);
  assert(report.vertices > 1000);
  assert(report.triangles > 1000);
  await writeFile(
    new URL("wasm-sphere-mesh.json", out),
    JSON.stringify({
      vertices: Array.from(vertices),
      triangles: Array.from(triangles),
      density: Array.from(density),
    }) + "\n",
  );
  await writeFile(
    new URL("wasm-sphere-smoke.json", out),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  module._free(p);
  module._free(n);
  module._sf_poisson_clear();
}
