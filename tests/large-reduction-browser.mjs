import assert from "node:assert/strict";
import { freemem, cpus, totalmem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const residentFixture = process.argv.includes("--resident");
const root = new URL("../", import.meta.url),
  out = new URL(
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
      const file = new URL(
        name === "/" ? "index.html" : name.slice(1),
        new URL("dist/", root),
      );
      if (!file.href.startsWith(new URL("dist/", root).href))
        throw Error("Invalid path");
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
  const geometryHash = async () => {
    await idle();
    const exported = (
      await job(await call("project_export", { format: "stl", visible: true }))
    ).result;
    const hash = createHash("sha256");
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
        for (let face = 0; face < data.length; face += 50)
          hash.update(data.subarray(face + 12, face + 48));
        assert.equal(read.nextOffset, at + data.length);
        at = read.nextOffset;
      }
      return hash.digest("hex");
    } finally {
      await call("artifact_delete", { artifactId: exported.artifactId });
    }
  };

  const nx = residentFixture ? 300 : 750,
    ny = residentFixture ? 192 : 768,
    inputTriangles = nx * ny * 2;
  const bytes = Buffer.alloc(84 + inputTriangles * 50);
  bytes.writeUInt32LE(inputTriangles, 80);
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
  for (let y = 0; y < ny; y++)
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
  console.log(
    `Importing ${inputTriangles} triangles; 600 x 300 mm curved panel`,
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
  await mutate("history_seek", { index: imported.undo });
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === object.id)
      .triangles,
    inputTriangles,
  );
  await job(
    await mutate("mesh_process", {
      entityId: object.id,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "reducePolygons",
          mode: "percentage",
          percentage: 50,
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
