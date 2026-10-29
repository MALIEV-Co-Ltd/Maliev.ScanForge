import assert from "node:assert/strict";
import { freemem, cpus, totalmem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const residentFixture = process.argv.includes("--resident");
const globalControl = process.argv.includes("--global-control");
const sourceFile = process.env.SCANFORGE_REDUCTION_SOURCE;
const globalFixture = JSON.parse(
  await readFile(
    new URL("fixtures/reduction-global-routing.json", import.meta.url),
    "utf8",
  ),
);
const root = new URL("../", import.meta.url),
  dist = process.env.SCANFORGE_QA_DIST
    ? pathToFileURL(resolve(process.env.SCANFORGE_QA_DIST) + "/")
    : new URL("dist/", root),
  out = process.env.SCANFORGE_QA_OUT
    ? pathToFileURL(resolve(process.env.SCANFORGE_QA_OUT) + "/")
    : new URL(
        residentFixture
          ? "../.resources/resident-reduction/"
          : "../.resources/large-reduction/",
        import.meta.url,
      );
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = residentFixture ? 3072 : 6144;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Reduction replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: residentFixture
      ? "resident-reduction-browser"
      : "large-reduction-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
function processIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid}) | Select-Object @{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='executable';e={$_.Path}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return {
    ...JSON.parse(result.stdout),
    expiresAt: ledger.expiresAt,
    persistentData: false,
  };
}
let server, reserve, browserServer, browser, client, transport, failed, page;
const fixturePath = fileURLToPath(new URL("large-reduction-panel.stl", out));
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 360000);
try {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://127.0.0.1").pathname;
      const file = new URL(name === "/" ? "index.html" : name.slice(1), dist);
      if (!file.href.startsWith(dist.href)) throw Error("Invalid path");
      const data = await readFile(file);
      const ext = file.pathname.split(".").pop();
      res.writeHead(200, {
        "Content-Type":
          {
            html: "text/html",
            js: "application/javascript",
            css: "text/css",
            wasm: "application/wasm",
            json: "application/json",
          }[ext] ?? "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const appPort = server.address().port,
    origin = `http://127.0.0.1:${appPort}`;
  reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const bridgePort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  reserve = undefined;
  ledger.resources.push({
    kind: "http-server",
    port: appPort,
    bind: "127.0.0.1",
  });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("scripts/mcp-server.mjs", root))],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(bridgePort),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  client = new Client({ name: "large-reduction-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...processIdentity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=1792",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("large-reduction-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__reductionStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__reductionStages.push(e.data.stage);
            if (window.__holdReductionResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingReductionResult = true;
            }
          });
      }
    };
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI agents", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill(`http://127.0.0.1:${bridgePort}`);
  await page.getByLabel("Pairing token", { exact: true }).fill(token);
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await page
    .getByText("Connected · agents control this workspace", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    const wire =
      response.structuredContent ?? JSON.parse(response.content[0].text);
    assert(wire.ok, JSON.stringify(wire));
    return wire;
  };
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Workspace did not settle before reduction validation");
  };
  const mutate = async (name, args) => {
    await idle();
    return call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  };
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 1800; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") {
        assert.equal(state.status, expected, JSON.stringify(state));
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Geometry job timeout");
  };
  const geometryHash = async (rawSource) => {
    await idle();
    const exported = (
      await job(await call("project_export", { format: "stl", visible: true }))
    ).result;
    const hash = createHash("sha256");
    const differences = { count: 0, numericallyDifferent: 0, first: [] };
    try {
      // Stream coordinate bytes only; STL headers/normals are export metadata.
      let at = 84;
      while (at < exported.bytes) {
        const read = (
          await call("artifact_read", {
            artifactId: exported.artifactId,
            offset: at,
            length: 262100,
          })
        ).result;
        const data = Buffer.from(read.base64, "base64");
        assert(data.length > 0 && data.length % 50 === 0);
        for (let face = 0; face < data.length; face += 50) {
          hash.update(data.subarray(face + 12, face + 48));
          if (rawSource)
            for (let coordinate = 0; coordinate < 9; coordinate++) {
              const offset = face + 12 + coordinate * 4,
                sourceOffset = at + offset;
              if (
                data.readUInt32LE(offset) !==
                rawSource.readUInt32LE(sourceOffset)
              ) {
                differences.count++;
                if (
                  data.readFloatLE(offset) !==
                  rawSource.readFloatLE(sourceOffset)
                )
                  differences.numericallyDifferent++;
                if (differences.first.length < 16)
                  differences.first.push({
                    face: (at - 84 + face) / 50,
                    coordinate,
                    sourceBits: rawSource.readUInt32LE(sourceOffset),
                    exportedBits: data.readUInt32LE(offset),
                    source: rawSource.readFloatLE(sourceOffset),
                    exported: data.readFloatLE(offset),
                  });
              }
            }
        }
        assert.equal(read.nextOffset, at + data.length);
        at = read.nextOffset;
      }
      if (rawSource) {
        ledger.importCoordinateDifferences = differences;
        console.log(
          JSON.stringify({ importCoordinateDifferences: differences }),
        );
      }
      return hash.digest("hex");
    } finally {
      await call("artifact_delete", { artifactId: exported.artifactId });
    }
  };

  const nx = globalControl ? globalFixture.nx : residentFixture ? 300 : 750,
    ny = globalControl ? globalFixture.ny : residentFixture ? 192 : 768;
  const bytes = sourceFile
    ? await readFile(sourceFile)
    : Buffer.alloc(84 + nx * ny * 2 * 50);
  const inputTriangles = sourceFile ? bytes.readUInt32LE(80) : nx * ny * 2;
  assert.equal(
    bytes.length,
    84 + inputTriangles * 50,
    "Expected complete binary STL source",
  );
  if (!sourceFile) bytes.writeUInt32LE(inputTriangles, 80);
  let offset = 84;
  const z = globalControl
    ? (x, y) =>
        0.002 * x * x +
        0.001 * y * y +
        0.2 * Math.sin(0.3 * x) * Math.cos(0.2 * y)
    : (x, y) => 15 * Math.sin(x / 100) * Math.cos(y / 80);
  const emit = (vertices) => {
    bytes.writeFloatLE(1, offset + 8);
    for (let corner = 0; corner < 3; corner++)
      for (let axis = 0; axis < 3; axis++)
        bytes.writeFloatLE(
          vertices[corner][axis],
          offset + 12 + corner * 12 + axis * 4,
        );
    offset += 50;
  };
  for (let y = 0; !sourceFile && y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const x0 = globalControl ? x : (x * 600) / nx,
        x1 = globalControl ? x + 1 : ((x + 1) * 600) / nx;
      const y0 = globalControl ? y : (y * 300) / ny,
        y1 = globalControl ? y + 1 : ((y + 1) * 300) / ny;
      const a = [x0, y0, z(x0, y0)],
        b = [x1, y0, z(x1, y0)],
        c = [x1, y1, z(x1, y1)],
        d = [x0, y1, z(x0, y1)];
      emit([a, b, c]);
      emit([a, c, d]);
    }
  const file = fixturePath;
  await writeFile(file, bytes);
  const inputSha256 = createHash("sha256").update(bytes).digest("hex");
  const rawHash = createHash("sha256"),
    exportHash = createHash("sha256");
  for (let at = 84; at < bytes.length; at += 50) {
    const raw = bytes.subarray(at + 12, at + 48);
    rawHash.update(raw);
    // STLExporter applies the identity world matrix, which normalizes -0 to +0.
    // Canonicalize only that bit pattern; numerical changes still fail separately.
    const canonical = Buffer.from(raw);
    for (let slot = 0; slot < 36; slot += 4)
      if (canonical.readUInt32LE(slot) === 0x80000000)
        canonical.writeUInt32LE(0, slot);
    exportHash.update(canonical);
  }
  const rawSourceGeometrySha256 = rawHash.digest("hex");
  const expectedExportGeometrySha256 = exportHash.digest("hex");
  console.log(
    `Importing ${inputTriangles} triangles; ${sourceFile ?? (globalControl ? "160 x 128 mm frozen curved control" : "600 x 300 mm curved panel")}`,
  );
  await page.locator('input[type=file][accept*=".stl"]').setInputFiles(file);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "large-reduction-panel.stl", exact: true })
    .waitFor({ timeout: 120000 });
  const imported = (await call("project_get")).result;
  const object = imported.objects.find(
    (o) => o.name === "large-reduction-panel.stl",
  );
  assert.equal(object.triangles, inputTriangles);
  const sourceGeometrySha256 = await geometryHash(bytes);
  assert.equal(
    sourceGeometrySha256,
    expectedExportGeometrySha256,
    "Import/export changed coordinates beyond signed-zero normalization",
  );
  assert.equal(
    ledger.importCoordinateDifferences.numericallyDifferent,
    0,
    "Import/export changed numerical coordinates",
  );
  if (globalControl)
    assert.equal(
      sourceGeometrySha256,
      globalFixture.sourceSha256,
      "Imported source differs from frozen global control",
    );
  await page
    .getByRole("button", { name: "large-reduction-panel.stl", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Simplify", exact: true })
    .click({ timeout: 120000 });
  const panel = page.getByRole("region", {
    name: "Reduce polygons",
    exact: true,
  });
  await panel.waitFor();
  await panel.getByRole("button", { name: "Reduce by", exact: true }).click();
  await page
    .getByRole("option", { name: "Percentage remaining", exact: true })
    .click();
  await panel
    .getByRole("spinbutton", { name: "Triangles remaining (%)", exact: true })
    .fill("50");
  const started = performance.now();
  console.log("Starting 50% GUI reduction preview and comparison");
  await panel
    .locator("footer")
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await panel
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 180000 });
  await idle();
  const finishedProgress = (await call("application_inspect")).result.progress
    .scan;
  assert.equal(
    finishedProgress.fraction,
    undefined,
    "Completed GUI preview retained active MCP progress",
  );
  assert.equal(finishedProgress.stage, "");
  assert.equal(
    await panel
      .getByRole("progressbar", { name: "Reduce polygons overall progress" })
      .count(),
    0,
    "Completed preview still renders preparation progress",
  );
  const previewMs = performance.now() - started;
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === object.id)
      .triangles,
    inputTriangles,
    "Preview mutated original",
  );
  assert(
    !(await page
      .getByText("Noise tree exceeds its node budget", { exact: true })
      .count()),
  );
  await page.screenshot({ path: fileURLToPath(new URL("preview.png", out)) });
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await idle();
  assert.equal((await call("project_get")).result.undo, imported.undo);
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "GUI Cancel changed source",
  );
  await page.getByRole("button", { name: "Simplify", exact: true }).click();
  await panel.waitFor();
  await panel.getByRole("button", { name: "Reduce by", exact: true }).click();
  await page
    .getByRole("option", { name: "Percentage remaining", exact: true })
    .click();
  await panel
    .getByRole("spinbutton", { name: "Triangles remaining (%)", exact: true })
    .fill("50");
  await panel
    .locator("footer")
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await panel
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 180000 });
  await idle();
  await panel.getByRole("button", { name: "Accept", exact: true }).click();
  await page.waitForTimeout(200);
  const accepted = (await call("project_get")).result;
  const outputTriangles = accepted.objects.find(
    (o) => o.id === object.id,
  ).triangles;
  assert(
    outputTriangles < inputTriangles &&
      outputTriangles > (residentFixture ? 1000 : 100000),
  );
  assert(
    outputTriangles <= Math.ceil(inputTriangles / 2),
    "Healthy panel missed its requested 50% target",
  );
  console.log(
    `GUI accepted ${outputTriangles} triangles; preview + comparison ${Math.round(previewMs)} ms`,
  );
  const guiGeometrySha256 = await geometryHash();
  if (globalControl)
    assert.equal(
      guiGeometrySha256,
      globalFixture.globalFloat32Sha256,
      "GUI missed frozen whole-input sequence",
    );
  await mutate("history_seek", { index: imported.undo });
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === object.id)
      .triangles,
    inputTriangles,
  );
  const staged = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: object.id,
      operation: { kind: "reducePolygons", mode: "percentage", percentage: 50 },
    }),
  );
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Public preview mutated source",
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  await job(
    await mutate("scan_preview", {
      action: "cancel",
      entityId: object.id,
      previewId: staged.result.previewId,
    }),
  );
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Public preview discard mutated source",
  );
  await page.evaluate(() => {
    window.__holdReductionResult = true;
    window.__pendingReductionResult = false;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: object.id,
    operation: {
      kind: "scanTools",
      operation: { kind: "reducePolygons", mode: "percentage", percentage: 50 },
    },
  });
  await page.waitForFunction(() => window.__pendingReductionResult, null, {
    timeout: 180000,
  });
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdReductionResult = false;
    window.__pendingReductionResult = false;
  });
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Cancelled worker result published geometry",
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  await job(
    await mutate("mesh_process", {
      entityId: object.id,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "reducePolygons",
          mode: "triangles",
          targetTriangles: Math.floor(inputTriangles / 2),
          measureDeviation: true,
          deviation: 0.05,
          paletteThreshold: 0.05,
        },
      },
    }),
  );
  const mcpGeometrySha256 = await geometryHash();
  assert.equal(
    mcpGeometrySha256,
    guiGeometrySha256,
    "GUI and MCP differ on the same source and 50% target",
  );
  await mutate("history_undo", {});
  assert.equal(await geometryHash(), sourceGeometrySha256);
  await mutate("history_redo", {});
  assert.equal(await geometryHash(), guiGeometrySha256);
  const secondStart = performance.now();
  await job(
    await mutate("mesh_process", {
      entityId: object.id,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "reducePolygons",
          mode: "percentage",
          percentage: 90,
          measureDeviation: true,
          deviation: 0.05,
          paletteThreshold: 0.05,
        },
      },
    }),
  );
  const after = (await call("project_get")).result;
  const mcpTriangles = after.objects.find((o) => o.id === object.id).triangles;
  assert(mcpTriangles < outputTriangles);
  assert.equal(after.undo, accepted.undo + 1);
  const finalGeometrySha256 = await geometryHash();
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  assert.equal(
    await geometryHash(),
    finalGeometrySha256,
    "Binary reopen changed reduced coordinates",
  );
  await call("artifact_delete", { artifactId: saved.result.artifactId });
  const stages = await page.evaluate(() => window.__reductionStages);
  assert(
    stages.includes("Collapsing native mesh edges") &&
      !stages.includes("Reducing spatial patches"),
    "Admitted browser reduction did not retain the whole-input sequence",
  );
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    inputTriangles,
    inputSha256,
    cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length,
    systemBytes: totalmem(),
    renderer: "isolated headless browser, software GPU",
    outputTriangles,
    mcpTriangles,
    previewMs,
    mcpMs: performance.now() - secondStart,
    guiPreviewAndAccept: true,
    comparisonRequired: true,
    previewPreservesSource: true,
    mcpDirectComparison: true,
    sameInputGeometryParity: true,
    directCountMatchesGuiPercentage: true,
    globalSequenceObserved: true,
    sourceFile: sourceFile ?? null,
    rawSourceGeometrySha256,
    sourceGeometrySha256,
    frozenGlobalControl: globalControl,
    guiCancelBeforeAccept: true,
    publicPreviewDiscard: true,
    cancelledWorkerResultRollback: true,
    undoRedo: true,
    binarySaveReopen: true,
    finalGeometrySha256,
    guiGeometrySha256,
    mcpGeometrySha256,
    errors,
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
  failed = error;
  throw error;
} finally {
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  if (reserve?.listening)
    await new Promise((resolve) => reserve.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  ledger.cleanup = [];
  for (const resource of ledger.resources) {
    if (resource.pid) {
      let exited = false;
      try {
        process.kill(resource.pid, 0);
      } catch {
        exited = true;
      }
      ledger.cleanup.push({ pid: resource.pid, exited });
      if (!exited)
        failed ??= Error(`Owned helper ${resource.pid} did not exit`);
    }
    if (resource.port) {
      let closed = false;
      try {
        await fetch(`http://127.0.0.1:${resource.port}`, {
          signal: AbortSignal.timeout(1000),
        });
      } catch {
        closed = true;
      }
      ledger.cleanup.push({ port: resource.port, closed });
      if (!closed)
        failed ??= Error(`Owned port ${resource.port} remained open`);
    }
  }
  await unlink(fixturePath).catch((error) => {
    if (error.code !== "ENOENT") failed ??= error;
  });
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("large-reduction-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
