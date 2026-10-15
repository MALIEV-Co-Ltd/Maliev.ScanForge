import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(directory, "Set SCANFORGE_ALIGNMENT_EXAMPLES to the owner scan folder.");
if (freemem() < 3072 * 1048576)
  throw Error(
    "Owner worker replay requires 3072 MiB free; do not lower admission.",
  );
const origin = "http://127.0.0.1:5173",
  out = new URL("../.resources/global-query-worker-browser/", import.meta.url);
await mkdir(out, { recursive: true });
const oraclePath = new URL(
  "./fixtures/global-fine-correspondence-owner-native.json",
  import.meta.url,
);
const oracle = JSON.parse(await readFile(oraclePath, "utf8")),
  prefix = "/" + randomUUID() + "/";
const ledger = {
  owner: "global-query-native-worker-parity",
  pid: process.pid,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  expiry: new Date(Date.now() + 360_000).toISOString(),
  persistentData: false,
  resources: [],
};
function processIdentity(pid) {
  if (process.platform !== "win32")
    return { pid, observation: "Owned process handle" };
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-Process -Id ${pid} | Select-Object Id,@{Name='actualStartUtc';Expression={$_.StartTime.ToUniversalTime().ToString('O')}},Path | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    ),
  );
}
ledger.identity = processIdentity(process.pid);
const report = {
  browserRoute:
    "Browser plugin not available; isolated Playwright profile, no access to the user browser tab.",
  checks: [],
  passed: false,
};
const save = () =>
  writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
