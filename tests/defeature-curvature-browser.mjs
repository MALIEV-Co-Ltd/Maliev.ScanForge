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
  out = new URL("../.resources/defeature-curvature-browser/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "defeature-curvature-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
function identity(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${pid} | Select-Object Id,Path,@{Name='actualStartedAt';Expression={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(result.status, 0, "Could not record owned process identity");
  return JSON.parse(result.stdout);
}
Object.assign(ledger, identity(process.pid));
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
  client = new Client({ name: "bridge-drag-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...identity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=512",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("defeature-curvature-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__defeatureRequests = [];
    window.__defeatureStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__defeatureStages.push(e.data.stage);
            if (window.__holdResult && (e.data.result || e.data.stage)) {
              if (e.data.result) {
                e.stopImmediatePropagation();
                window.__pendingResult = () =>
                  this.dispatchEvent(
                    new MessageEvent("message", { data: e.data }),
                  );
              } else if (window.__sawProgress) e.stopImmediatePropagation();
              else window.__sawProgress = true;
            }
          });
      }
      postMessage(data, ...args) {
        if (this.processing) window.__defeatureRequests.push(data.kind);
        return super.postMessage(data, ...args);
      }
    };
  });
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

  const artifactJson = async (artifact) => {
    const chunks = [];
    let offset = 0;
    do {
      const wire = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const bytes = Buffer.from(wire.base64, "base64");
      assert(bytes.length > 0);
      chunks.push(bytes);
      offset += bytes.length;
    } while (offset < artifact.bytes);
    return JSON.parse(Buffer.concat(chunks).toString());
  };

  const geometry = async () =>
    artifactJson(
      (await call("object_get", { entityId: "panel", includeGeometry: true }))
        .result.geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  const positions = [],
    selected = [];
  const height = (x, y) => 0.035 * x * x + 0.018 * y * y + 0.012 * x * y;
  const point = (x, y) => [
    x,
    y,
    height(x, y) +
      (Math.abs(x) < 3 && Math.abs(y) < 3 ? 2 + 0.4 * Math.cos(x * y) : 0),
  ];
  for (let y = -8; y < 8; y++)
    for (let x = -8; x < 8; x++) {
      const face = positions.length / 9;
      positions.push(
        ...point(x, y),
        ...point(x + 1, y),
        ...point(x + 1, y + 1),
        ...point(x, y),
        ...point(x + 1, y + 1),
        ...point(x, y + 1),
      );
      if (x >= -3 && x < 3 && y >= -3 && y < 3) selected.push(face, face + 1);
    }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Defeature curvature parity",
    units: "mm",
    entities: [
      {
        id: "panel",
        name: "Curved panel with badge",
        kind: "mesh",
        positions: Array.from(new Float32Array(positions)),
        visible: true,
        color: "#b4bec4",
        opacity: 1,
      },
    ],
  };
  const upload = (
    await call("artifact_put", {
      name: "panel.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(project)).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "panel" });
  await mutate("ui_set", {
    workspace: "mesh",
    mode: "brush",
    toolPanelOpen: true,
  });
  await mutate("viewport_control", {
    action: "camera",
    position: [0, 0, 45],
    target: [0, 0, 0],
    up: [0, 1, 0],
    zoom: 4,
  });
  await mutate("selection_set", { entityId: "panel", triangles: selected });
  const original = await geometry(),
    beforeHistory = await history();
  await page.screenshot({ path: fileURLToPath(new URL("before.png", out)) });
  const canvas = page.locator(".viewport canvas").first(),
    box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // A real brush gesture reveals the contextual Defeature GUI action.
  await page.getByRole("toolbar", { name: "Quick selection tools" }).waitFor();
  const guiSelection = await artifactJson(
    (await call("selection_get", { entityId: "panel" })).result.artifact,
  );
  assert.deepEqual(guiSelection, selected);
  await page.evaluate(() => {
    window.__holdResult = true;
    window.__sawProgress = false;
  });
  await page.getByRole("button", { name: "Defeature", exact: true }).click();
  await page.mouse.move(1000, 450);
  const pointerStatus = page.locator(".pointer-job-status");
  await pointerStatus.waitFor({ state: "visible" });
  assert.equal(await pointerStatus.count(), 1);
  await page.mouse.move(900, 80);
  await pointerStatus.waitFor({ state: "hidden" });
  await page.mouse.move(1000, 450);
  await pointerStatus.waitFor({ state: "visible" });
  await page.waitForFunction(() => !!window.__pendingResult);
  await page.evaluate(() => {
    window.__holdResult = false;
    window.__pendingResult();
  });
  await pointerStatus.waitFor({ state: "detached" });

  for (let i = 0; i < 150 && (await history()) === beforeHistory; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await history(), beforeHistory + 1);
  const gui = await geometry();
  await page.screenshot({ path: fileURLToPath(new URL("after.png", out)) });
  assert.notDeepEqual(gui.positions, original.positions);
  const retained = original.positions.filter(
    (_, i) => !selected.includes(Math.floor(i / 9)),
  );
  assert.deepEqual(gui.positions.slice(0, retained.length), retained);
  let worstDeviation = 0;
  for (let i = retained.length; i < gui.positions.length; i += 3)
    worstDeviation = Math.max(
      worstDeviation,
      Math.abs(
        gui.positions[i + 2] - height(gui.positions[i], gui.positions[i + 1]),
      ),
    );
  assert(worstDeviation < 0.003, `Surface deviation ${worstDeviation}`);
  await mutate("history_undo", {});
  assert.deepEqual((await geometry()).positions, original.positions);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry()).positions, gui.positions);
  await mutate("history_undo", {});
  await mutate("selection_set", { entityId: "panel", triangles: selected });
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      selectionOnly: true,
      operation: { kind: "scanEdit", action: "defeature" },
    }),
  );
  assert.equal(mcp.result.diagnostics.curvaturePatches, 1);
  assert.equal(mcp.result.diagnostics.curvatureFallback, "");
  assert.deepEqual((await geometry()).positions, gui.positions);
  assert.equal(await history(), beforeHistory + 1);
  assert.deepEqual(errors, []);
  ledger.result = {
    defeatureCanvasOnlyStatus: true,
    guiMcpEqual: true,
    undoRedo: true,
    sourcePreserved: true,
    worstDeviation,
    diagnostics: mcp.result.diagnostics,
    pageErrors: errors,
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("defeature-curvature-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
