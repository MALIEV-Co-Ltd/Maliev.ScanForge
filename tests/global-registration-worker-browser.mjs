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
const mode = process.env.SCANFORGE_GLOBAL_MODE ?? "target-average";
const entityMode = process.env.SCANFORGE_GLOBAL_ENTITY_MODE ?? "mesh";
assert(["mesh", "cloud"].includes(entityMode), "Unknown scan carrier mode");
assert(
  ["target-average", "pooled-plane"].includes(mode),
  "Unknown native numeric branch",
);
const origin = "http://127.0.0.1:5173",
  out = new URL(
    `../.resources/global-registration-worker-browser-${mode}${entityMode === "cloud" ? "-cloud" : ""}/`,
    import.meta.url,
  );
await mkdir(out, { recursive: true });
const oraclePath = new URL(
  mode === "target-average"
    ? "./fixtures/global-fine-multicore-outer-owner-native.json"
    : "./fixtures/global-fine-full-outer-owner-native.json",
  import.meta.url,
);
const oracle = JSON.parse(await readFile(oraclePath, "utf8")),
  prefix = "/" + randomUUID() + "/";
const ledger = {
  owner: "global-registration-native-worker-parity",
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
            this.record =
              String(url).includes("scan-global-") ||
              String(url).includes("datum-transform-worker")
                ? {
                    kind: String(url).includes("scene-worker")
                      ? "preparation"
                      : String(url).includes("datum-transform-worker")
                        ? "application"
                        : "query",
                    queryPoolReleased: window.__globalQueryWorkers
                      .filter((w) => w.kind === "query")
                      .every((w) => w.terminated),
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
      const applyOracle = JSON.parse(
        await readFile(
          new URL(
            "./fixtures/global-fine-apply-stages-native.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const profileSession = process.env.SCANFORGE_PROFILE
        ? await page.context().newCDPSession(page)
        : undefined;
      if (profileSession) {
        await profileSession.send("Profiler.enable");
        await profileSession.send("Profiler.start");
      }
      if (profileSession)
        report.profilePageStartedAt = await page.evaluate(() =>
          performance.now(),
        );
      const result = await page.evaluate(
        async ({ oracle, applyOracle, base, entityMode }) => {
          const { parsePlyTopology } = await import("/src/ply-topology.ts");
          const { refineGlobalScanSet } =
            await import("/src/scan-global-registration.ts");
          const { yieldScanTask } = await import("/src/scan-task.ts");
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
          const bits = (v) =>
            Array.from(new Uint8Array(new Float64Array(v).buffer), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          const capture = (s) => ({
            matrixBits: bits(s.matrix),
            meanBits: bits([s.mean]),
            coverageBits: bits([s.std]),
            converged: s.converged,
            stable: s.stable,
          });
          const scans = [],
            entities = [],
            before = [];
          for (let index = 0; index < oracle.scene.sources.length; index++) {
            const source = oracle.scene.sources[index],
              response = await fetch(base + source.name);
            if (!response.ok) throw Error("Owner scan fetch failed");
            const mesh = parsePlyTopology(await response.arrayBuffer());
            if (
              !mesh.normals ||
              (await hash(mesh.vertices)) !== source.pointsSha256 ||
              (await hash(mesh.normals)) !== source.normalsSha256
            )
              throw Error("Input carrier digest mismatch");
            const positions =
                entityMode === "cloud"
                  ? mesh.vertices
                  : new Float32Array(mesh.triangles.length * 3),
              normals =
                entityMode === "cloud"
                  ? mesh.normals
                  : new Array(positions.length);
            for (
              let first = 0;
              entityMode !== "cloud" && first < mesh.triangles.length;
              first += 65536
            ) {
              for (
                let i = first;
                i < Math.min(first + 65536, mesh.triangles.length);
                i++
              )
                for (let a = 0; a < 3; a++) {
                  positions[i * 3 + a] =
                    mesh.vertices[mesh.triangles[i] * 3 + a];
                  normals[i * 3 + a] = mesh.normals[mesh.triangles[i] * 3 + a];
                }
              await yieldScanTask();
            }
            const id = String(index),
              saved = {
                hidden: [0],
                saved: [{ id: "saved", name: "Saved", triangles: [0] }],
              };
            scans.push({
              id,
              geometry: { points: mesh.vertices, normals: mesh.normals },
            });
            entities.push({
              id,
              name: source.name,
              kind: entityMode === "cloud" ? "pointcloud" : "mesh",
              positions,
              normals,
              indexedMesh: entityMode === "cloud" ? undefined : mesh,
              meshSelection: saved,
              visible: true,
              color: "#aaaaaa",
              opacity: 1,
            });
            before.push({
              points: await hash(mesh.vertices),
              normals: await hash(mesh.normals),
              indices: await hash(mesh.triangles),
              positions: await hash(positions),
            });
          }
          const longTasks = [];
          let currentStage = "initialization";
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              longTasks.push({
                start: entry.startTime,
                duration: entry.duration,
                stage: currentStage,
              });
          });
          observer.observe({ type: "longtask", buffered: false });
          const passSnapshots = [],
            frames = [],
            frameTrace = [];
          let sampling = true,
            previous = await new Promise(requestAnimationFrame);
          const tick = (t) => {
            if (!sampling) return;
            frameTrace.push({
              previous,
              time: t,
              observed: performance.now(),
              stage: currentStage,
            });
            frames.push(t - previous);
            previous = t;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const start = performance.now();
          let value;
          try {
            value = await refineGlobalScanSet(
              { scans, clocks: oracle.scene.results.map((s) => s.clockInputs) },
              entities,
              {
                mode: oracle.mode,
                clock: () => oracle.clockInputs[0],
                localTolerance: oracle.localTolerance,
                coverageTolerance: oracle.coverageTolerance,
                onProgress: (_fraction, stage) => {
                  currentStage = stage;
                },
                onPass: (pass, ordered) => {
                  if (pass)
                    passSnapshots.push({
                      order: ordered.map((s) => Number(s.id)),
                      states: scans.map((s) =>
                        capture(ordered.find((v) => v.id === s.id)),
                      ),
                    });
                },
              },
            );
            await new Promise(requestAnimationFrame);
          } finally {
            sampling = false;
            observer.disconnect();
          }
          const elapsedMs = performance.now() - start;
          const { validateProject } = await import("/src/io.ts");
          validateProject({
            format: "maliev-scanforge",
            version: 1,
            name: "Native scan set",
            units: "mm",
            entities: value.entities,
          });
          const output = [];
          for (let index = 0; index < entities.length; index++) {
            const entity = value.entities[index],
              source = entities[index],
              expected = applyOracle.meshCases.find(
                (c) => c.source === index && c.mode === oracle.mode,
              );
            if (entityMode === "cloud") {
              const original = applyOracle.cloudCases.find(
                  (c) =>
                    c.source === index &&
                    c.name === source.name + "-" + oracle.mode,
                ),
                pose = entity.pointCloudPlacement;
              if (
                !pose ||
                pose.matrixBits !== original.poseBits.at(-1) ||
                pose.sourcePositions !== source.positions ||
                pose.sourceNormals !== source.normals ||
                entity.meshSelection !== source.meshSelection
              )
                throw Error("Native cloud placement/source identity mismatch");
              if (!(entity.normals instanceof Float32Array))
                throw Error("Cloud normals were expanded into a JS array");
              const application = value.diagnostics.application.find(
                (a) => a.id === source.id,
              );
              const boundsBits = Array.from(
                new Uint8Array(
                  Float32Array.from([
                    ...application.bounds.min,
                    ...application.bounds.max,
                  ]).buffer,
                ),
                (b) => b.toString(16).padStart(2, "0"),
              ).join("");
              if (boundsBits !== original.worldBoundsBits)
                throw Error("Native cloud world bounds mismatch");
              if (
                (await hash(source.positions)) !== before[index].points ||
                (await hash(source.normals)) !== before[index].normals
              )
                throw Error("Authored cloud source mutated");
              output.push({
                name: source.name,
                points: source.positions.length / 3,
                poseBits: pose.matrixBits,
                boundsBits,
                execution: application.execution,
              });
              continue;
            }
            if (
              entity.indexedMesh.triangles !== source.indexedMesh.triangles ||
              entity.meshSelection !== source.meshSelection
            )
              throw Error("Topology or selection identity changed");
            if (!(entity.normals instanceof Float32Array))
              throw Error(
                "Transformed normals were expanded into a large JS array",
              );
            const vertices = await hash(entity.indexedMesh.vertices),
              normals = await hash(entity.indexedMesh.normals);
            if (
              vertices !== expected.stages.at(-1).positionsSha256 ||
              normals !== expected.stages.at(-1).normalsSha256
            )
              throw Error("Complete native setter output mismatch");
            for (
              let first = 0;
              first < source.indexedMesh.triangles.length;
              first += 65536
            ) {
              for (
                let i = first;
                i <
                Math.min(first + 65536, source.indexedMesh.triangles.length);
                i++
              )
                for (let a = 0; a < 3; a++) {
                  const j = source.indexedMesh.triangles[i] * 3 + a;
                  if (
                    entity.positions[i * 3 + a] !==
                      entity.indexedMesh.vertices[j] ||
                    entity.normals[i * 3 + a] !== entity.indexedMesh.normals[j]
                  )
                    throw Error("Expanded mesh output mismatch");
                }
              await yieldScanTask();
            }
            const after = {
              points: await hash(source.indexedMesh.vertices),
              normals: await hash(source.indexedMesh.normals),
              indices: await hash(source.indexedMesh.triangles),
              positions: await hash(source.positions),
            };
            if (JSON.stringify(after) !== JSON.stringify(before[index]))
              throw Error("Authored geometry was mutated");
            output.push({
              name: source.name,
              triangles: source.positions.length / 9,
              positionsSha256: vertices,
              normalsSha256: normals,
              execution: value.diagnostics.application.find(
                (a) => a.id === source.id,
              ).execution,
            });
          }
          frames.sort((a, b) => a - b);
          return {
            elapsedMs,
            longTasks,
            frameTrace,
            numericStartedAt: start,
            physicalWorkers: value.diagnostics.queryWorkers,
            queries: value.diagnostics.queries,
            passes: value.outer.passes,
            passSnapshots,
            final: {
              order: value.outer.order.map(Number),
              states: value.outer.states.map(capture),
            },
            applications: value.outer.applications.map((a) => ({
              source: Number(a.id),
              matrixBits: bits(a.matrix),
            })),
            output,
            frames: {
              count: frames.length,
              medianMs: frames[Math.floor(frames.length * 0.5)],
              maximumMs: frames.at(-1),
            },
          };
        },
        {
          oracle,
          applyOracle,
          entityMode,
          base: `http://127.0.0.1:${port}${prefix}`,
        },
      );
      if (profileSession) {
        report.profileFile = `registration-${process.pid}.cpuprofile`;
        const { profile } = await profileSession.send("Profiler.stop");
        await writeFile(
          new URL(`registration-${process.pid}.cpuprofile`, out),
          JSON.stringify(profile),
        );
        await profileSession.detach();
      }
      assert.equal(result.physicalWorkers, 2);
      assert(
        result.output.every((scan) => scan.execution.physicalWorkers === 2),
        "A scan object fell back to UI-thread geometry processing",
      );
      assert.equal(result.passes, oracle.passes);
      assert.deepEqual(result.passSnapshots, oracle.passSnapshots);
      assert.deepEqual(result.final, oracle.final);
      assert.deepEqual(result.applications, oracle.applications);
      const workers = await page.evaluate(() => window.__globalQueryWorkers);
      assert.equal(workers.filter((w) => w.kind === "preparation").length, 1);
      assert.equal(workers.filter((w) => w.kind === "query").length, 2);
      assert.equal(workers.filter((w) => w.kind === "application").length, 2);
      assert(workers.every((w) => w.terminated));
      assert(
        workers
          .filter((w) => w.kind === "application")
          .every((w) => w.queryPoolReleased),
      );
      assert(
        workers
          .filter((w) => w.kind !== "application")
          .every((w) => w.initialized === 1),
      );
      assert.deepEqual(errors, []);
      Object.assign(report, {
        ...result,
        entityMode,
        frameTrace: undefined,
        passSnapshots: undefined,
        final: undefined,
        applications: undefined,
        workers,
        browserErrors: errors,
      });
      report.checks.push(
        entityMode === "cloud"
          ? "Connected native numeric passes and cloud setter pose/bounds bytes match on all three full owner point carriers."
          : "Connected preparation, native outer/local/query numerics and full scan-object application match native pass and final geometry bytes on all three complete owner PLY scans.",
        "Query workers close before application workers start; authored buffers and selections remain unchanged.",
      );
      report.frameBudgetPassed = result.frames.maximumMs < 100;
      await writeFile(
        new URL("numeric-results.json", out),
        JSON.stringify(result, null, 2),
      );
      assert(
        report.frameBudgetPassed,
        "Connected scan-set registration blocked a frame for at least 100 ms",
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
