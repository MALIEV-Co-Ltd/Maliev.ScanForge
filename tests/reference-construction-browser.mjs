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
  owner: "scanforge-m4-reference-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(
  `.resources/m4-reference-axis/${randomUUID()}/`,
  root,
);
await mkdir(artifactDir, { recursive: true });
ledger.artifactDirectory = fileURLToPath(artifactDir);
console.log("Artifacts:", ledger.artifactDirectory);
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport, page;
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
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => {
    if (errors.length < 20)
      console.error("Browser page error:", error.stack ?? error.message);
    errors.push(error.message);
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

  console.log("paired");
  assert(discovered.tools.some((tool) => tool.name === "reference_construct"));
  const baseline = (await call("project_get")).result;
  assert.equal(baseline.objects.length, 0);
  const preview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "point",
      position: [2, 3, 4],
    })
  ).result;
  assert.equal(preview.active, true);
  assert.deepEqual(preview.geometry.position, [2, 3, 4]);
  assert.equal((await call("project_get")).result.objects.length, 0);
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: preview.sessionId,
    version: preview.version,
  });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference point", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Reference point",
    exact: true,
  });
  await dialog.getByLabel("Position X", { exact: true }).fill("2");
  await dialog.getByLabel("Position Y", { exact: true }).fill("3");
  await dialog.getByLabel("Position Z", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Apply", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"] button:nth-last-child(2)')
        ?.disabled,
  );
  const guiPreview = (await call("reference_construction_get")).result;
  assert.deepEqual(guiPreview.geometry, preview.geometry);
  await page.screenshot({
    path: fileURLToPath(new URL("point-preview.png", artifactDir)),
  });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  console.log("GUI point applied");
  let scene = (await call("project_get")).result;
  assert.equal(scene.objects.length, 1);
  const pointId = scene.objects[0].id;
  const point = (await call("object_get", { entityId: pointId })).result;
  assert(point.reference, JSON.stringify(point));
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 0);
  await mutate("history_redo", {});
  const linePreview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      start: [0, 0, 0],
      end: [10, 0, 0],
      name: "M4 line",
    })
  ).result;
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: linePreview.sessionId,
    version: linePreview.version,
  });
  await page
    .getByRole("button", { name: "Reference axis (finite)", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Reference axis (finite)",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"] button:nth-last-child(2)')
        ?.disabled,
  );
  assert.deepEqual(
    (await call("reference_construction_get")).result.geometry,
    linePreview.geometry,
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const axisObject = (await call("project_get")).result.objects.find(
    (row) => row.name === "Reference axis",
  );
  assert(axisObject);
  assert.equal(axisObject.kind, "referenceLine");
  const lineApplied = { entityId: axisObject.id };
  await mutate("object_rename", {
    entityIds: [axisObject.id],
    name: "M4 line",
  });
  assert.equal((await call("project_get")).result.objects.length, 2);
  console.log("GUI finite axis equals MCP typed line preview and applied");
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  console.log("project reopened");
  scene = (await call("project_get")).result;
  assert.equal(scene.objects.length, 2);
  assert(scene.objects.some((row) => row.id === pointId));
  assert(scene.objects.some((row) => row.id === lineApplied.entityId));
  await mutate("object_select", { entityId: lineApplied.entityId });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  await page
    .getByRole("button", { name: "Edit reference", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference line", exact: true });
  await dialog.getByLabel("End X", { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"] button:nth-last-child(2)')
        ?.disabled,
  );
  assert.equal(
    (await call("reference_construction_get")).result.geometry.length,
    20,
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const afterCancel = (
    await call("object_get", { entityId: lineApplied.entityId })
  ).result;
  assert(afterCancel.reference, JSON.stringify(afterCancel));
  await page.screenshot({
    path: fileURLToPath(new URL("accepted-references.png", artifactDir)),
  });

  const midpointPreview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: lineApplied.entityId,
    })
  ).result;
  assert.deepEqual(midpointPreview.geometry.position, [5, 0, 0]);
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: midpointPreview.sessionId,
    version: midpointPreview.version,
  });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Reference point", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
  await dialog.locator(".app-select > button").first().click();
  await page
    .getByRole("option", { name: "Line midpoint", exact: true })
    .click();
  await dialog.locator(".app-select > button").nth(1).click();
  await page.getByRole("option", { name: "M4 line", exact: true }).click();
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  const guiMidpoint = (await call("reference_construction_get")).result;
  assert.deepEqual(guiMidpoint.geometry, midpointPreview.geometry);
  await page.screenshot({
    path: fileURLToPath(new URL("midpoint-preview.png", artifactDir)),
  });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const midpointId = (await call("project_get")).result.objects.find(
    (row) => row.kind === "referencePoint" && row.id !== pointId,
  ).id;
  const inspectMidpoint = async () =>
    (await call("object_get", { entityId: midpointId })).result.reference;
  assert.equal((await inspectMidpoint()).definition.mode, "center");
  const movedLine = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      entityId: lineApplied.entityId,
      start: [0, 0, 0],
      end: [20, 0, 0],
    })
  ).result;
  const refreshed = await mutate("reference_construct", {
    action: "apply",
    sessionId: movedLine.sessionId,
    version: movedLine.version,
  });
  assert.deepEqual(refreshed.result.refreshedEntityIds, [midpointId]);
  assert.deepEqual((await inspectMidpoint()).geometry.position, [10, 0, 0]);
  await mutate("history_undo", {});
  assert.deepEqual((await inspectMidpoint()).geometry.position, [5, 0, 0]);
  await mutate("history_redo", {});
  assert.deepEqual((await inspectMidpoint()).geometry.position, [10, 0, 0]);
  const midpointArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: midpointArtifact.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual((await inspectMidpoint()).geometry.position, [10, 0, 0]);
  assert.equal(
    (await inspectMidpoint()).sourceBindings[0].status,
    "identity-matched",
  );
  async function rejectMutation(name, args) {
    const state = await call("project_get");
    const reply = await client.callTool({
      name,
      arguments: {
        ...args,
        expectedRevision: state.revision,
        requestId: randomUUID(),
      },
    });
    const wire = reply.structuredContent ?? JSON.parse(reply.content[0].text);
    assert.equal(wire.ok, false, JSON.stringify(wire));
    return wire;
  }
  await rejectMutation("object_delete", { entityId: lineApplied.entityId });
  await mutate("object_update", {
    entityId: midpointId,
    patch: { locked: true },
  });
  const lockedPreview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      entityId: lineApplied.entityId,
      start: [0, 0, 0],
      end: [30, 0, 0],
    })
  ).result;
  await rejectMutation("reference_construct", {
    action: "apply",
    sessionId: lockedPreview.sessionId,
    version: lockedPreview.version,
  });
  assert.equal((await call("reference_construction_get")).result.active, true);
  assert.deepEqual((await inspectMidpoint()).geometry.position, [10, 0, 0]);
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: lockedPreview.sessionId,
    version: lockedPreview.version,
  });
  ledger.midpoint = {
    sourceEntityId: lineApplied.entityId,
    entityId: midpointId,
    guiMcpPreviewEqual: true,
    atomicRefresh: true,
    history: true,
    reopened: true,
    lockedRollback: true,
    deletionRejected: true,
  };
  console.log(
    "GUI/MCP midpoint, source refresh/history/reopen and lock/delete rejection passed",
  );

  await mutate("project_new", { discard: true });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference point", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.screenshot({
    path: fileURLToPath(new URL("cleanup-preview.png", artifactDir)),
  });
  await page.evaluate(() => {
    window.__m4DeleteBuffer = WebGL2RenderingContext.prototype.deleteBuffer;
    WebGL2RenderingContext.prototype.deleteBuffer = function () {
      throw Error("M4 injected buffer retirement failure");
    };
  });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const cleanupState = (await call("reference_construction_get")).result;
  await page.evaluate(() => {
    WebGL2RenderingContext.prototype.deleteBuffer = window.__m4DeleteBuffer;
  });
  assert.equal(cleanupState.cleanupPending, true, JSON.stringify(cleanupState));
  await dialog
    .getByRole("button", { name: "Retry closing preview", exact: true })
    .waitFor({ timeout: 2000 });
  assert.equal((await call("project_get")).result.objects.length, 1);
  await dialog
    .getByRole("button", { name: "Retry closing preview", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await call("project_get")).result.objects.length, 1);
  await mutate("project_new", { discard: true });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference point", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"] button:nth-last-child(2)')
        ?.disabled,
  );
  const expiring = (await call("reference_construction_get")).result;
  await page.clock.install();
  await page.clock.fastForward(61000);
  await dialog.getByLabel("Position X", { exact: true }).fill("7");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"] button:nth-last-child(2)')
        ?.disabled,
    undefined,
    { timeout: 2000 },
  );
  const renewed = (await call("reference_construction_get")).result;
  assert(renewed.active);
  assert.notEqual(renewed.sessionId, expiring.sessionId);
  assert.equal(renewed.geometry.position[0], 7);
  await mutate("project_new", { discard: true });
  await dialog.getByLabel("Position Y", { exact: true }).fill("8");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  const rebound = (await call("reference_construction_get")).result;
  assert(rebound.active);
  assert.notEqual(rebound.sessionId, renewed.sessionId);
  assert.deepEqual(rebound.geometry.position, [7, 8, 0]);
  await mutate("project_new", { discard: true });
  const foreign = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "point",
      position: [9, 9, 9],
    })
  ).result;
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    (await call("reference_construction_get")).result.sessionId,
    foreign.sessionId,
  );
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: foreign.sessionId,
    version: foreign.version,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "actual SDK stdio discovery and pairing",
    "MCP point Preview/Cancel",
    "equal GUI/MCP numeric point preview",
    "GUI Apply and MCP object inspection",
    "MCP Undo/Redo",
    "MCP finite line preview/edit Apply and equal GUI finite-axis creation",
    "actual project worker export/import preserving semantic IDs and history",
    "GUI line edit Preview/Cancel",
    "GUI/MCP stored-line midpoint with atomic source refresh, history, worker reopen and lock/delete rollback",
    "rendered WebGL screenshots and clean page errors",
    "injected WebGL retirement failure retains applied dialog and owner-scoped cleanup retry",
    "GUI expiry/invalidation restart preserves coordinates and foreign preview ownership",
  ];
  console.log(`PASS: ${ledger.steps.join("; ")}`);
} catch (error) {
  failed = error;
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", artifactDir)) })
      .catch(() => {});
    await writeFile(
      new URL("failure-state.txt", artifactDir),
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await cleanup();
}
