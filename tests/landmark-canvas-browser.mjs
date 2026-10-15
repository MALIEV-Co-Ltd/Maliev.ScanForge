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
  owner: "scanforge-landmark-canvas-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/landmark-canvas-browser/", root);
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
  failed = Error("Browser validation exceeded 3 minute lease");
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
  async function job(receipt, expected = "succeeded") {
    const id = receipt.result.jobId;
    for (let i = 0; i < 120; i++) {
      const result = await call("job_get", { jobId: id });
      if (result.result.status !== "running") {
        assert.equal(result.result.status, expected, JSON.stringify(result));
        return expected === "succeeded" ? result.result.result : result.result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Geometry job failed to settle");
  }

  const cases = [];
  ledger.cases = cases;
  const rectangle = [
    -20, -20, 0, 0, -20, 0, 0, 20, 0, -20, -20, 0, 0, 20, 0, -20, 20, 0,
  ];
  for (const kind of ["mesh", "pointcloud"]) {
    const sourcePoints =
      kind === "mesh" ? rectangle : [-18, -15, 0, -2, -15, 0, -10, 15, 0];
    const translated = sourcePoints.map((v, i) => (i % 3 === 0 ? v + 40 : v));
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Canvas picks",
      units: "mm",
      entities: [
        {
          id: "moving",
          name: "Moving scan",
          kind,
          positions: sourcePoints,
          visible: true,
          color: "#abcdef",
          opacity: 1,
        },
        {
          id: "fixed",
          name: "Fixed scan",
          kind,
          positions: translated,
          visible: true,
          color: "#fedcba",
          opacity: 1,
        },
      ],
    };
    const upload = await call("artifact_put", {
      name: "canvas.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(project)).toString("base64"),
    });
    await job(
      await mutate("project_import", {
        artifactId: upload.result.artifactId,
        replace: true,
      }),
    );
    await mutate("object_select", { entityId: "moving" });
    const before = (await call("project_get")).result.undo;
    await mutate("landmark_edit", { action: "begin", movingId: "moving" });
    const dialog = page.getByRole("complementary", {
      name: "N-points alignment",
    });
    await dialog.waitFor();
    await mutate("viewport_control", {
      action: "camera",
      position: [0, 0, 160],
      target: [0, 0, 0],
      up: [0, 1, 0],
      projection: "perspective",
      zoom: 1,
    });
    const view = (await call("viewport_get")).result;
    const canvas = page.locator(".viewport > canvas").first();
    const box = await canvas.boundingBox();
    assert(box);
    const halfHeight = 160 * Math.tan((42 * Math.PI) / 360);
    const aspect = view.viewport.width / view.viewport.height;
    const captures = [];
    // Actual pointer event coordinates are read back so browser subpixel rounding
    // cannot make a read-only ray query differ from the click under test.
    await page.evaluate(() => {
      globalThis.__lastCanvasPointer = null;
      document
        .querySelector(".viewport > canvas")
        .addEventListener("pointerup", (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          globalThis.__lastCanvasPointer = {
            x: (e.clientX - r.left) / r.width,
            y: (e.clientY - r.top) / r.height,
          };
        });
    });
    for (const side of ["moving", "fixed"]) {
      await dialog
        .getByRole("button", { name: `Pick ${side} points`, exact: true })
        .click();
      for (const [px, py] of [
        [-18, -15],
        [-2, -15],
        [-10, 15],
      ]) {
        const worldX = px + (side === "fixed" ? 40 : 0);
        const x = 0.5 + worldX / (2 * halfHeight * aspect),
          y = 0.5 - py / (2 * halfHeight);
        await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
        const actual = await page.evaluate(
          () => globalThis.__lastCanvasPointer,
        );
        assert(actual, "Click must reach canvas");
        const hit = (
          await call("viewport_pick", { ...actual, maxHits: 20 })
        ).result.hits.find((h) => h.entityId === side);
        assert(hit, `${kind} ${side} read-only ray must hit`);
        const state = (await call("landmark_get")).result;
        assert.equal(
          state.picks.length,
          captures.length + 1,
          `${kind} ${side} click must append exactly one pick`,
        );
        const pick = state.picks.at(-1);
        assert.equal(pick.entityId, side);
        assert.deepEqual(
          pick.point,
          hit.point.map(Math.fround),
          `${kind}: GUI and MCP must pick the same world point`,
        );
        captures.push({ side, coordinates: actual, hit, pick });
      }
    }
    const state = (await call("landmark_get")).result;
    assert.equal(state.canPreview, true);
    assert.equal((await call("project_get")).result.undo, before);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await call("landmark_get")).result.active, false);
    assert.equal((await call("project_get")).result.undo, before);
    cases.push({ kind, captures });
  }
  ledger.steps = [
    "Actual mesh and point-cloud canvas clicks preserve native Float32 pick records",
    "Moving/fixed pick modes preserve source identity",
    "Read-only MCP ray queries agree with GUI picks",
    "Picking and cancel preserve modeling history",
  ];
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({
    path: fileURLToPath(new URL("browser-validation.png", artifactDir)),
  });
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
