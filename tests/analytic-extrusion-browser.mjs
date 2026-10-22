import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
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
  owner: "scanforge-analytic-extrusion-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/analytic-extrusion/", root);
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
  failed = Error("Browser validation exceeded4minute lease");
  void cleanup();
}, 240000);
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
  page.on("dialog", (dialog) => dialog.accept());
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
  const sketch = {
    version: 1,
    points: [
      { id: "a", x: 2, y: 0 },
      { id: "b", x: -2, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    segments: [],
    arcs: [
      { id: "top", a: "a", b: "b", center: "c", clockwise: false },
      { id: "bottom", a: "b", b: "a", center: "c", clockwise: false },
    ],
    constraints: [],
  };
  const recipe = {
    kind: "extrude",
    profile: { kind: "sketch-curves", sketch },
    height: 10,
  };
  assert(
    discovered.tools.find((t) => t.name === "cad_create").inputSchema.properties
      .recipe,
  );
  const created = await job(
    await mutate("cad_create", { name: "MCP analytic circle", recipe }),
  );
  const mcpRefs = await job(
    await call("alignment_references", { entityId: created.entityIds[0] }),
  );
  assert.equal(
    mcpRefs.references.filter((r) => r.surfaceKind === "cylinder").length,
    2,
  );
  await mutate("sketch_set", { sketch });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.getByLabel("Extrusion height", { exact: true }).fill("10");
  await panel
    .getByRole("button", { name: "Extrude solved profile", exact: true })
    .click();
  let gui;
  for (let i = 0; i < 120; i++) {
    const current = (await call("project_get")).result;
    if (
      current.objects.length === 2 &&
      !(await call("session_get")).result.busy
    ) {
      gui = current;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(gui, "GUI extrusion settled");
  const guiId = gui.objects.find((o) => o.id !== created.entityIds[0]).id;
  const guiRefs = await job(
    await call("alignment_references", { entityId: guiId }),
  );
  const geometry = (refs) =>
    refs.references.map(({ kind, surfaceKind, point, direction, length }) => ({
      kind,
      surfaceKind,
      point,
      direction,
      length,
    }));
  assert.deepEqual(
    geometry(guiRefs),
    geometry(mcpRefs),
    "GUI/MCP exact analytic face descriptors",
  );
  assert.equal(gui.undo, 2, "one history entry per extrusion");
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  await mutate("history_redo", {});
  assert.equal((await call("project_get")).result.objects.length, 2);
  await job(
    await mutate("cad_rebuild", {
      entityId: guiId,
      recipe: { ...recipe, height: 20 },
    }),
  );
  const rebuilt = await job(
    await call("alignment_references", { entityId: guiId }),
  );
  assert.equal(
    rebuilt.references.filter((r) => r.surfaceKind === "cylinder").length,
    2,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "actual SDK discovery and pairing",
    "MCP analytic circle creation",
    "GUI solved-circle extrusion through shared cad_create",
    "identical GUI/MCP exact cylinder/plane descriptors",
    "one history step per body and undo/redo",
    "MCP analytic rebuild",
  ];
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
