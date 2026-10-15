import assert from "node:assert/strict";
import { freemem } from "node:os";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const requiredMiB = 3072;
assert(
  freemem() >= requiredMiB * 1048576,
  `Owner alignment requires ${requiredMiB} MiB free`,
);
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(folder, "Set SCANFORGE_ALIGNMENT_EXAMPLES to the supplied scan folder");
const inputRoot = resolve(folder);
const appOrigin = process.env.SCANFORGE_APP_ORIGIN ?? "http://127.0.0.1:5173";
const app = new URL(appOrigin);
assert(
  ["127.0.0.1", "localhost"].includes(app.hostname),
  "Validation requires a loopback development server",
);
const root = new URL("../", import.meta.url);
const out = new URL(".resources/alignment-owner-multicore/", root);
await mkdir(out, { recursive: true });
const capture = JSON.parse(
  await readFile(
    new URL("docs/evidence/owner-landmark-full-driver-native.json", root),
    "utf8",
  ),
);
const workerFiles = (await readdir(new URL("dist/assets/", root))).filter(
  (name) => name.startsWith("scan-alignment-worker-") && name.endsWith(".js"),
);
assert.equal(
  workerFiles.length,
  1,
  "Build one production alignment worker before validation",
);
const workerBundleUrl = appOrigin + "/dist/assets/" + workerFiles[0];
const leaseMs = 420000;
const ledger = {
  owner: "alignment-owner-multicore",
  pid: process.pid,
  executable: process.execPath,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  expiresAt: new Date(Date.now() + leaseMs).toISOString(),
  persistentData: false,
  requiredFreeMiB: requiredMiB,
  admittedFreeMiB: Math.round(freemem() / 1048576),
  resources: [],
  cases: [],
  cleanup: [],
};
const receipt = new URL("validation.json", out);
const save = () => writeFile(receipt, JSON.stringify(ledger, null, 2) + "\n");
await save();
let server, browserServer, browser, failure;
const liveWorkers = new Set();
let workerStarts = 0;
const deadline = setTimeout(() => {
  failure = Error("Owner alignment browser lease expired");
  void browserServer?.close().catch(() => {});
}, leaseMs);
try {
  for (const name of [
    capture.targetFile,
    ...capture.cases.map((row) => row.sourceFile),
  ])
    await stat(join(inputRoot, name));
  server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (req.method !== "GET" || !/^ply-[123]\.ply$/.test(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const path = join(inputRoot, name),
        info = await stat(path);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size,
        "Access-Control-Allow-Origin": appOrigin,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "no-store",
      });
      const stream = createReadStream(path);
      res.once("close", () => stream.destroy());
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.requestTimeout = 15000;
  await new Promise((ok, bad) => {
    server.once("error", bad);
    server.listen(0, "127.0.0.1", ok);
  });
  const dataPort = server.address().port;
  ledger.resources.push({
    kind: "read-only-input-server",
    pid: process.pid,
    port: dataPort,
    bind: "127.0.0.1",
    purpose: "Stream exactly three supplied PLY files",
  });
  await save();
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--js-flags=--max-old-space-size=1536"],
  });
  ledger.resources.push({
    kind: "disposable-browser",
    pid: browserServer.process().pid,
    executable: browserServer.process().spawnfile,
    startedAt: new Date().toISOString(),
    purpose:
      "Isolated real browser workers and full owner-scan numerical replay",
  });
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  await context.grantPermissions(["local-network-access"], {
    origin: appOrigin,
  });
  const page = await context.newPage();
  page.on("worker", (worker) => {
    workerStarts++;
    liveWorkers.add(worker);
    worker.once("close", () => liveWorkers.delete(worker));
  });
  page.on("requestfailed", (request) =>
    console.error(
      "Request failed: " + request.url() + " " + request.failure()?.errorText,
    ),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["info", "error", "warning"].includes(message.type()))
      console.log(message.type() + ": " + message.text());
  });
  const harness = appOrigin + "/__owner-alignment-validation";
  await page.route(harness, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      body: "<!doctype html><title>Owner alignment numerical validation</title>",
    }),
  );
  await page.goto(harness);
  const environment = await page.evaluate(() => ({
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
  }));
  assert.equal(
    environment.crossOriginIsolated,
    true,
    "Real shared-buffer path must be admitted",
  );
  ledger.environment = {
    ...environment,
    workerBundle: workerFiles[0],
    mainKernel: "development module; same source revision as built worker",
  };
  await save();
  for (const row of capture.cases) {
    console.log(
      "Starting complete serial/two-worker comparison: " +
        row.sourceFile +
        " -> " +
        capture.targetFile,
    );
    const starts = workerStarts;
    const result = await page.evaluate(
      async ({
        dataOrigin,
        row,
        targetFile,
        targetSha256,
        workerBundleUrl,
      }) => {
        const { parsePlyTopology } = await import("/src/ply-topology.ts");
        const { refineNativeLandmarkAfterCoarse } =
          await import("/src/native-landmark-refinement.ts");
        const sha = async (value) => {
          const bytes = ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : value;
          return Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            (n) => n.toString(16).padStart(2, "0"),
          ).join("");
        };
        const read = async (name) => {
          const response = await fetch(dataOrigin + "/" + name);
          if (!response.ok) throw Error("Input read failed: " + name);
          const buffer = await response.arrayBuffer(),
            started = performance.now(),
            mesh = parsePlyTopology(buffer);
          return {
            mesh,
            sha256: await sha(buffer),
            parseAndHashMs: performance.now() - started,
          };
        };
        const source = await read(row.sourceFile),
          target = await read(targetFile);
        if (
          source.sha256 !== row.sourceSha256 ||
          target.sha256 !== targetSha256
        )
          throw Error("Owner input hashes do not match native capture");
        const meshHash = async (mesh) =>
          JSON.stringify(
            await Promise.all([
              sha(mesh.vertices),
              sha(mesh.triangles),
              mesh.normals ? sha(mesh.normals) : null,
            ]),
          );
        const sourceBefore = await meshHash(source.mesh),
          targetBefore = await meshHash(target.mesh);
        const modes = [];
        const NativeWorker = globalThis.Worker;
        let workerStats = [];
        globalThis.Worker = class extends NativeWorker {
          constructor(url, options) {
            const createdAt = performance.now();
            super(workerBundleUrl, options);
            this.stats = {
              createdAt,
              initializationPostMs: 0,
              otherPostMs: 0,
              otherPosts: 0,
            };
            workerStats.push(this.stats);
            this.addEventListener("message", (event) => {
              if (event.data.ready)
                this.stats.createdToReadyMs = performance.now() - createdAt;
            });
          }
          postMessage(...args) {
            const started = performance.now();
            super.postMessage(...args);
            const elapsed = performance.now() - started;
            if ("initialize" in args[0]) {
              this.stats.initializationStartedAfterMs =
                started - this.stats.createdAt;
              this.stats.initializationPostMs += elapsed;
              let nodes = 0,
                entries = 0,
                sharedBytes = 0;
              for (const surface of args[0].initialize.surfaces) {
                sharedBytes +=
                  surface.points.byteLength +
                  surface.triangleBounds.byteLength +
                  surface.normals.byteLength +
                  surface.neighbors.byteLength +
                  (surface.triangleFlags?.byteLength ?? 0);
                const pending = [surface.root];
                while (pending.length) {
                  const node = pending.pop();
                  nodes++;
                  entries += node.triangles.length;
                  for (const child of Object.values(node.children))
                    if (child) pending.push(child);
                }
              }
              this.stats.targetNodes = nodes;
              this.stats.targetMemberships = entries;
              this.stats.fiveTreeBytesExcludingLanes =
                sharedBytes + 5 * (nodes * 256 + entries * 8);
            } else {
              this.stats.otherPostMs += elapsed;
              this.stats.otherPosts++;
            }
          }
          terminate() {
            this.stats.lifetimeMs = performance.now() - this.stats.createdAt;
            super.terminate();
          }
        };
        for (const parallel of [false, true]) {
          workerStats = [];
          const stages = [],
            started = performance.now();
          const result = await refineNativeLandmarkAfterCoarse(
            source.mesh,
            [target.mesh],
            row.coarseMatrix,
            row.seeds,
            {
              parallel,
              workerCount: 2,
              onProgress: (fraction, stage) => {
                const previous = stages.at(-1),
                  time = performance.now() - started;
                if (previous?.stage === stage) {
                  previous.lastMs = time;
                  previous.events++;
                } else {
                  stages.push({
                    stage,
                    firstMs: time,
                    lastMs: time,
                    events: 1,
                  });
                  console.info(
                    row.sourceFile +
                      " " +
                      (parallel ? "two-worker" : "serial") +
                      ": " +
                      stage,
                  );
                }
              },
            },
          );
          const elapsedMs = performance.now() - started;
          modes.push({
            parallel,
            elapsedMs,
            workerStats,
            stages,
            refinement: result.refinement,
            diagnostics: result.diagnostics,
            finalPositionsSha256: await sha(result.indexedMesh.vertices),
            finalNormalsSha256: await sha(result.indexedMesh.normals),
            sourceUnchanged: (await meshHash(source.mesh)) === sourceBefore,
            targetUnchanged: (await meshHash(target.mesh)) === targetBefore,
            observedUsedJsHeapBytes: performance.memory?.usedJSHeapSize,
          });
        }
        globalThis.Worker = NativeWorker;
        return {
          sourceFile: row.sourceFile,
          sourceSha256: source.sha256,
          targetSha256: target.sha256,
          sourceVertices: source.mesh.vertices.length / 3,
          sourceTriangles: source.mesh.triangles.length / 3,
          sourceParseAndHashMs: source.parseAndHashMs,
          targetParseAndHashMs: target.parseAndHashMs,
          modes,
        };
      },
      {
        dataOrigin: `http://127.0.0.1:${dataPort}`,
        row,
        targetFile: capture.targetFile,
        targetSha256: capture.targetSha256,
        workerBundleUrl,
      },
    );
    assert.equal(result.sourceSha256, row.sourceSha256);
    assert.equal(result.targetSha256, capture.targetSha256);
    for (const mode of result.modes) {
      assert.equal(
        mode.refinement.initialError,
        row.initialization.initialBest,
      );
      assert.equal(mode.refinement.accepted, row.accepted);
      assert.equal(mode.refinement.best, row.best);
      assert.deepEqual(mode.refinement.parameters, row.parameters);
      assert.deepEqual(mode.refinement.matrix, row.matrix);
      assert.equal(mode.finalPositionsSha256, row.finalPositionsSha256);
      assert.equal(mode.finalNormalsSha256, row.finalNormalsSha256);
      assert.equal(mode.sourceUnchanged, true);
      assert.equal(mode.targetUnchanged, true);
      assert.equal(mode.diagnostics.physicalWorkers, mode.parallel ? 2 : 1);
      assert.equal(mode.diagnostics.logicalLanes, 2);
    }
    assert.equal(
      workerStarts - starts,
      2,
      "Exactly two physical workers are expected per parallel operation",
    );
    const until = Date.now() + 3000;
    while (liveWorkers.size && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      liveWorkers.size,
      0,
      "Alignment workers must terminate after each operation",
    );
    result.twoWorkerVsSerial =
      result.modes[0].elapsedMs / result.modes[1].elapsedMs;
    ledger.cases.push(result);
    await save();
    console.log(
      JSON.stringify({
        file: row.sourceFile,
        serialMs: result.modes[0].elapsedMs,
        twoWorkerMs: result.modes[1].elapsedMs,
        speedup: result.twoWorkerVsSerial,
        nativeExact: true,
      }),
    );
  }
  assert.deepEqual(errors, []);
  ledger.passed = true;
} catch (error) {
  failure = error;
  ledger.passed = false;
  ledger.error = error.stack;
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  if (server)
    await new Promise((ok) => {
      server.close(ok);
      server.closeAllConnections();
    });
  ledger.cleanup.push({
    remainingWorkers: liveWorkers.size,
    browserExited: browserServer
      ? browserServer.process().exitCode !== null
      : true,
    inputServerClosed: server ? !server.listening : true,
  });
  ledger.completedAt = new Date().toISOString();
  if (failure) {
    ledger.passed = false;
    ledger.error ??= failure.message;
  }
  await save();
}