let browserServer, browser, lease;
const files = new Map(
  oracle.sources.map((source) => [
    prefix + source.name,
    directory + "/" + source.name,
  ]),
);
const server = createServer((request, response) => {
  if (request.headers.origin !== origin) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  const path = files.get(request.url);
  if (!path) {
    response.writeHead(404).end();
    return;
  }
  const stream = createReadStream(path);
  response.on("close", () => stream.destroy());
  stream.on("error", () => response.destroy());
  stream.pipe(response);
});
try {
  const deadline = new Promise((_, reject) => {
    lease = setTimeout(
      () => reject(Error("Owner worker replay exceeded six-minute lease.")),
      360_000,
    );
  });
  await Promise.race([
    (async () => {
      for (const source of oracle.sources) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(
          directory + "/" + source.name,
        ))
          hash.update(chunk);
        assert.equal(hash.digest("hex"), source.fileSha256);
      }
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      ledger.resources.push({
        kind: "source-http",
        pid: process.pid,
        port,
        binding: "127.0.0.1",
        persistentData: false,
      });
      await save();
      browserServer = await chromium.launchServer({
        channel: "chrome",
        args: ["--js-flags=--max-old-space-size=1792"],
      });
      ledger.resources.push({
        kind: "browser",
        pid: browserServer.process().pid,
        executable: browserServer.process().spawnfile,
        startedAt: new Date().toISOString(),
        identity: processIdentity(browserServer.process().pid),
        persistentData: false,
      });
      await save();
      browser = await chromium.connect(browserServer.wsEndpoint());
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const Original = window.Worker;
        window.__globalQueryWorkers = [];
        window.Worker = class extends Original {
          constructor(url, options) {
            super(url, options);
            this.record = String(url).includes("scan-global-query-worker")
              ? { initialized: 0, terminated: false }
              : undefined;
            if (this.record) window.__globalQueryWorkers.push(this.record);
          }
          postMessage(value, ...rest) {
            if (this.record && value.initialize) this.record.initialized++;
            return super.postMessage(value, ...rest);
          }
          terminate() {
            if (this.record) this.record.terminated = true;
            return super.terminate();
          }
        };
      });
      await page.goto(origin);
      assert.equal(new URL(page.url()).port, "5173");
      assert(await page.title());
      assert(await page.locator("#root").innerText());
      const result = await page.evaluate(
        async ({ oracle, base }) => {
          const { parsePlyTopology } = await import("/src/ply-topology.ts");
          const { createGlobalQueryPool } =
            await import("/src/scan-global-query-pool.ts");
          const scans = [];
          for (let i = 0; i < oracle.sources.length; i++) {
            const source = oracle.sources[i],
              response = await fetch(base + source.name);
            if (!response.ok) throw Error("Owner source fetch failed.");
            const { vertices, normals } = parsePlyTopology(
              await response.arrayBuffer(),
            );
            if (!normals) throw Error("Owner PLY normals missing.");
            scans.push({
              id: `scan-${i}`,
              geometry: { points: vertices, normals },
            });
          }
          let sampling = true,
            previous = await new Promise(requestAnimationFrame);
          const frames = [];
          const tick = (time) => {
            frames.push(time - previous);
            previous = time;
            if (sampling) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const begin = performance.now(),
            pool = await createGlobalQueryPool({ scans });
          await new Promise(requestAnimationFrame);
          sampling = false;
          const initializedMs = performance.now() - begin,
            results = [];
          const bits = (values) => {
            const buffer = new ArrayBuffer(values.length * 8),
              view = new DataView(buffer);
            values.forEach((v, i) => view.setFloat64(i * 8, v, true));
            return Array.from(new Uint8Array(buffer), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          };
          try {
            for (const c of oracle.cases) {
              const start = performance.now();
              const value = await pool.execute({
                sourceId: `scan-${c.source}`,
                poses: scans.map((scan, i) => ({
                  id: scan.id,
                  matrix: c.poses[i],
                })),
                cells: c.cells,
                radius: c.radius,
                mode: c.mode,
              });
              results.push({
                source: c.source,
                mode: c.mode,
                transformed: c.transformed,
                count: value.count,
                queryMs: performance.now() - start,
                pairs: value.pairs.map((p) => ({
                  id: p.id,
                  active: p.active,
                  numericBits: bits([...p.source, ...p.target, p.distance]),
                })),
              });
            }
          } finally {
            pool.close();
          }
          const c = oracle.cases[1],
            single = await createGlobalQueryPool(
              { scans },
              { parallel: false },
            );
          let oneCore;
          try {
            const value = await single.execute({
              sourceId: `scan-${c.source}`,
              poses: scans.map((scan, i) => ({
                id: scan.id,
                matrix: c.poses[i],
              })),
              cells: c.cells,
              radius: c.radius,
              mode: c.mode,
            });
            oneCore = {
              physicalWorkers: single.physicalWorkers,
              pairs: value.pairs.map((p) => ({
                id: p.id,
                active: p.active,
                numericBits: bits([...p.source, ...p.target, p.distance]),
              })),
            };
          } finally {
            single.close();
          }
          const controller = new AbortController(),
            cancelled = createGlobalQueryPool(
              { scans },
              { signal: controller.signal },
            );
          controller.abort();
          let cancellation;
          try {
            const unexpected = await cancelled;
            unexpected.close();
            throw Error("Expected cancelled initialization.");
          } catch (error) {
            cancellation = error.name;
          }
          frames.sort((a, b) => a - b);
          return {
            physicalWorkers: pool.physicalWorkers,
            indexesPerWorker: pool.indexesPerWorker,
            initializedMs,
            results,
            oneCore,
            cancellation,
            sharing: crossOriginIsolated,
            initializationFrames: {
              count: frames.length,
              medianMs: frames[Math.floor(frames.length * 0.5)],
              maximumMs: frames.at(-1),
            },
          };
        },
        { oracle, base: `http://127.0.0.1:${port}${prefix}` },
      );
      assert.equal(result.physicalWorkers, 2);
      assert.deepEqual(result.indexesPerWorker, [3, 3]);
      assert.equal(result.oneCore.physicalWorkers, 1);
      assert.deepEqual(result.oneCore.pairs, oracle.cases[1].results);
      assert.equal(result.cancellation, "AbortError");
      for (let i = 0; i < oracle.cases.length; i++) {
        assert.equal(result.results[i].count, oracle.cases[i].count);
        assert.deepEqual(result.results[i].pairs, oracle.cases[i].results);
      }
      const workers = await page.evaluate(() => window.__globalQueryWorkers);
      assert.equal(workers.length, 5);
      assert(workers.every((w) => w.initialized === 1 && w.terminated));
      assert.deepEqual(errors, []);
      report.checks.push(
        "Two physical workers match every original owner correspondence byte across both numeric modes and changed poses.",
        "Each worker initializes three geometry indexes once; later queries reuse them.",
        "Both worker handles terminate and no browser errors occur.",
        "A single physical worker preserves the UI-selected numeric mode; cancellation releases both initializing workers.",
      );
      report.physicalWorkers = result.physicalWorkers;
      report.initializedMs = result.initializedMs;
      report.sharedGeometry = result.sharing;
      report.initializationFrames = result.initializationFrames;
      report.queries = result.results.map(({ pairs, ...row }) => row);
      report.workers = workers;
      report.browserErrors = errors;
      report.passed = true;
      console.log(JSON.stringify(report));
    })(),
    deadline,
  ]);
} finally {
  clearTimeout(lease);
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  if (server.listening)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  ledger.closedAt = new Date().toISOString();
  await save();
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(report, null, 2),
  );
}
