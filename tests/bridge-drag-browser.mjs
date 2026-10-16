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
  out = new URL("../.resources/bridge-drag/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "bridge-drag-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
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
    new URL("bridge-drag-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
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
    const wire = (
      await call("artifact_read", { artifactId: artifact.artifactId })
    ).result;
    return JSON.parse(Buffer.from(wire.base64, "base64").toString());
  };
  const runEdit = async (operation, previewOnly) =>
    (
      await job(
        await mutate("mesh_process", {
          entityId: "rim",
          operation,
          ...(previewOnly ? { previewOnly: true } : {}),
        }),
      )
    ).result;
  const geometry = async () =>
    artifactJson(
      (await call("object_get", { entityId: "rim", includeGeometry: true }))
        .result.geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  const canvas = page.locator(".viewport canvas").first();
  const reports = [];
  for (const curved of [false, true]) {
    const positions = [];
    const point = (i, r) => {
      const a = (i * Math.PI) / 16,
        x = r * Math.cos(a),
        y = r * Math.sin(a);
      return [x, y, curved ? 0.025 * (x * x + y * y) : 0];
    };
    for (let i = 0; i < 32; i++) {
      const a = point(i, 4),
        b = point(i, 5),
        c = point(i + 1, 5),
        d = point(i + 1, 4);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Bridge validation",
      units: "mm",
      entities: [
        {
          id: "rim",
          name: "Bridge rim",
          kind: "mesh",
          positions,
          visible: true,
          color: "#b4bec4",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "bridge.json",
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
    await mutate("object_select", { entityId: "rim" });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    const inventory = await artifactJson(
      (
        await runEdit({
          kind: "scanEdit",
          action: "inventory",
          tolerance: 0.001,
        })
      ).artifact,
    );
    const hole = inventory.inventory.boundaries.findIndex(
      (b) => b.closed && Math.hypot(b.points[0], b.points[1]) < 4.5,
    );
    assert(hole >= 0);
    const boundary = inventory.inventory.boundaries[hole];
    const operation = {
      kind: "scanEdit",
      action: "fillHoles",
      mode: "bridge",
      indices: [hole],
      start: 0,
      end: 16,
      algorithm: "automatic",
      tolerance: 0.001,
    };
    const beforeHistory = await history(),
      original = await geometry();
    const preview = await runEdit(operation, true);
    const patch = await artifactJson(preview.artifact);
    assert.equal(preview.diagnostics.method, curved ? "tangent" : "flat");
    assert.equal(await history(), beforeHistory);
    assert.deepEqual((await geometry()).positions, original.positions);

    await page.getByRole("button", { name: "Edit holes", exact: true }).click();
    console.log("Bridge model ready", { curved, hole });
    // The panel is a labelled section; use its CSS scope where browsers expose no region role.
    const controls = page.locator(".scan-topology-panel");
    await controls
      .getByRole("button", { name: new RegExp(`^Hole ${hole + 1} `) })
      .click();
    await controls.locator(".app-select > button").first().click();
    await page.getByRole("option", { name: "Bridge", exact: true }).click();
    assert.equal(
      await controls.getByRole("spinbutton", { name: "Start vertex" }).count(),
      0,
    );
    await mutate("viewport_control", {
      action: "projection",
      projection: "perspective",
    });
    await mutate("viewport_control", {
      action: "camera",
      position: [0, 0, 22],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    await call("viewport_get");
    console.log("Bridge mode and camera ready");
    const box = await canvas.boundingBox();
    assert(box);
    const screen = (edge) => {
      const count = boundary.points.length / 3,
        j = (edge + 1) % count;
      const p = [0, 1, 2].map(
        (k) => (boundary.points[edge * 3 + k] + boundary.points[j * 3 + k]) / 2,
      );
      const unit =
        box.height / (2 * (22 - p[2]) * Math.tan((21 * Math.PI) / 180));
      return {
        x: box.x + box.width / 2 + p[0] * unit,
        y: box.y + box.height / 2 - p[1] * unit,
      };
    };
    const a = screen(0),
      b = screen(16);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".viewport canvas")?.dataset.bridgePreview,
        ) > 0,
    );
    assert(
      (await controls.getByRole("status").innerText()).includes(
        curved ? "tangent" : "flat",
      ),
    );
    assert.equal(await history(), beforeHistory);
    await page.screenshot({
      path: fileURLToPath(
        new URL(curved ? "tangent-preview.png" : "flat-preview.png", out),
      ),
    });
    // Esc cancels preview and capture, without creating history.
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await history(), beforeHistory);
    assert.equal(await canvas.getAttribute("data-bridge-preview"), "0");
    // Release away from the rim also cancels.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.up();
    assert.equal(await history(), beforeHistory);
    // A valid release accepts the exact generated mesh, in a single Undo step.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".viewport canvas")?.dataset.bridgePreview,
        ) > 0,
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector(".viewport canvas")?.dataset.bridgePreview ===
        "0",
    );
    assert.equal(await history(), beforeHistory + 1);
    const gui = await geometry();
    assert.deepEqual(
      gui.positions.slice(original.positions.length),
      patch.positions,
    );
    await page.keyboard.press("Control+z");
    assert.deepEqual((await geometry()).positions, original.positions);
    await mutate("history_redo", {});
    assert.deepEqual((await geometry()).positions, gui.positions);
    await mutate("history_undo", {});
    await runEdit(operation);
    assert.deepEqual((await geometry()).positions, gui.positions);
    assert.equal(await history(), beforeHistory + 1);
    await page.screenshot({
      path: fileURLToPath(
        new URL(curved ? "tangent-bridge.png" : "flat-bridge.png", out),
      ),
    });
    reports.push({
      method: preview.diagnostics.method,
      triangles: patch.positions.length / 9,
      guiMcpEqual: true,
      undoRedo: true,
      cancel: true,
    });
    await controls.getByRole("button", { name: "Back", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  ledger.result = { reports, pageErrors: errors };
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
    new URL("bridge-drag-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
