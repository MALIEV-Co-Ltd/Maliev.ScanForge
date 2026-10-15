import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { freemem } from "node:os";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";
if (freemem() < 3072 * 1048576)
  throw Error(
    "Interactive owner bounds validation requires 3072 MiB available",
  );
const root = new URL("../", import.meta.url),
  out = new URL(".resources/interactive-bounds-browser/", root);
await mkdir(out, { recursive: true });
const origin = process.env.SCANFORGE_APP_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const sourceRoot = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(
  sourceRoot,
  "Set SCANFORGE_ALIGNMENT_EXAMPLES to the supplied scan folder",
);
const fixture = await readFile(
  new URL("tests/fixtures/interactive-owner-bounds-native.json", root),
  "utf8",
);
const native = JSON.parse(fixture);
const kernelFixture = await readFile(
  new URL("tests/fixtures/interactive-world-bounds-native.json", root),
  "utf8",
);
const mirrorFixture = await readFile(
  new URL(
    "tests/fixtures/interactive-mirror-point-selection-native.json",
    root,
  ),
  "utf8",
);
const ownerMirrorFixture = await readFile(
  new URL("tests/fixtures/interactive-owner-mirror-points-native.json", root),
  "utf8",
);
const ledger = {
  owner: "interactive-bounds-browser",
  pid: process.pid,
  executable: process.execPath,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
};
let browserServer, browser, inputServer;
const save = () =>
  writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
