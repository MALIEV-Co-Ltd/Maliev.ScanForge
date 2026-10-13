import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL("../.resources/indexed-mesh/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "indexed-mesh-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 180000);
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
  client = new Client({ name: "point-cloud-edit-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({ kind: "browser", pid: browserServer.process().pid });
  await writeFile(
    new URL("indexed-mesh-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
  const mutate = async (name, args) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 120; i++) {
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

  const ascii =
    "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n99 99 99\n0 0 1\n2 0 1\n0 2 1\n3 1 2 3\n";
  const geometry = async (entityId) => {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    assert.deepEqual(object.indexedTopology, { vertices: 4, triangles: 1 });
    const artifact = (
      await call("artifact_read", { artifactId: object.geometry.artifactId })
    ).result;
    return JSON.parse(Buffer.from(artifact.base64, "base64").toString());
  };
  const assertTopology = (value) => {
    assert.deepEqual(value.indexedMesh.triangles, [1, 2, 3]);
    for (let slot = 0; slot < 3; slot++)
      for (let axis = 0; axis < 3; axis++)
        assert.equal(
          value.positions[slot * 3 + axis],
          value.indexedMesh.vertices[
            value.indexedMesh.triangles[slot] * 3 + axis
          ],
        );
  };
  await page.locator('input[type="file"][accept*=".asc"]').setInputFiles({
    name: "gui-indexed.ply",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(ascii),
  });
  await page
    .getByRole("dialog", { name: "Import scan" })
    .getByRole("button", { name: "Import", exact: true })
    .click();
  let gui;
  for (let i = 0; i < 100; i++) {
    gui = (await call("project_get")).result.objects.find(
      (object) => object.name === "gui-indexed.ply",
    );
    if (gui) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(gui);
  const guiGeometry = await geometry(gui.id);
  assertTopology(guiGeometry);
  assert.deepEqual(guiGeometry.positions, [-1, -1, 0, 1, -1, 0, -1, 1, 0]);
  const uploaded = (
    await call("artifact_put", {
      name: "mcp-indexed.ply",
      offset: 0,
      base64: Buffer.from(ascii).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: uploaded.artifactId,
      unit: "cm",
    }),
  );
  const imported = (await call("project_get")).result.objects.find(
    (object) => object.name === "mcp-indexed.ply",
  );
  assert(imported);
  const importedGeometry = await geometry(imported.id);
  assertTopology(importedGeometry);
  assert.deepEqual(
    importedGeometry.positions,
    [0, 0, 10, 20, 0, 10, 0, 20, 10],
  );
  await mutate("mesh_transform", {
    entityId: imported.id,
    translation: [1, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert.equal(
    (await call("object_get", { entityId: imported.id })).result
      .indexedTopology,
    undefined,
  );
  await mutate("history_undo", {});
  assertTopology(await geometry(imported.id));
  const saved = (await job(await call("project_export", { format: "project" })))
    .result;
  const data = (await call("artifact_read", { artifactId: saved.artifactId }))
    .result;
  const restoredUpload = (
    await call("artifact_put", {
      name: "indexed.scanforge",
      offset: 0,
      base64: data.base64,
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: restoredUpload.artifactId,
      replace: true,
    }),
  );
  assertTopology(await geometry(imported.id));
  assertTopology(await geometry(gui.id));
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    guiImport: true,
    mcpImport: true,
    unitConversion: true,
    originPlacement: true,
    binaryPersistence: true,
    editInvalidation: true,
    undoRestoration: true,
    errors,
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("indexed-mesh-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
