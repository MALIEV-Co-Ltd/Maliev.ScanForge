import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const startedAt = new Date().toISOString();
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "scanforge-mcp-browser-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/mcp-integration/", root);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport;
let failed;
const mime = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  wasm: "application/wasm",
  json: "application/json",
  svg: "image/svg+xml",
};
const staticServer = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const file = new URL(
      path === "/" ? "index.html" : path.slice(1),
      new URL("dist/", root),
    );
    if (!file.href.startsWith(new URL("dist/", root).href))
      throw Error("Forbidden path");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        mime[file.pathname.split(".").pop()] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
staticServer.requestTimeout = 10000;
await new Promise((resolve, reject) => {
  staticServer.once("error", reject);
  staticServer.listen(0, "127.0.0.1", resolve);
});
const appPort = staticServer.address().port,
  origin = `http://127.0.0.1:${appPort}`;
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const bridgePort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
ledger.resources.push({
  kind: "http-server",
  pid: process.pid,
  executable: process.execPath,
  startedAt,
  port: appPort,
  bind: "127.0.0.1",
  purpose: "isolated built application",
});
const deadline = setTimeout(() => {
  failed = Error("Browser validation exceeded3minute lease");
  void cleanup();
}, 180000);
async function cleanup() {
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await new Promise((resolve) => {
    staticServer.close(resolve);
    staticServer.closeAllConnections();
  });
  for (const port of [appPort, bridgePort]) {
    let closed = false;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      closed = true;
    }
    ledger.cleanup.push({ port, closed });
    assert(closed, `Port ${port} remained open`);
  }
  for (const resource of ledger.resources.filter((r) =>
    ["mcp-stdio-child", "disposable-browser"].includes(r.kind),
  )) {
    let exited = false;
    try {
      process.kill(resource.pid, 0);
    } catch {
      exited = true;
    }
    ledger.cleanup.push({ pid: resource.pid, exited });
    assert(exited, `${resource.kind} process still alive`);
  }
  await writeFile(
    evidence,
    JSON.stringify(
      { ...ledger, passed: !failed, error: failed?.message },
      null,
      2,
    ),
  );
}
try {
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
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "scanforge-browser-smoke", version: "1.0.0" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-stdio-child",
    pid: transport.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    port: bridgePort,
    bind: "127.0.0.1",
    purpose: "actual stdio SDK and browser bridge",
  });
  const discovered = await client.listTools();
  assert(discovered.tools.length >= 35);
  const guide = await client.readResource({ uri: "scanforge://agent-guide" });
  assert(guide.contents[0].text.includes("expectedRevision"));
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    kind: "disposable-browser",
    pid: browserServer.process().pid,
    executable: "installed Chrome",
    startedAt: new Date().toISOString(),
    purpose: "isolated profile and UI validation",
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
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
  // Closing Settings must leave the paired session alive.
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const wire = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
    return wire;
  }
  async function mutate(name, args) {
    const state = await call("project_get");
    return call(name, {
      ...args,
      expectedRevision: state.revision,
      requestId: randomUUID(),
    });
  }
  async function job(receipt) {
    const id = receipt.result.jobId;
    for (let i = 0; i < 120; i++) {
      const result = await call("job_get", { jobId: id });
      if (result.result.status !== "running") {
        assert.equal(result.result.status, "succeeded", JSON.stringify(result));
        return result.result.result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Geometry job failed to settle");
  }
  const empty = await call("project_get");
  assert.equal(empty.result.objects.length, 0);
  const created = await job(
    await mutate("cad_create", {
      name: "MCP validation box",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [20, 10, 5] },
      },
    }),
  );
  assert.equal(created.entityIds.length, 1);
  await page.getByText("MCP validation box", { exact: true }).first().waitFor();
  const snapshot = await call("project_get");
  assert.equal(snapshot.result.objects.length, 1);
  assert(snapshot.result.objects[0].exactCad);
  // UI undo and MCP redo exercise the same command/history boundary.
  await page.getByRole("tab", { name: "Edit / View", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await call("project_get")).result.objects.length, 0);
  await mutate("history_redo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  const exported = await job(await call("project_export", { format: "step" }));
  const content = await call("artifact_read", {
    artifactId: exported.artifactId,
  });
  assert(
    Buffer.from(content.result.base64, "base64")
      .toString()
      .includes("ISO-10303-21"),
  );
  const saved = await job(await call("project_export", { format: "project" }));
  assert(saved.bytes > 0);
  const copied = await mutate("mesh_copy", { entityId: created.entityIds[0] });
  const meshId = copied.result.entityId;
  const transformed = await mutate("mesh_transform", {
    entityId: meshId,
    translation: [1, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert(transformed.ok);
  const repair = await job(
    await mutate("mesh_process", {
      entityId: meshId,
      operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
      createNew: true,
    }),
  );
  assert(repair.entityIds.length === 1);
  const analyzed = await job(await call("mesh_analyze", { entityId: meshId }));
  assert(analyzed.stats?.triangles > 0 || analyzed.topology?.triangles > 0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  await page.getByText("Disconnected", { exact: true }).waitFor();
  const disconnected = await client.callTool({
    name: "project_get",
    arguments: {},
  });
  assert(disconnected.isError);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "official SDK stdio initialize/tools/resources",
    "browser pairing and persisted connection after Settings closes",
    "exact CAD creation rendered in UI",
    "UI undo and MCP redo",
    "STEP content and project export artifacts",
    "mesh copy/transform/winding worker/topology",
    "disconnect rejects calls",
  ];
  await page.screenshot({
    path: fileURLToPath(new URL("browser-validation.png", artifactDir)),
  });
  console.log(`PASS: ${ledger.steps.join("; ")}`);
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
