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
  out = new URL("../.resources/global-outer-worker-browser/", import.meta.url);
await mkdir(out, { recursive: true });
const oraclePath = new URL(
  "./fixtures/global-fine-multicore-outer-owner-native.json",
  import.meta.url,
);
const oracle = JSON.parse(await readFile(oraclePath, "utf8")),
  prefix = "/" + randomUUID() + "/";
const ledger = {
  owner: "global-outer-native-worker-parity",
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
  oracle.scene.sources.map((source) => [
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
      for (const source of oracle.scene.sources) {
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
            this.record = String(url).includes("scan-global-")
              ? {
                  kind: String(url).includes("scene-worker")
                    ? "preparation"
                    : "query",
                  initialized: 0,
                  terminated: false,
                }
              : undefined;
            if (this.record) window.__globalQueryWorkers.push(this.record);
          }
          postMessage(value, ...rest) {
            if (this.record && (value.initialize || value.scans))
              this.record.initialized++;
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
          for (let i = 0; i < oracle.scene.sources.length; i++) {
            const source = oracle.scene.sources[i],
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
          const { createPreparedGlobalQueryPool } =
            await import("/src/scan-global-scene-client.ts");
          const { nativeGlobalRefineLocal } =
            await import("/src/scan-native-global-local.ts");
          const { nativeGlobalRefineOuter } =
            await import("/src/scan-native-global-outer.ts");
          const bits = (values) =>
            Array.from(new Uint8Array(new Float64Array(values).buffer), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          const capture = (source) => ({
            matrixBits: bits(source.matrix),
            meanBits: bits([source.mean]),
            coverageBits: bits([source.std]),
            converged: source.converged,
            stable: source.stable,
          });
          let sampling = true,
            previous = await new Promise(requestAnimationFrame);
          const frames = [];
          const tick = (time) => {
            if (!sampling) return;
            frames.push(time - previous);
            previous = time;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const start = performance.now(),
            pool = await createPreparedGlobalQueryPool({
              scans,
              clocks: oracle.scene.results.map((source) => source.clockInputs),
            }),
            initializedMs = performance.now() - start;
          const passSnapshots = [],
            localCalls = [];
          let queries = 0;
          let output;
          try {
            output = await nativeGlobalRefineOuter(
              scans.map((scan) => ({
                id: scan.id,
                pointCount: scan.geometry.points.length / 3,
                matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
                mean: 0,
                std: 0,
              })),
              async (source, ordered, pass) => {
                const local = await nativeGlobalRefineLocal(
                  source,
                  (matrix) => {
                    queries++;
                    return pool.execute({
                      sourceId: source.id,
                      poses: ordered.map((s) => ({
                        id: s.id,
                        matrix: s.id === source.id ? matrix : s.matrix,
                      })),
                      radius: oracle.radius,
                      mode: oracle.mode,
                    });
                  },
                  { tolerance: oracle.localTolerance },
                );
                localCalls.push({
                  source: source.id,
                  pass,
                  status: local.status,
                  iterations: local.iterations,
                });
                return local;
              },
              {
                clock: () => oracle.clockInputs[0],
                coverageTolerance: oracle.coverageTolerance,
                onProgress: (pass, total, ordered) => {
                  if (pass)
                    passSnapshots.push({
                      order: ordered.map((s) =>
                        scans.findIndex((scan) => scan.id === s.id),
                      ),
                      states: scans.map((scan) =>
                        capture(ordered.find((s) => s.id === scan.id)),
                      ),
                    });
                },
              },
            );
            await new Promise(requestAnimationFrame);
          } finally {
            sampling = false;
            pool.close();
          }
          frames.sort((a, b) => a - b);
          return {
            physicalWorkers: pool.physicalWorkers,
            initializedMs,
            elapsedMs: performance.now() - start,
            queries,
            localCalls,
            passes: output.passes,
            passSnapshots,
            final: {
              order: output.order.map((id) =>
                scans.findIndex((scan) => scan.id === id),
              ),
              states: output.states.map(capture),
            },
            applications: output.applications.map((a) => ({
              source: scans.findIndex((scan) => scan.id === a.id),
              matrixBits: bits(a.matrix),
            })),
            frames: {
              count: frames.length,
              medianMs: frames[Math.floor(frames.length * 0.5)],
              maximumMs: frames.at(-1),
            },
          };
        },
        { oracle, base: `http://127.0.0.1:${port}${prefix}` },
      );
      assert.equal(result.physicalWorkers, 2);
      assert.equal(result.passes, oracle.passes);
      assert.deepEqual(result.passSnapshots, oracle.passSnapshots);
      assert.deepEqual(result.final, oracle.final);
      assert.deepEqual(result.applications, oracle.applications);
      const workers = await page.evaluate(() => window.__globalQueryWorkers);
      assert.equal(workers.length, 3);
      assert(workers.every((w) => w.initialized === 1 && w.terminated));
      assert.deepEqual(errors, []);
      report.checks.push(
        "The complete default numeric outer/local/query chain matches every native pass, statistic, pose and final setter-command byte on all three full scans.",
        "One preparation and two persistent query workers initialize once and terminate.",
      );
      Object.assign(report, {
        ...result,
        passSnapshots: undefined,
        final: undefined,
        applications: undefined,
        workers,
        browserErrors: errors,
      });
      report.frameBudgetPassed = result.frames.maximumMs < 100;
      await writeFile(
        new URL("numeric-results.json", out),
        JSON.stringify(result, null, 2),
      );
      assert(
        report.frameBudgetPassed,
        "Full alignment blocked a main-thread frame for at least 100 ms",
      );
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
