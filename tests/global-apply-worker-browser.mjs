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
  out = new URL("../.resources/global-apply-worker-browser/", import.meta.url);
await mkdir(out, { recursive: true });
const oraclePath = new URL(
  "./fixtures/global-fine-apply-stages-native.json",
  import.meta.url,
);
const oracle = JSON.parse(await readFile(oraclePath, "utf8")),
  prefix = "/" + randomUUID() + "/";
const ledger = {
  owner: "global-apply-native-worker-parity",
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
        window.__datumStageWorkers = [];
        window.Worker = class extends Original {
          constructor(url, options) {
            super(url, options);
            this.record = String(url).includes("datum-transform-worker")
              ? { messages: 0, staged: 0, terminated: false }
              : undefined;
            if (this.record) window.__datumStageWorkers.push(this.record);
          }
          postMessage(value, ...rest) {
            if (this.record) {
              this.record.messages++;
              if (value.matrices) this.record.staged++;
            }
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
          const { createDatumTransformExecutor } =
            await import("/src/datum-transform-pool.ts");
          const hash = async (v) =>
            Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
                ),
              ),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
          const decode = (hex) => {
            const view = new DataView(
              Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16)).buffer,
            );
            return Array.from({ length: hex.length / 16 }, (_, i) =>
              view.getFloat64(i * 8, true),
            );
          };
          const scans = [];
          for (const source of oracle.sources) {
            const response = await fetch(base + source.name);
            if (!response.ok) throw Error("Owner source unavailable");
            const mesh = parsePlyTopology(await response.arrayBuffer());
            if (!mesh.normals) throw Error("Owner normals missing");
            if (
              (await hash(mesh.vertices)) !== source.pointsSha256 ||
              (await hash(mesh.normals)) !== source.normalsSha256
            )
              throw Error("Source hash mismatch");
            const faceNormals = new Float32Array(mesh.triangles.length);
            for (let i = 0; i < mesh.triangles.length; i += 3)
              for (let a = 0; a < 3; a++)
                faceNormals[i + a] = mesh.normals[mesh.triangles[i] * 3 + a];
            scans.push({
              ...mesh,
              faceNormals,
              indexHash: await hash(mesh.triangles),
            });
          }
          const pool = createDatumTransformExecutor({ threshold: 0 }),
            results = [];
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
          try {
            for (const c of oracle.meshCases) {
              const scan = scans[c.source],
                matrices = c.matrices.map(decode),
                before = performance.now();
              const coordinates = await pool.transformStages(
                  scan.vertices,
                  matrices,
                ),
                normals = await pool.transformStages(
                  scan.normals,
                  matrices,
                  true,
                ),
                faces = await pool.transformStages(
                  scan.faceNormals,
                  matrices,
                  true,
                );
              results.push({
                source: c.source,
                mode: c.mode,
                positionsSha256: await hash(coordinates.output),
                normalsSha256: await hash(normals.output),
                faceNormalsSha256: await hash(faces.output),
                physicalWorkers: coordinates.execution.physicalWorkers,
                elapsedMs: performance.now() - before,
              });
            }
            await new Promise(requestAnimationFrame);
          } finally {
            sampling = false;
            pool.close();
          }
          frames.sort((a, b) => a - b);
          for (let i = 0; i < scans.length; i++)
            if (
              (await hash(scans[i].vertices)) !==
                oracle.sources[i].pointsSha256 ||
              (await hash(scans[i].normals)) !==
                oracle.sources[i].normalsSha256 ||
              (await hash(scans[i].triangles)) !== scans[i].indexHash
            )
              throw Error("Authored buffers changed");
          return {
            results,
            frames: {
              count: frames.length,
              medianMs: frames[Math.floor(frames.length * 0.5)],
              maximumMs: frames.at(-1),
            },
          };
        },
        { oracle, base: `http://127.0.0.1:${port}${prefix}` },
      );
      await writeFile(
        new URL("numeric-results.json", out),
        JSON.stringify(result, null, 2),
      );
      for (let i = 0; i < oracle.meshCases.length; i++) {
        const c = oracle.meshCases[i],
          actual = result.results[i],
          expected = c.stages.at(-1);
        assert.equal(actual.physicalWorkers, 2);
        assert.equal(actual.positionsSha256, expected.positionsSha256);
        assert.equal(actual.normalsSha256, expected.normalsSha256);
        assert.equal(actual.faceNormalsSha256, expected.faceNormalsSha256);
      }
      const workers = await page.evaluate(() => window.__datumStageWorkers);
      assert.equal(workers.length, 2);
      assert(
        workers.every(
          (w) => w.messages > 0 && w.messages === w.staged && w.terminated,
        ),
      );
      assert.deepEqual(errors, []);
      report.results = result.results;
      report.frames = result.frames;
      report.workers = workers;
      report.browserErrors = errors;
      report.frameBudgetPassed = result.frames.maximumMs < 100;
      report.checks.push(
        "All six complete-owner two-stage coordinate, vertex-normal and controlled face-normal outputs match original native hashes.",
        "Two physical workers retain intermediate Float32 rounding within each chunk, consume staged messages, preserve authored coordinates/normals/indices and terminate.",
      );
      assert(
        report.frameBudgetPassed,
        "Staged geometry application blocked a main-thread frame for at least 100 ms",
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
