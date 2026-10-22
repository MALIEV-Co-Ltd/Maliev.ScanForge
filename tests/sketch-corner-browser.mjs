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
  owner: "scanforge-sketch-corner-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/sketch-corner/", root);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport;
let failed, activePage;
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
  activePage = page;
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
  await mutate("settings_set", {
    patch: { theme: "dark", floorGrid: false, originVisible: false },
  });
  assert(discovered.tools.some((tool) => tool.name === "sketch_corner_trim"));
  const sketch = {
    version: 1,
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 3, y: 0 },
      { id: "c", x: 5, y: 2 },
      { id: "d", x: 5, y: 5 },
    ],
    segments: [
      { id: "horizontal", a: "a", b: "b" },
      { id: "vertical", a: "c", b: "d" },
    ],
    constraints: [],
  };
  await mutate("sketch_manage", {
    action: "create",
    name: "Corner intersection",
    sketch,
  });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const original = (await call("sketch_get")).result.sketch;
  const selection = {
    first: "horizontal",
    second: "vertical",
    firstEnd: "b",
    secondEnd: "a",
  };
  const result = await mutate("sketch_corner_trim", selection);
  assert.deepEqual(result.result, {
    changed: true,
    intersection: [5, 0],
    pointId: "b",
  });
  const expected = (await call("sketch_get")).result.sketch;
  assert.equal(expected.segments[1].a, "b");
  assert.equal(expected.points.length, 3);
  const projectBefore = (await call("project_get")).result;
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, original);
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.getByRole("button", { name: "Join corner", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="c x"]') === null,
  );
  assert.deepEqual(
    (await call("sketch_get")).result.sketch,
    expected,
    "GUI and MCP use the exact same corner edit",
  );
  assert.deepEqual(
    (await call("project_get")).result.history,
    projectBefore.history,
    "sketch editing preserves model history",
  );
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  assert.deepEqual((await call("sketch_get")).result.sketch, original);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, expected);
  const revision = (await call("project_get")).revision;
  assert.equal(
    (await mutate("sketch_corner_trim", selection)).result.changed,
    false,
  );
  assert.equal(
    (await call("project_get")).revision,
    revision,
    "no-op has no revision/history mutation",
  );
  const blocked = {
    ...sketch,
    constraints: [{ id: "fixed-end", kind: "fixed", point: "b", x: 3, y: 0 }],
  };
  await mutate("sketch_set", { sketch: blocked });
  const blockedRevision = (await call("project_get")).revision;
  const failedReply = await client.callTool({
    name: "sketch_corner_trim",
    arguments: {
      ...selection,
      expectedRevision: blockedRevision,
      requestId: randomUUID(),
    },
  });
  const failedWire =
    failedReply.structuredContent ?? JSON.parse(failedReply.content[0].text);
  assert.equal(failedWire.ok, false);
  assert.match(failedWire.error.message, /constrain/i);
  assert.equal((await call("project_get")).revision, blockedRevision);
  assert.deepEqual((await call("sketch_get")).result.sketch, blocked);
  await panel.getByRole("button", { name: "Join corner", exact: true }).click();
  await panel
    .getByRole("alert")
    .filter({ hasText: /constrained geometry/ })
    .waitFor();
  assert.equal((await call("project_get")).revision, blockedRevision);
  assert.deepEqual((await call("sketch_get")).result.sketch, blocked);
  const reversed = {
    ...sketch,
    segments: sketch.segments.map((s) => ({ ...s, a: s.b, b: s.a })),
  };
  await mutate("sketch_set", { sketch: reversed });
  await mutate("sketch_corner_trim", {
    ...selection,
    firstEnd: "a",
    secondEnd: "b",
  });
  const reversedExpected = (await call("sketch_get")).result.sketch;
  await mutate("history_undo", { scope: "sketch" });
  await panel
    .getByRole("button", { name: "First line end", exact: true })
    .click();
  await page.getByRole("option", { name: "Start · a", exact: true }).click();
  await panel
    .getByRole("button", { name: "Second line end", exact: true })
    .click();
  await page.getByRole("option", { name: "End · b", exact: true }).click();
  await panel.getByRole("button", { name: "Join corner", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="c x"]') === null,
  );
  assert.deepEqual(
    (await call("sketch_get")).result.sketch,
    reversedExpected,
    "explicit GUI endpoint options agree with MCP",
  );
  await mutate("sketch_set", { sketch: expected });
  const saved = await job(await call("project_export", { format: "project" }));
  const file = await call("artifact_read", { artifactId: saved.artifactId });
  assert(file.result.eof);
  await writeFile(
    new URL("corner-example.scanforge", artifactDir),
    Buffer.from(file.result.base64, "base64"),
  );
  await mutate("sketch_set", { sketch: original });
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual((await call("sketch_get")).result.sketch, expected);
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  await panel
    .getByRole("button", { name: "Normal to sketch", exact: true })
    .click();
  await page.screenshot({
    path: fileURLToPath(new URL("corner-example.png", artifactDir)),
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "");
  ledger.steps = [
    "official SDK discovery and guarded corner operation",
    "GUI and MCP identical exact endpoint merge",
    "GUI Undo and MCP Redo preserve model history",
    "no-op and constraint rejection preserve revision",
    "project export/reopen retains shared intersection topology",
  ];
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  failed = error;
  if (activePage) {
    await writeFile(
      new URL("failure-dom.txt", artifactDir),
      await activePage.locator("body").innerText(),
    );
    await activePage.screenshot({
      path: fileURLToPath(new URL("failure.png", artifactDir)),
    });
  }
  throw error;
} finally {
  await cleanup();
}