await save();
const lease = setTimeout(() => void browserServer?.close(), 180000);
try {
  // Compile the gated worker independently: this check also runs before the GUI entry is enabled.
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: "esbuild",
      target: "es2022",
      lib: {
        entry: fileURLToPath(new URL("src/interactive-bounds-worker.ts", root)),
        formats: ["es"],
        fileName: "interactive-bounds-worker",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const chunks = (Array.isArray(bundle) ? bundle : [bundle])
    .flatMap((item) => item.output)
    .filter((item) => item.type === "chunk");
  assert.equal(chunks.length, 1);
  const workerSource = chunks[0].code;
  ledger.workerSha256 = createHash("sha256").update(workerSource).digest("hex");
  await save();
  browserServer = await chromium.launchServer({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--js-flags=--max-old-space-size=1792"],
  });
  ledger.browserPid = browserServer.process().pid;
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  await page.route("**/interactive-bounds-worker-bundle.mjs", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
      body: workerSource,
    }),
  );
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  page.on("requestfailed", (request) =>
    console.error(request.url(), request.failure()?.errorText),
  );
  page.on("crash", () => errors.push("Validation renderer crashed"));
  page.on("pageerror", (e) => errors.push(e.message));
  await writeFile(
    new URL("harness.html", out),
    "<!doctype html><title>Isolated Interactive bounds validation</title>",
  );
  for (const row of new Map(native.cases.map((c) => [c.name, c])).values()) {
    const bytes = await readFile(sourceRoot + "/" + row.name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
  }
  inputServer = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (req.method !== "GET" || !native.cases.some((c) => c.name === name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const path = sourceRoot + "/" + name;
      const info = await stat(path);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size,
        "Access-Control-Allow-Origin": origin,
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      createReadStream(path)
        .on("error", (error) => res.destroy(error))
        .pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => inputServer.listen(0, "127.0.0.1", resolve));
  ledger.inputPort = inputServer.address().port;
  await save();
  await page.goto(
    origin + "/.resources/interactive-bounds-browser/harness.html",
  );
  const result = await page.evaluate(
    async ({
      fixture,
      kernelFixture,
      mirrorFixture,
      ownerMirrorFixture,
      workerUrl,
      inputOrigin,
    }) => {
      const native = JSON.parse(fixture),
        kernels = JSON.parse(kernelFixture),
        mirrorNative = JSON.parse(mirrorFixture),
        ownerMirror = JSON.parse(ownerMirrorFixture);
      const { InteractiveBoundsPool } =
        await import("/src/interactive-bounds-pool.ts");
      const OriginalWorker = globalThis.Worker;
      let created = 0,
        live = 0,
        preparations = 0,
        maximumLive = 0;
      Object.defineProperty(navigator, "hardwareConcurrency", {
        configurable: true,
        value: 8,
      });
      globalThis.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(
            String(url).includes("interactive-bounds-worker.ts")
              ? workerUrl
              : url,
            options,
          );
          created++;
          live++;
          maximumLive = Math.max(maximumLive, live);
          this.released = false;
        }
        postMessage(message, transfer) {
          if (message.action === "prepare") preparations++;
          super.postMessage(message, transfer);
        }
        terminate() {
          if (!this.released) {
            live--;
            this.released = true;
          }
          return super.terminate();
        }
      };
      const hex = (values) =>
        Array.from(
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
      const assert = (condition, message) => {
        if (!condition) throw Error(message);
      };
      let pool;
      try {
        pool = new InteractiveBoundsPool(
          new Map(
            kernels.cases.map((c, i) => [
              String(i),
              {
                positions: Float32Array.from(c.points.flat()),
                flags: Uint32Array.from(c.flags),
              },
            ]),
          ),
          { threshold: 0 },
        );
        for (let i = 0; i < kernels.cases.length; i++) {
          const c = kernels.cases[i],
            r = await pool.measure(String(i), kernels.transforms[c.transform]);
          assert(
            hex(r.values) === c.boundsBits && r.valid === !!c.valid,
            "Native kernel mismatch " + i,
          );
          assert(
            r.execution.physicalWorkers === 2,
            "Expected two physical workers",
          );
        }
        pool.close();
        assert(live === 0, "Kernel worker leak");
        const mirrorSettings = (c) => ({
          direction: c.direction,
          stride: c.stride,
          onlySelected: c.onlySelected,
          backfaces: c.backfaces,
          baseColor: [0.8, 0.8, 0],
          selectedColor: [0.3, 0.4, 0.5],
          allowanceMilliseconds: c.allowanceMilliseconds,
          elapsedMilliseconds: c.elapsedMilliseconds,
        });
        const compactColors = (colors, indices) => {
          const out = new Float32Array(indices.length * 3);
          for (let i = 0; i < indices.length; i++)
            for (let a = 0; a < 3; a++)
              out[i * 3 + a] = colors[indices[i] * 3 + a];
          return out;
        };
        pool = new InteractiveBoundsPool(
          new Map(
            [0, 16, 32].map((n) => [
              String(n),
              {
                positions: new Float32Array(n * 3),
                normals: Float32Array.from(
                  mirrorNative.normals.slice(0, n).flat(),
                ),
                flags: Uint32Array.from(mirrorNative.flags.slice(0, n)),
              },
            ]),
          ),
          { threshold: 0 },
        );
        for (const c of mirrorNative.cases) {
          const r = await pool.mirror(String(c.count), mirrorSettings(c));
          assert(
            hex(r.indices) === hex(Uint32Array.from(c.indices)),
            "Native mirror indices mismatch",
          );
          assert(
            hex(compactColors(r.colors, r.indices)) ===
              hex(Float32Array.from(c.colors.flat())),
            "Native mirror color mismatch",
          );
          assert(
            r.complete === c.complete && r.execution.physicalWorkers === 2,
            "Native mirror completion/worker mismatch",
          );
        }
        pool.close();
        assert(live === 0, "Mirror kernel worker leak");
        const { parsePlyTopology } = await import("/src/ply-topology.ts");
        const { readAscPointCloud } = await import("/src/asc-import.ts");
        const sources = new Map(),
          plySources = new Map();
        for (const c of native.cases)
          if (!sources.has(c.pointsFile)) {
            const bytes = await (
              await fetch(inputOrigin + "/" + c.name)
            ).arrayBuffer();
            const topology = c.name.endsWith(".ply")
              ? parsePlyTopology(bytes)
              : undefined;
            const points = topology
              ? topology.vertices
              : (await readAscPointCloud(new Blob([bytes]))).positions;
            if (topology)
              plySources.set(c.name, {
                positions: topology.vertices,
                normals: topology.normals,
              });
            assert(points.length === c.count * 3, "Source count mismatch");
            const digest = Array.from(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", points.buffer),
              ),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            assert(
              digest === c.pointsSha256,
              "Imported point-buffer digest mismatch " + c.name,
            );
            sources.set(c.pointsFile, { positions: points });
          }
        const digest = async (a) =>
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
              ),
            ),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("");
        for (const c of ownerMirror.cases) {
          const source = plySources.get(c.name);
          assert(source?.normals, "Owner mirror needs imported normals");
          const flags = new Uint32Array(c.count);
          for (let i = 0; i < c.count; i++)
            flags[i] =
              i < c.selectedPrefixCount
                ? 2
                : ownerMirror.flagsPattern[
                    (i - c.selectedPrefixCount) %
                      ownerMirror.flagsPattern.length
                  ];
          assert(
            (await digest(source.positions)) === c.positionsSha256 &&
              (await digest(source.normals)) === c.normalsSha256 &&
              (await digest(flags)) === c.flagsSha256,
            "Owner mirror input digest mismatch",
          );
          sources.set("mirror:" + c.name, { ...source, flags });
        }
        pool = new InteractiveBoundsPool(sources);
        const rows = [];
        const prepareStart = preparations;
        for (const c of native.cases) {
          const start = performance.now(),
            r = await pool.measure(
              c.pointsFile,
              native.transforms[c.transform],
            );
          assert(
            hex(r.values) === c.boundsBits && r.valid === !!c.valid,
            "Owner native mismatch " + c.name + " pose " + c.transform,
          );
          assert(r.execution.physicalWorkers === 2, "Owner multicore fallback");
          rows.push({
            name: c.name,
            pose: c.transform,
            points: c.count,
            milliseconds: performance.now() - start,
            execution: r.execution,
          });
        }
        const coldPreparations = preparations - prepareStart;
        const before = preparations;
        const start = performance.now();
        await pool.measure(native.cases[0].pointsFile, native.transforms[1]);
        const warmMilliseconds = performance.now() - start;
        assert(before === preparations, "Warm query retransferred source");
        const ownerMirrorRows = [];
        for (const c of ownerMirror.cases) {
          const key = "mirror:" + c.name;
          await pool.measure(key, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
          const before = preparations;
          const r = await pool.mirror(key, c.settings);
          assert(
            preparations === before,
            "Mirror retransferred cached bounds data",
          );
          assert(
            r.execution.physicalWorkers === 2,
            "Owner mirror did not share two workers",
          );
          assert(
            r.indices.length === c.drawn &&
              (await digest(r.indices)) === c.indicesSha256,
            "Owner native mirror index digest mismatch",
          );
          const colors = compactColors(r.colors, r.indices);
          assert(
            (await digest(colors)) === c.colorsSha256,
            "Owner native mirror color digest mismatch",
          );
          const positions = new Float32Array(r.indices.length * 3),
            source = sources.get(key);
          for (let i = 0; i < r.indices.length; i++)
            for (let a = 0; a < 3; a++)
              positions[i * 3 + a] = source.positions[r.indices[i] * 3 + a];
          assert(
            (await digest(positions)) === c.drawnPositionsSha256,
            "Owner native point-submission digest mismatch",
          );
          assert(
            source.positions.length === c.count * 3 &&
              source.normals.length === c.count * 3,
            "Owner source buffers detached",
          );
          ownerMirrorRows.push({
            name: c.name,
            points: c.count,
            drawn: r.indices.length,
            execution: r.execution,
            nativeDigestsMatched: true,
          });
        }
        const warmMirror = [],
          intervals = [],
          longTasks = [];
        let sampling = true,
          last;
        const frame = (now) => {
          if (!sampling) return;
          if (last !== undefined) intervals.push(now - last);
          last = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        const observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) longTasks.push(e.duration);
        });
        observer.observe({ type: "longtask" });
        try {
          for (const c of ownerMirror.cases)
            for (let repeat = 0; repeat < 5; repeat++) {
              const before = preparations;
              const r = await pool.mirror(
                "mirror:" + c.name,
                {
                  ...c.settings,
                  stride: 1,
                  direction: [1 + repeat * 0.01, -0.5, 0.25],
                },
                { includeColors: false },
              );
              assert(
                r.colors === undefined && preparations === before,
                "Warm mirror rebuilt source/color buffers",
              );
              warmMirror.push({ name: c.name, ...r.execution });
            }
        } finally {
          sampling = false;
          for (const e of observer.takeRecords()) longTasks.push(e.duration);
          observer.disconnect();
        }
        pool.close();
        assert(live === 0, "Owner worker leak");
        return {
          mirrorKernelCases: mirrorNative.cases.length,
          ownerMirrorRows,
          warmMirror,
          mainFrameIntervals: intervals,
          mainLongTasks: longTasks,
          maximumLiveWorkers: maximumLive,
          kernelCases: kernels.cases.length,
          ownerCases: rows.length,
          rows,
          createdWorkers: created,
          coldPreparations,
          warmMilliseconds,
          liveWorkers: live,
        };
      } finally {
        pool?.close();
        globalThis.Worker = OriginalWorker;
      }
    },
    {
      fixture,
      kernelFixture,
      mirrorFixture,
      ownerMirrorFixture,
      workerUrl: origin + "/interactive-bounds-worker-bundle.mjs",
      inputOrigin: "http://127.0.0.1:" + ledger.inputPort,
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(lease);
  try {
    await browser?.close();
  } finally {
    try {
      await browserServer?.close();
    } finally {
      if (inputServer) {
        inputServer.closeAllConnections();
        await new Promise((resolve) => inputServer.close(resolve));
      }
      await unlink(new URL("harness.html", out)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      ledger.closedAt = new Date().toISOString();
      await save();
    }
  }
}
