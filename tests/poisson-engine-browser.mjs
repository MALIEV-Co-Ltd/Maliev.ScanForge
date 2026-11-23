import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const positions = [],
  normals = [];
for (let i = 0; i < 1200; i++) {
  const z = 1 - (2 * (i + 0.5)) / 1200,
    a = i * Math.PI * (3 - Math.sqrt(5)),
    r = Math.sqrt(1 - z * z);
  const n = [r * Math.cos(a), r * Math.sin(a), z];
  normals.push(...n);
  positions.push(...n.map((v) => v * 10));
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5192");
  const result = await page.evaluate(
    async ({ positions, normals }) =>
      await new Promise((resolve, reject) => {
        const worker = new Worker("/tests/poisson-engine-browser-worker.ts", {
          type: "module",
        });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(Error("Poisson browser worker timeout"));
        }, 60000);
        worker.onerror = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(Error(e.message));
        };
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(e.data);
        };
        worker.postMessage({
          positions: new Float32Array(positions),
          normals: new Float32Array(normals),
        });
      }),
    { positions, normals },
  );
  assert.equal(result.ok, true, result.error);
  assert.ok(result.diagnostics.triangles > 7000);
  const receipt = {
    passed: true,
    execution:
      "Actual browser module worker through exported reconstructPoisson, no mocked WASM",
    ...result,
  };
  fs.writeFileSync(
    "docs/evidence/cloudcompare-20261029/poisson/browser-engine-smoke.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify({ ...receipt, positions: undefined }));
} finally {
  await browser.close();
}
