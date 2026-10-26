import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const sourceFile = process.env.SCANFORGE_NOISE_SOURCE;
const iterations = Number(process.env.SCANFORGE_NOISE_ITERATIONS ?? 1);
const comparisonThreshold = Number(
  process.env.SCANFORGE_NOISE_DEVIATION ?? 0.05,
);
const applyBoundaryEdges = process.env.SCANFORGE_NOISE_BOUNDARY !== "false";
const selectionManifest = process.env.SCANFORGE_NOISE_SELECTION_MANIFEST;
const selectionReference = selectionManifest
  ? JSON.parse(await readFile(selectionManifest, "utf8"))
  : process.env.SCANFORGE_NOISE_SELECTION === "replacement64"
    ? JSON.parse(
        await readFile(
          new URL(
            "../docs/evidence/m2-defeature-replacement-20261026.json",
            import.meta.url,
          ),
          "utf8",
        ),
      )
    : undefined;
const selectionOnly = selectionReference !== undefined;
const selectedFaces = selectionReference?.selectedFaceIndices ?? [];
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/noise-input/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = 3072;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Noise replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "noise-input-browser",
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
const fixturePath = fileURLToPath(new URL("noise-input-panel.stl", out));
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 360000);
try {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://127.0.0.1").pathname;
      const file = new URL(
        name === "/" ? "index.html" : name.slice(1),
        builtRoot,
      );
      if (!file.href.startsWith(builtRoot.href)) throw Error("Invalid path");
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
  client = new Client({ name: "noise-input-validation", version: "1" });
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
    new URL("noise-input-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (window.__holdNoiseResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingNoiseResult = true;
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
    throw new Error("Workspace did not settle before noise validation");
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
  const geometryHash = async (checkUnrelated = false) => {
    await idle();
    const exported = (
      await job(await call("project_export", { format: "stl", visible: true }))
    ).result;
    const hash = createHash("sha256");
    let unchangedSlots = 0;
    try {
      // Stream coordinate bytes only; STL headers/normals are export metadata.
      let at = 84;
      while (at < exported.bytes) {
        // Bound concurrent read-only chunks to avoid a bridge round trip per
        // 256 KiB of a million-facet export; consume them in source order.
        const offsets = Array.from(
          { length: Math.min(8, Math.ceil((exported.bytes - at) / 262100)) },
          (_, id) => at + id * 262100,
        );
        const reads = await Promise.all(
          offsets.map(
            async (offset) =>
              (
                await call("artifact_read", {
                  artifactId: exported.artifactId,
                  offset,
                  length: 262100,
                })
              ).result,
          ),
        );
        for (const read of reads) {
          const data = Buffer.from(read.base64, "base64");
          assert(data.length > 0 && data.length % 50 === 0);
          for (let face = 0; face < data.length; face += 50) {
            hash.update(data.subarray(face + 12, face + 48));
            if (checkUnrelated && selectionOnly)
              for (let corner = 0; corner < 3; corner++) {
                const from = face + 12 + corner * 12,
                  expected = at + from;
                if (
                  [0, 1, 2].some(
                    (axis) =>
                      bytes.readFloatLE(expected + axis * 4) <
                        selectionBounds[axis] - 2e-6 ||
                      bytes.readFloatLE(expected + axis * 4) >
                        selectionBounds[axis + 3] + 2e-6,
                  )
                )
                  for (let axis = 0; axis < 3; axis++) {
                    assert.equal(
                      data.readUInt32LE(from + axis * 4),
                      bytes.readUInt32LE(expected + axis * 4),
                      `Unrelated raw corner changed at face ${(at - 84 + face) / 50}, corner ${corner}, axis ${axis}`,
                    );
                    unchangedSlots++;
                  }
              }
          }
          assert.equal(read.nextOffset, at + data.length);
          at = read.nextOffset;
        }
      }
      if (checkUnrelated && selectionOnly) {
        assert(unchangedSlots > 0);
        ledger.unrelatedRawCoordinateSlots = unchangedSlots;
      }
      return hash.digest("hex");
    } finally {
      await call("artifact_delete", { artifactId: exported.artifactId });
    }
  };

  const nx = 712,
    ny = 712;
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
  const z = (x, y) => 15 * Math.sin(x / 100) * Math.cos(y / 80);
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
      const x0 = (x * 600) / nx,
        x1 = ((x + 1) * 600) / nx;
      const y0 = (y * 300) / ny,
        y1 = ((y + 1) * 300) / ny;
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
  const selectionBounds = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  if (selectionOnly) {
    assert.equal(
      inputSha256,
      selectionReference.input.sourceStlSha256,
      "Selection is bound to a different source",
    );
    for (const face of selectedFaces)
      for (let corner = 0; corner < 3; corner++)
        for (let axis = 0; axis < 3; axis++) {
          const v = bytes.readFloatLE(
            84 + face * 50 + 12 + corner * 12 + axis * 4,
          );
          selectionBounds[axis] = Math.min(selectionBounds[axis], v);
          selectionBounds[axis + 3] = Math.max(selectionBounds[axis + 3], v);
        }
  }
  console.log(
    `Importing ${inputTriangles} triangles; ${sourceFile ?? "600 x 300 mm curved panel"}`,
  );
  await page.locator('input[type=file][accept*=".stl"]').setInputFiles(file);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "noise-input-panel.stl", exact: true })
    .waitFor({ timeout: 120000 });
  const imported = (await call("project_get")).result;
  const object = imported.objects.find(
    (o) => o.name === "noise-input-panel.stl",
  );
  assert.equal(object.triangles, inputTriangles);
  const sourceGeometrySha256 = await geometryHash();
  if (selectionOnly && selectionReference.input.sourceCoordinateSha256)
    assert.equal(
      sourceGeometrySha256,
      selectionReference.input.sourceCoordinateSha256,
      "Import changed the bound selected-source coordinates",
    );
  const select = async () => {
    if (selectionOnly)
      await mutate("selection_set", {
        entityId: object.id,
        triangles: selectedFaces,
      });
  };
  await select();
  await page
    .getByRole("button", { name: "noise-input-panel.stl", exact: true })
    .click();

  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Reduce noise", exact: true }).click();
  const panel = page.getByRole("region", { name: "Reduce noise", exact: true });
  await panel.waitFor();
  const measure = panel.getByRole("checkbox", {
    name: "Measure deviation from original",
    exact: true,
  });
  assert(await measure.isEnabled(), "Comparison is selectable before preview");
  await measure.check();
  assert(await measure.isChecked());
  await panel
    .getByRole("spinbutton", { name: "Smooth iterations", exact: true })
    .fill(String(iterations));
  await panel
    .getByRole("checkbox", { name: "Apply to selection only", exact: true })
    .setChecked(selectionOnly);
  await panel
    .getByRole("checkbox", { name: "Smooth boundary edges", exact: true })
    .setChecked(applyBoundaryEdges);
  await panel
    .getByRole("spinbutton", { name: "Comparison threshold (mm)", exact: true })
    .fill(String(comparisonThreshold));
  console.log(
    "Previewing noise reduction with deviation enabled: " +
      inputTriangles +
      " triangles",
  );
  const started = performance.now();
  await panel
    .locator("footer")
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await panel
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 180000 });
  await page
    .getByText(/Original-to-surface comparison:/)
    .first()
    .waitFor({ timeout: 180000 });
  const previewMs = performance.now() - started;
  const guiComparisonSummary = (
    await panel.getByText(/^Original-to-surface comparison:/).innerText()
  ).trim();
  await page.screenshot({ path: fileURLToPath(new URL("preview.png", out)) });
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === object.id)
      .triangles,
    inputTriangles,
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  assert.equal(await geometryHash(), sourceGeometrySha256);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await idle();
  await select();
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "GUI Cancel changed source",
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  await page.getByRole("button", { name: "Reduce noise", exact: true }).click();
  await panel.waitFor();
  await panel
    .getByRole("checkbox", { name: "Apply to selection only", exact: true })
    .setChecked(selectionOnly);
  await panel
    .getByRole("spinbutton", { name: "Smooth iterations", exact: true })
    .fill(String(iterations));
  await panel
    .getByRole("checkbox", { name: "Smooth boundary edges", exact: true })
    .setChecked(applyBoundaryEdges);
  await measure.check();
  await panel
    .getByRole("spinbutton", { name: "Comparison threshold (mm)", exact: true })
    .fill(String(comparisonThreshold));
  await panel
    .locator("footer")
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await panel
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 180000 });
  await panel.getByRole("button", { name: "Accept", exact: true }).click();
  const guiGeometrySha256 = await geometryHash(selectionOnly);
  await mutate("history_seek", { index: imported.undo });
  await select();
  await page.evaluate(() => {
    window.__holdNoiseResult = true;
    window.__pendingNoiseResult = false;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: object.id,
    selectionOnly,
    operation: {
      kind: "scanTools",
      operation: {
        kind: "reduceNoise",
        iterations,
        selectionOnly,
        applyBoundaryEdges,
      },
    },
  });
  await page.waitForFunction(() => window.__pendingNoiseResult, null, {
    timeout: 180000,
  });
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdNoiseResult = false;
    window.__pendingNoiseResult = false;
  });
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Cancelled worker result published geometry",
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  console.log("Replaying identical noise operation through MCP");
  await select();
  const direct = await job(
    await mutate("mesh_process", {
      entityId: object.id,
      selectionOnly,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "reduceNoise",
          iterations,
          selectionOnly,
          measureDeviation: true,
          deviation: comparisonThreshold,
          applyBoundaryEdges,
        },
      },
    }),
  );
  const directComparisonSummary = direct.result.diagnostics.summary;
  ledger.comparisonDiagnostics = {
    gui: guiComparisonSummary,
    direct: directComparisonSummary,
  };
  const comparisonMetrics = (text) => {
    const match = text.match(
      /Original-to-surface comparison:\s*([\d.]+)%\s*\((\d+)\/(\d+)\).*?;\s*(\d+)\s+unmatched/,
    );
    assert(match, "Missing comparison sample metrics: " + text);
    return match.slice(1);
  };
  assert.deepEqual(
    comparisonMetrics(directComparisonSummary),
    comparisonMetrics(guiComparisonSummary),
    "Direct MCP and GUI noise comparison metrics differ",
  );
  const mcpGeometrySha256 = await geometryHash();
  assert.equal(guiGeometrySha256, mcpGeometrySha256);
  await mutate("history_undo", {});
  assert.equal(await geometryHash(), sourceGeometrySha256);
  await mutate("history_redo", {});
  assert.equal(await geometryHash(), guiGeometrySha256);
  await mutate("history_seek", { index: imported.undo });
  await select();
  const discarded = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: object.id,
      operation: {
        kind: "reduceNoise",
        iterations,
        selectionOnly,
        applyBoundaryEdges,
      },
    }),
  );
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Public preview changed source",
  );
  await job(
    await mutate("scan_preview", {
      action: "cancel",
      entityId: object.id,
      previewId: discarded.result.previewId,
    }),
  );
  assert.equal(
    await geometryHash(),
    sourceGeometrySha256,
    "Public preview discard changed source",
  );
  assert.equal((await call("project_get")).result.undo, imported.undo);
  await select();
  const staged = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: object.id,
      operation: {
        kind: "reduceNoise",
        iterations,
        selectionOnly,
        measureDeviation: true,
        deviation: comparisonThreshold,
        applyBoundaryEdges,
      },
    }),
  );
  console.log("Comparing retained output through public scan_preview");
  const compared = await job(
    await mutate("scan_preview", {
      action: "compare",
      entityId: object.id,
      previewId: staged.result.previewId,
      deviation: comparisonThreshold,
    }),
  );
  assert.equal(
    compared.result.diagnostics.summary,
    guiComparisonSummary,
    "GUI and public MCP comparison diagnostics differ",
  );
  await job(
    await mutate("scan_preview", {
      action: "accept",
      entityId: object.id,
      previewId: staged.result.previewId,
    }),
  );
  const previewGeometrySha256 = await geometryHash();
  assert.equal(guiGeometrySha256, previewGeometrySha256);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  assert.equal(
    await geometryHash(),
    guiGeometrySha256,
    "Binary reopen changed noise result",
  );
  await call("artifact_delete", { artifactId: saved.result.artifactId });
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    inputTriangles,
    inputSha256,
    sourceFile: sourceFile ?? null,
    sourceGeometrySha256,
    iterations,
    applyBoundaryEdges,
    comparisonThreshold,
    selectionOnly,
    selectedFaces,
    guiComparisonSummary,
    publicComparisonSummary: compared.result.diagnostics.summary,
    directComparisonSummary,
    comparisonDiagnosticsParity: true,
    previewMs,
    guiGeometrySha256,
    mcpGeometrySha256,
    previewGeometrySha256,
    comparisonBeforePreview: true,
    guiCancelBeforeAccept: true,
    previewSourceHistoryIsolation: true,
    publicPreviewDiscard: true,
    cancelledWorkerResultRollback: true,
    undoRedo: true,
    binarySaveReopen: true,
    errors: [...errors],
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
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
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
    new URL("noise-input-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
