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
  owner: "scanforge-mcp-visual-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/mcp-visual/", root);
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
  page.on("dialog", (dialog) => dialog.accept());
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
  const created = await job(
    await mutate("cad_create", {
      name: "Visual verification box",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [20, 10, 5] },
      },
    }),
  );
  await page
    .getByText("Visual verification box", { exact: true })
    .first()
    .waitFor();
  const search = await call("tools_search", {
    query: "screenshot",
    includeSchemas: true,
  });
  assert.equal(search.result.tools[0].name, "screenshot_capture");
  await mutate("project_update", { name: "Visual agent project" });
  assert.equal((await call("project_get")).result.name, "Visual agent project");
  await mutate("viewport_control", {
    action: "fit",
    entityId: created.entityIds[0],
  });
  const framed = await call("viewport_get");
  assert(framed.result.viewport.width > 0);
  assert.equal(framed.result.projection, "orthographic");
  const picked = await call("viewport_pick", { x: 0.5, y: 0.5, maxHits: 1 });
  assert.equal(picked.result.hits[0].entityId, created.entityIds[0]);
  assert.equal(picked.result.units, "mm");
  await mutate("ui_set", { ribbonTab: "view", settingsOpen: true });
  const inspect = await call("application_inspect", { maxControls: 300 });
  assert.equal(inspect.result.ribbonTab, "view");
  assert.equal(inspect.result.settingsOpen, true);
  assert(inspect.result.dialogs.some((value) => value.includes("Settings")));
  assert(!JSON.stringify(inspect).includes(token));
  await page.getByLabel("Pairing token", { exact: true }).evaluate((el) => {
    el.value = "SECRET_INPUT_MUST_NOT_BE_CAPTURED";
  });
  async function capture(scope, format = "png") {
    const response = await client.callTool({
      name: "screenshot_capture",
      arguments: { scope, format, maxWidth: 1440, maxHeight: 1000 },
    });
    assert(!response.isError, JSON.stringify(response.structuredContent));
    const image = response.content.find((item) => item.type === "image");
    assert(image, "No native MCP image");
    const metadata = response.structuredContent.result;
    assert(metadata.image.width > 100);
    assert.equal(metadata.image.scope, scope);
    assert(metadata.image.bytes <= 1048576);
    assert(!JSON.stringify(response.structuredContent).includes(image.data));
    const bytes = Buffer.from(image.data, "base64");
    if (format === "png") assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    else assert.equal(bytes.readUInt16BE(0), 0xffd8);
    const artifact = await call("artifact_read", {
      artifactId: metadata.artifact.artifactId,
      length: 262144,
    });
    const chunk = Buffer.from(artifact.result.base64, "base64");
    assert(chunk.equals(bytes.subarray(0, chunk.length)));
    await writeFile(
      new URL(
        scope + "-" + format + "." + (format === "png" ? "png" : "jpg"),
        artifactDir,
      ),
      bytes,
    );
    return { bytes, image, metadata };
  }
  const full = await capture("application");
  await mutate("ui_set", { settingsOpen: false });
  assert.equal((await call("application_inspect")).result.settingsOpen, false);
  const first = await capture("viewport");
  await mutate("viewport_control", {
    action: "rotate",
    direction: "left",
    degrees: 35,
  });
  const second = await capture("viewport");
  assert(
    !first.bytes.equals(second.bytes),
    "Camera rotation did not change captured pixels",
  );
  await mutate("viewport_control", {
    action: "camera",
    position: [0, -35, 20],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
  });
  assert.equal((await call("viewport_get")).result.projection, "perspective");
  await capture("viewport", "jpeg");
  // Real mouse gestures must match the camera state exposed through MCP.
  const canvas = page.locator("canvas").first();
  const rect = await canvas.boundingBox();
  assert(rect);
  const x = rect.x + rect.width * 0.5,
    y = rect.y + rect.height * 0.5;
  const subtract = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => Math.hypot(...a);
  const closeVector = (a, b) => assert(norm(subtract(a, b)) < 1e-6);
  for (const projection of ["orthographic", "perspective"]) {
    await mutate("viewport_control", { action: "projection", projection });
    await mutate("viewport_control", { action: "fit" });
    const before = (await call("viewport_get")).result;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(x + 70, y + 35, { steps: 12 });
    await page.mouse.up({ button: "right" });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const panned = (await call("viewport_get")).result;
    assert(norm(subtract(panned.target, before.target)) > 0.1);
    closeVector(
      subtract(panned.position, before.position),
      subtract(panned.target, before.target),
    );
    closeVector(panned.up, before.up);
    assert.equal(panned.zoom, before.zoom);
    assert.equal(await page.locator(".app-context-menu").count(), 0);
    // Apply the same pan through the existing semantic API, then compare.
    await mutate("viewport_control", {
      action: "camera",
      position: panned.position,
      target: panned.target,
      up: panned.up,
      projection,
      zoom: panned.zoom,
    });
    const semantic = (await call("viewport_get")).result;
    closeVector(semantic.position, panned.position);
    closeVector(semantic.target, panned.target);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + 50, y + 40, { steps: 12 });
    await page.mouse.up({ button: "middle" });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const rotated = (await call("viewport_get")).result;
    assert(
      norm(
        subtract(
          subtract(rotated.position, rotated.target),
          subtract(panned.position, panned.target),
        ),
      ) > 0.1,
    );
    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".app-context-menu").waitFor();
    await page.keyboard.press("Escape");
  }
  // Approved Fusion-style actions use the same viewport operations in GUI and MCP.
  for (const projection of ["orthographic", "perspective"]) {
    await mutate("viewport_control", { action: "projection", projection });
    await mutate("viewport_control", { action: "fit" });
    const fitted = (await call("viewport_get")).result;
    await mutate("viewport_control", {
      action: "zoomWindow",
      x0: 0.25,
      y0: 0.25,
      x1: 0.75,
      y1: 0.75,
    });
    const zoomed = (await call("viewport_get")).result;
    assert(
      projection === "orthographic"
        ? zoomed.zoom > fitted.zoom
        : norm(subtract(zoomed.position, zoomed.target)) <
            norm(subtract(fitted.position, fitted.target)),
    );
    await page.mouse.dblclick(x, y, { button: "middle", delay: 70 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const doubleFit = (await call("viewport_get")).result;
    closeVector(doubleFit.position, fitted.position);
    closeVector(doubleFit.target, fitted.target);
    assert(Math.abs(doubleFit.zoom - fitted.zoom) < 1e-6);

    await page
      .getByRole("button", { name: "ViewCube settings", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", {
        name: "Constrained orbit (Z up)",
        exact: true,
      })
      .click();
    assert.equal(
      (await call("viewport_get")).result.navigation.orbitMode,
      "constrained",
    );
    const uprightBefore = (await call("viewport_get")).result;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + 110, y + 200, { steps: 18 });
    await page.mouse.up({ button: "middle" });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const upright = (await call("viewport_get")).result;
    assert(upright.up[2] > 0, "Constrained orbit inverted world Z");
    assert(norm(subtract(upright.position, uprightBefore.position)) > 0.1);
    const back = subtract(upright.position, upright.target);
    const horizontalUp = upright.up[0] * back[1] - upright.up[1] * back[0];
    assert(Math.abs(horizontalUp) < 1e-6, "Constrained orbit accumulated roll");
    await mutate("viewport_control", {
      action: "navigation",
      orbitMode: "free",
    });
    await page
      .getByRole("button", { name: "ViewCube settings", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("menuitemradio", { name: "Free orbit", exact: true })
        .getAttribute("aria-checked"),
      "true",
    );
    await page
      .getByRole("menuitemradio", { name: "Free orbit", exact: true })
      .click();

    await mutate("viewport_control", { action: "fit" });
    const beforeWindow = (await call("viewport_get")).result;
    await page
      .getByRole("button", { name: "ViewCube settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Zoom Window", exact: true })
      .click();
    assert.equal(
      (await call("viewport_get")).result.navigation.zoomWindowActive,
      true,
    );
    await page.mouse.move(
      rect.x + rect.width * 0.25,
      rect.y + rect.height * 0.25,
    );
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width * 0.75,
      rect.y + rect.height * 0.75,
      { steps: 12 },
    );
    await page.mouse.up();
    const guiWindow = (await call("viewport_get")).result;
    assert.equal(guiWindow.navigation.zoomWindowActive, false);
    await mutate("viewport_control", {
      action: "camera",
      position: beforeWindow.position,
      target: beforeWindow.target,
      up: beforeWindow.up,
      zoom: beforeWindow.zoom,
      projection,
    });
    const semanticWindow = (
      await mutate("viewport_control", {
        action: "zoomWindow",
        x0: 0.25,
        y0: 0.25,
        x1: 0.75,
        y1: 0.75,
      })
    ).result;
    closeVector(guiWindow.position, semanticWindow.position);
    closeVector(guiWindow.target, semanticWindow.target);
    assert(Math.abs(guiWindow.zoom - semanticWindow.zoom) < 1e-6);
    await mutate("viewport_control", {
      action: "navigation",
      zoomWindowActive: true,
    });
    await page.keyboard.press("Escape");
    const cancelled = (await call("viewport_get")).result;
    assert.equal(cancelled.navigation.zoomWindowActive, false);
    closeVector(cancelled.position, semanticWindow.position);
    closeVector(cancelled.target, semanticWindow.target);
    const badWindow = await client.callTool({
      name: "viewport_control",
      arguments: {
        action: "zoomWindow",
        x0: 0.5,
        y0: 0.5,
        x1: 0.5,
        y1: 0.8,
        expectedRevision: (await call("project_get")).revision,
        requestId: randomUUID(),
      },
    });
    assert.equal(badWindow.structuredContent.ok, false);
    closeVector(
      (await call("viewport_get")).result.position,
      cancelled.position,
    );
  }
  const history = await call("history_get");
  assert(
    history.result.entries.some((entry) => entry.label.includes("Create")),
  );
  const session = await call("session_get");
  assert(
    session.result.artifacts.some(
      (artifact) => artifact.artifactId === full.metadata.artifact.artifactId,
    ),
  );
  await mutate("settings_set", { patch: { normalsDisplay: false } });
  assert.equal(
    (await call("project_get")).result.settings.normalsDisplay,
    false,
  );
  const beforeDiscard = (await call("project_get")).result.objects.length;
  await mutate("preview_discard", { target: "scan" });
  assert.equal(
    (await call("project_get")).result.objects.length,
    beforeDiscard,
  );
  const cloudUpload = await call("artifact_put", {
    name: "visual-cloud.asc",
    offset: 0,
    base64: Buffer.from("100 100 100\n101 100 100\n100 101 100\n").toString(
      "base64",
    ),
  });
  const cloud = await job(
    await mutate("project_import", {
      artifactId: cloudUpload.result.artifactId,
      unit: "mm",
    }),
  );
  await mutate("viewport_control", { action: "fit", entityId: cloud.entityId });
  await mutate("viewport_control", {
    action: "camera",
    position: [100, 100, 110],
    target: [100, 100, 100],
    up: [0, 1, 0],
    projection: "orthographic",
  });
  const cloudPick = await call("viewport_pick", { x: 0.5, y: 0.5, maxHits: 1 });
  assert.equal(cloudPick.result.hits[0].entityId, cloud.entityId);
  assert.equal(cloudPick.result.hits[0].pointIndex, 0);
  assert.equal(cloudPick.result.hits[0].triangleIndex, null);
  await capture("viewport");
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(!stderr.includes(token));
  ledger.steps = [
    "official SDK/native MCP image content",
    "full application and viewport PNG/JPEG capture/artifact readback",
    "visible Settings inspection and secret exclusion",
    "object framing and geometric picking",
    "camera rotation changes image and absolute perspective pose",
    "compact discovery/session recovery/history/project rename",
    "display settings parity",
    "middle double-click fit, world-Z orbit and GUI/MCP rectangle zoom with cancellation in both projections",
    "right drag pans, middle drag rotates, click menu and MCP pose parity in both projections",
  ];
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
