import fs from "node:fs";
import { Session } from "node:inspector";
import { createServer } from "vite";
import { performance } from "node:perf_hooks";
const count = Number(process.env.PROFILE_POINTS ?? 10000);
const name = process.env.PROFILE_NAME ?? "baseline";
const instrument = process.env.PROFILE_COUNTERS === "1";
globalThis.queryCounters = {
  nodes: 0,
  leaves: 0,
  evaluations: 0,
  duplicates: 0,
};
globalThis.pointTriangles = new Set();
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: instrument
    ? [
        {
          name: "query-profile-counters",
          enforce: "pre",
          transform(code, id) {
            if (!id.endsWith("/scan-noise-octree-query.ts")) return;
            return code
              .replace(
                "const visit = (node: NoiseQueryNode) => {",
                "const visit = (node: NoiseQueryNode) => { globalThis.queryCounters.nodes++;",
              )
              .replace(
                "for (const triangle of node.triangles) {",
                "for (const triangle of node.triangles) { globalThis.queryCounters.leaves++;",
              )
              .replace(
                "const distance = evaluate(triangle, best);",
                "globalThis.queryCounters.evaluations++; if(globalThis.pointTriangles.has(triangle)) globalThis.queryCounters.duplicates++; globalThis.pointTriangles.add(triangle); const distance = evaluate(triangle, best);",
              );
          },
        },
      ]
    : [],
});
try {
  const { parsePackedBinaryPly } = await server.ssrLoadModule(
    "/src/ply-binary-topology.ts",
  );
  const { prepareNativeAlignmentSurface } = await server.ssrLoadModule(
    "/src/scan-native-alignment-surface.ts",
  );
  const load = (name) => {
    const b = fs.readFileSync(`C:/repo/alignment-example-files/${name}`);
    return parsePackedBinaryPly(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    );
  };
  const source = load("ply-2.ply"),
    target = load("ply-1.ply");
  let now = performance.now();
  const prepared = prepareNativeAlignmentSurface(
    target.vertices,
    target.triangles,
  );
  const preparationMs = performance.now() - now;
  const points = Array.from({ length: count }, (_, i) => {
    const id = Math.floor((i * (source.vertices.length / 3)) / count);
    return Array.from(source.vertices.subarray(id * 3, id * 3 + 3));
  });
  for (let i = 0; i < Math.min(count, 1000); i++)
    prepared.query(points[i], Infinity);
  globalThis.queryCounters = {
    nodes: 0,
    leaves: 0,
    evaluations: 0,
    duplicates: 0,
  };
  const session = new Session();
  session.connect();
  const call = (method, args = {}) =>
    new Promise((resolve, reject) =>
      session.post(method, args, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
    );
  await call("Profiler.enable");
  await call("Profiler.start");
  now = performance.now();
  let squared = 0;
  const hits = [];
  for (const point of points) {
    globalThis.pointTriangles.clear();
    const hit = prepared.query(point, Infinity);
    squared += hit.distance ** 2;
    hits.push(hit);
  }
  const queryMs = performance.now() - now;
  const { profile } = await call("Profiler.stop");
  session.disconnect();
  fs.writeFileSync(
    `.resources/alignment-query-${name}.cpuprofile`,
    JSON.stringify(profile),
  );
  fs.writeFileSync(
    `.resources/alignment-query-${name}-hits.json`,
    JSON.stringify(hits),
  );
  const top = profile.nodes
    .map((n) => ({
      function: n.callFrame.functionName,
      url: n.callFrame.url,
      hits: n.hitCount ?? 0,
    }))
    .filter((n) => n.hits)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 18);
  const report = {
    name,
    count,
    instrument,
    preparationMs,
    queryMs,
    queriesPerSecond: (count * 1000) / queryMs,
    rms: Math.sqrt(squared / count),
    counters: globalThis.queryCounters,
    top,
  };
  fs.writeFileSync(
    `.resources/alignment-query-${name}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
