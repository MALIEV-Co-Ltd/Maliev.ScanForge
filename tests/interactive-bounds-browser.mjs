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
    async ({ fixture, kernelFixture, workerUrl, inputOrigin }) => {
      const native = JSON.parse(fixture),
        kernels = JSON.parse(kernelFixture);
      const { InteractiveBoundsPool } =
        await import("/src/interactive-bounds-pool.ts");
      const OriginalWorker = globalThis.Worker;
      let created = 0,
        live = 0,
        preparations = 0;
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
        const { parsePlyTopology } = await import("/src/ply-topology.ts");
        const { readAscPointCloud } = await import("/src/asc-import.ts");
        const sources = new Map();
        for (const c of native.cases)
          if (!sources.has(c.pointsFile)) {
            const bytes = await (
              await fetch(inputOrigin + "/" + c.name)
            ).arrayBuffer();
            const points = c.name.endsWith(".ply")
              ? parsePlyTopology(bytes).vertices
              : (await readAscPointCloud(new Blob([bytes]))).positions;
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
        pool.close();
        assert(live === 0, "Owner worker leak");
        return {
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
