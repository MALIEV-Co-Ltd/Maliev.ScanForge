import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";

// Exercise the real compiled worker and unmodified public assets under a nested deployment.
const root = resolve("dist"),
  prefix = "/scanforge/";
const output = resolve(
  "docs/evidence/cloudcompare-20261029/poisson/production-browser.json",
);
const workerName = (await readdir(resolve(root, "assets"))).find((name) =>
  /^processing-worker-.*\.js$/.test(name),
);
assert(workerName, "Build the application before the production-worker test");
const requested = [];
const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  const pathname = new URL(request.url, "http://localhost").pathname;
  requested.push(pathname);
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404).end();
    return;
  }
  const file = resolve(root, pathname.slice(prefix.length) || "index.html");
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    response.setHeader(
      "Content-Type",
      file.endsWith(".wasm")
        ? "application/wasm"
        : /\.m?js$/.test(file)
          ? "application/javascript"
          : file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".json")
              ? "application/json"
              : "application/octet-stream",
    );
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const receipt = {
  passed: false,
  compiledWorker: workerName,
  prefix,
  requested,
};
try {
  const page = await browser.newPage();
  await page.goto(origin + prefix);
  const result = await page.evaluate(
    async ({ prefix, workerName }) => {
      const positions = [],
        normals = [];
      for (let i = 0; i < 1200; i++) {
        const z = 1 - (2 * (i + 0.5)) / 1200,
          r = Math.sqrt(1 - z * z),
          a = i * Math.PI * (3 - Math.sqrt(5)),
          n = [r * Math.cos(a), r * Math.sin(a), z];
        positions.push(...n.map((v) => v * 10));
        normals.push(...n);
      }
      return await new Promise((done, reject) => {
        const worker = new Worker(`${prefix}assets/${workerName}`, {
          type: "module",
        });
        const deadline = setTimeout(() => {
          worker.terminate();
          reject(Error("Production Poisson worker deadline"));
        }, 60000);
        worker.onerror = (error) => {
          clearTimeout(deadline);
          worker.terminate();
          reject(Error(error.message));
        };
        worker.onmessage = ({ data }) => {
          if (!data.result && !data.error) return;
          clearTimeout(deadline);
          worker.terminate();
          if (data.error) {
            done({ error: data.error });
            return;
          }
          let squared = 0;
          const points = data.result.indexedMesh.vertices;
          for (let i = 0; i < points.length; i += 3)
            squared +=
              (Math.hypot(points[i], points[i + 1], points[i + 2]) - 10) ** 2;
          done({
            diagnostics: data.result.diagnostics,
            radialRms: Math.sqrt(squared / (points.length / 3)),
          });
        };
        worker.postMessage({
          kind: "pointCloudPoisson",
          positions: Float32Array.from(positions),
          normals: Float32Array.from(normals),
          normalMode: "provided",
          depth: 8,
        });
      });
    },
    { prefix, workerName },
  );
  Object.assign(receipt, result);
  assert(!result.error, result.error);
  assert(result.radialRms < 0.02);
  assert.equal(result.diagnostics.triangles, 7976);
  assert(requested.includes(`${prefix}poisson/poisson.mjs`));
  assert(requested.includes(`${prefix}poisson/poisson.wasm`));
  receipt.passed = true;
} catch (error) {
  receipt.failure = error.message;
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
}
