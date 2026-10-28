import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/split-lifecycle/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = 1536;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Split replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "split-lifecycle-browser",
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
const fixturePath = fileURLToPath(new URL("split-lifecycle-panel.stl", out));
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
        builtRoot,
      );
      if (!file.href.startsWith(builtRoot.href)) throw Error("Invalid path");
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
  client = new Client({ name: "split-lifecycle-validation", version: "1" });
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
      "--js-flags=--max-old-space-size=768",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (window.__holdSplitResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingSplitResult = true;
            }
          });
      }
    };
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
    throw new Error("Workspace did not settle before split validation");
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

  const artifactJson = async (artifact) => {
    const chunks = [];
    for (let offset = 0; offset < artifact.bytes;) {
      const read = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const chunk = Buffer.from(read.base64, "base64");
      assert(chunk.length > 0);
      chunks.push(chunk);
      offset += chunk.length;
    }
    await call("artifact_delete", { artifactId: artifact.artifactId });
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const geometry = async (entityId = "scan") => {
    await idle();
    return (
      await artifactJson(
        (await call("object_get", { entityId, includeGeometry: true })).result
          .geometry,
      )
    ).positions;
  };
  const digest = (positions) =>
    createHash("sha256")
      .update(Buffer.from(new Float32Array(positions).buffer))
      .digest("hex");
  const rawEqual = (actual, expected, message) =>
    assert.equal(digest(actual), digest(expected), message);

  const sourceId = "scan",
    cutterId = "cutter";
  const folded = process.env.SCANFORGE_FOLDED_CONTROL === "1";
  const precision = process.env.SCANFORGE_PRECISION_CONTROL === "1";
  assert(!(folded && precision));
  const source = precision
    ? [100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0]
    : folded
      ? [
          -0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 1.5, 0, -0.5, -0.5, 0, 1.5, 1.5, 0,
          -0.5, 1.5, 0,
        ]
      : [0, 0, 0, 2, 0, 0, 0, 2, 0];
  const target = precision
    ? [100000004, -100, -10, 100000004, 100, -10, 100000004, 0, 100]
    : folded
      ? [
          0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1,
          1, 1, -1, 1, 1, 1, 0, 1, -1, 1, 1, 1, 0, 1, 1,
        ]
      : [1, -2, -1, 1, 4, -1, 1, -2, 3];
  const expectedParts = folded ? 1 : 2;
  const load = async () => {
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Single mesh split",
      units: "mm",
      entities: [
        {
          id: sourceId,
          name: "Split source",
          kind: "mesh",
          positions: source,
          color: "#d24d57",
          opacity: 1,
          visible: true,
        },
        {
          id: cutterId,
          name: "Cutter mesh",
          kind: "mesh",
          positions: target,
          color: "#728a99",
          opacity: 0.35,
          visible: true,
        },
      ],
    };
    const uploaded = (
      await call("artifact_put", {
        name: "single-split.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(project)).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: uploaded.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: uploaded.artifactId });
    await mutate("object_select", { entityId: sourceId });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    await mutate("viewport_control", {
      action: "camera",
      position: precision ? [100000000, 8, 60] : [0.5, 1, 10],
      target: precision ? [100000000, 8, 0] : [0.5, 1, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    return (await call("project_get")).result.undo;
  };
  const checkState = async () => {
    const state = (await call("project_get")).result;
    assert.equal(state.objects.length, 2);
    assert.equal(state.objects.find((o) => o.id === sourceId).visible, true);
    assert.equal(state.objects.find((o) => o.id === cutterId).visible, true);
    assert.deepEqual(await geometry(cutterId), target, "Cutter changed");
    return state;
  };
  const checkInventory = async () => {
    const report = await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        operation: { kind: "scanEdit", action: "inventory" },
      }),
    );
    const data = await artifactJson(report.result.artifact);
    assert.equal(
      data.inventory.components.length,
      expectedParts,
      "Indexed cut components were not retained",
    );
  };
  const baseline = await load();
  assert((await page.title()).length > 0);
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  await mutate("command_run", { name: "ribbon:splitMesh" });
  const panel = page.getByRole("region", { name: "Split mesh", exact: true });
  await panel.waitFor();
  await panel.locator(".app-select > button").click();
  await page.getByRole("option", { name: "Cutter mesh", exact: true }).click();
  await panel.getByRole("button", { name: "Split mesh", exact: true }).click();
  let guiState;
  for (let i = 0; i < 200; i++) {
    await idle();
    guiState = (await call("project_get")).result;
    if (guiState.undo > baseline) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(guiState.undo, baseline + 1, "GUI Split did not commit");
  await checkState();
  const gui = await geometry(sourceId);
  let precisionHit;
  assert(gui.length > source.length, "GUI did not refine source");
  if (precision) {
    assert(gui.includes(100000004), "Precise intersection was rounded");
    let doubledArea = 0;
    for (let i = 0; i < gui.length; i += 9)
      doubledArea +=
        (gui[i + 3] - gui[i]) * (gui[i + 7] - gui[i + 1]) -
        (gui[i + 4] - gui[i + 1]) * (gui[i + 6] - gui[i]);
    assert(Math.abs(doubledArea - 192) < 1e-8, `Area changed: ${doubledArea}`);
    await mutate("viewport_control", {
      action: "camera",
      position: [100000002, 8, 60],
      target: [100000002, 8, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    const picks = (await call("viewport_pick", { x: 0.5, y: 0.5, maxHits: 20 }))
      .result.hits;
    const hit = picks.find((entry) => entry.entityId === sourceId);
    assert(hit, `Precise source was not picked: ${JSON.stringify(picks)}`);
    assert(
      Math.abs(hit.point[0] - 100000002) < 0.001 &&
        Math.abs(hit.point[1] - 8) < 0.001 &&
        Math.abs(hit.point[2]) < 0.001,
      `Wrong world hit: ${JSON.stringify(hit)}`,
    );
    precisionHit = hit.point;
  }
  await checkInventory();
  await page.screenshot({
    path: fileURLToPath(new URL("single-split-gui.png", out)),
  });
  if (precision) {
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await mutate("object_select", { entityId: cutterId });
    const canvas = await page.locator(".viewport canvas").first().boundingBox();
    assert(canvas, "Viewport canvas is missing");
    await page.mouse.click(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await idle();
    assert.equal(
      (await call("project_get")).result.selectedId,
      sourceId,
      "Canvas did not select the precise source",
    );
    await page.screenshot({
      path: fileURLToPath(new URL("precision-canvas-selected.png", out)),
    });
  }
  await mutate("history_undo", {});
  rawEqual(await geometry(sourceId), source, "GUI Undo did not restore source");
  await mutate("history_redo", {});
  assert.deepEqual(await geometry(sourceId), gui, "GUI Redo changed output");
  await load();
  const done = await job(
    await mutate("mesh_process", {
      entityId: sourceId,
      targetId: cutterId,
      operation: { kind: "scanEdit", action: "split" },
    }),
  );
  assert.deepEqual(done.result.entityIds, [sourceId]);
  assert.equal(done.result.diagnostics.parts, expectedParts);
  await checkState();
  assert.deepEqual(
    await geometry(sourceId),
    gui,
    "GUI and MCP geometry differ",
  );
  await mutate("history_undo", {});
  rawEqual(await geometry(sourceId), source, "MCP Undo did not restore source");
  await mutate("history_redo", {});
  assert.deepEqual(await geometry(sourceId), gui, "MCP Redo changed output");
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: saved.result.artifactId });
  await checkState();
  assert.deepEqual(await geometry(sourceId), gui, "Reopen changed output");
  await checkInventory();
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  ledger.result = {
    sourceFaces: source.length / 9,
    outputFaces: gui.length / 9,
    parts: done.result.diagnostics.parts,
    guiMcpGeometryEqual: true,
    undoRedo: true,
    saveReopen: true,
    ...(precision ? { precisionHit, canvasSelectedSource: true } : {}),
    pageErrors: errors,
    consoleErrors,
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
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
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
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
