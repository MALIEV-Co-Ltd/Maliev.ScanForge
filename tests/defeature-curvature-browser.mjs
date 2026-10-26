import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const largePatch = process.env.SCANFORGE_DEFEATURE_LARGE === "1";
const replacementDirectory = process.env.SCANFORGE_DEFEATURE_CASE_DIR;
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_DEFEATURE_OUTPUT
    ? pathToFileURL(`${process.env.SCANFORGE_DEFEATURE_OUTPUT}/`)
    : new URL(
        replacementDirectory
          ? "../.resources/defeature-real-scan-browser/"
          : largePatch
            ? "../.resources/defeature-large-browser/"
            : "../.resources/defeature-curvature-browser/",
        import.meta.url,
      );
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
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
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
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
  const mutate = async (name, args) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt, expected = "succeeded") => {
    let lastState;
    for (let i = 0; i < 120; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      lastState = state;
      if (state.status !== "running") {
        assert.equal(state.status, expected, JSON.stringify(state));
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Geometry job timeout: " + JSON.stringify(lastState));
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
  let positions = [],
    selected = [];
  const height = (x, y) =>
    largePatch
      ? 0.001 * x * x + 0.0007 * y * y + 0.0004 * x * y
      : 0.035 * x * x + 0.018 * y * y + 0.012 * x * y;
  const point = (x, y) => [
    x,
    y,
    height(x, y) +
      (Math.abs(x) < (largePatch ? 44 : 3) &&
      Math.abs(y) < (largePatch ? 44 : 3)
        ? largePatch
          ? 2 + 0.3 * Math.cos(x * 0.1) * Math.cos(y * 0.1)
          : 2 + 0.4 * Math.cos(x * y)
        : 0),
  ];
  for (let y = largePatch ? -64 : -8; y < (largePatch ? 64 : 8); y++)
    for (let x = largePatch ? -64 : -8; x < (largePatch ? 64 : 8); x++) {
      const face = positions.length / 9;
      positions.push(
        ...point(x, y),
        ...point(x + 1, y),
        ...point(x + 1, y + 1),
        ...point(x, y),
        ...point(x + 1, y + 1),
        ...point(x, y + 1),
      );
      if (
        x >= (largePatch ? -48 : -3) &&
        x < (largePatch ? 48 : 3) &&
        y >= (largePatch ? -48 : -3) &&
        y < (largePatch ? 48 : 3)
      )
        selected.push(face, face + 1);
    }
  if (largePatch) {
    selected.splice(0, 7);
    assert.equal(selected.length, 18425);
  }
  let replacementManifest;
  if (replacementDirectory) {
    const input = await readFile(`${replacementDirectory}/input.json`);
    const mask = await readFile(`${replacementDirectory}/selection.json`);
    replacementManifest = JSON.parse(
      await readFile(`${replacementDirectory}/manifest.json`, "utf8"),
    );
    assert.equal(
      createHash("sha256").update(input).digest("hex"),
      replacementManifest.inputJsonSha256,
    );
    assert.equal(
      createHash("sha256").update(mask).digest("hex"),
      replacementManifest.selectionSha256,
    );
    const replacement = JSON.parse(input.toString());
    assert.equal(replacement.units, "mm");
    positions = replacement.entities[0].positions;
    selected = JSON.parse(mask.toString());
    assert.equal(positions.length / 9, replacementManifest.inputTriangles);
    assert.equal(selected.length, replacementManifest.selectedFacets);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(new Float32Array(positions).buffer))
        .digest("hex"),
      replacementManifest.sourceCoordinateSha256,
    );
  }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: replacementManifest
      ? "Available-scan Defeature replacement"
      : "Defeature curvature parity",
    units: "mm",
    entities: [
      {
        id: "panel",
        name: replacementManifest
          ? "Original scan-1.stl"
          : "Curved panel with badge",
        kind: "mesh",
        positions: Array.from(new Float32Array(positions)),
        visible: true,
        color: "#b4bec4",
        opacity: 1,
      },
    ],
  };
  const payload = Buffer.from(JSON.stringify(project));
  let upload;
  for (let offset = 0; offset < payload.length; offset += 262144)
    upload = (
      await call("artifact_put", {
        name: "panel.json",
        ...(upload ? { artifactId: upload.artifactId } : {}),
        offset,
        base64: payload.subarray(offset, offset + 262144).toString("base64"),
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
    position: [0, 0, largePatch ? 340 : 45],
    target: [0, 0, 0],
    up: [0, 1, 0],
    zoom: 1,
  });
  await mutate("selection_set", { entityId: "panel", triangles: selected });
  if (replacementManifest) {
    await mutate("viewport_control", {
      action: "fit",
      entityId: "panel",
      selection: true,
    });
    const center = replacementManifest.seedCenter;
    const normal = replacementManifest.seedNormal;
    await mutate("viewport_control", {
      action: "camera",
      target: center,
      position: center.map((value, axis) => value + normal[axis] * 10),
      up: Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0],
    });
    await mutate("scan_selection_control", {
      entityId: "panel",
      action: "configure",
      tool: "brush",
      brushRadiusPx: 2,
    });
  }
  const original = await geometry(),
    beforeHistory = await history();
  const originalTopology = replacementManifest
    ? (await job(await call("mesh_analyze", { entityId: "panel" }))).result
        .topology
    : undefined;
  const beforeViewport = (await call("viewport_get")).result;
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
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const afterViewport = (await call("viewport_get")).result;
  assert.deepEqual(
    afterViewport.cameraWorldMatrix,
    beforeViewport.cameraWorldMatrix,
  );
  assert.deepEqual(
    afterViewport.projectionMatrix,
    beforeViewport.projectionMatrix,
  );
  await page.screenshot({ path: fileURLToPath(new URL("after.png", out)) });
  assert.notDeepEqual(gui.positions, original.positions);
  const retained = original.positions.filter(
    (_, i) => !selected.includes(Math.floor(i / 9)),
  );
  assert.deepEqual(gui.positions.slice(0, retained.length), retained);
  let worstDeviation = replacementManifest ? null : 0;
  for (
    let i = retained.length;
    !replacementManifest && i < gui.positions.length;
    i += 3
  )
    worstDeviation = Math.max(
      worstDeviation,
      Math.abs(
        gui.positions[i + 2] - height(gui.positions[i], gui.positions[i + 1]),
      ),
    );
  if (!replacementManifest)
    assert(worstDeviation < 0.003, `Surface deviation ${worstDeviation}`);
  await mutate("history_undo", {});
  assert.deepEqual((await geometry()).positions, original.positions);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry()).positions, gui.positions);
  await mutate("history_undo", {});
  await mutate("selection_set", { entityId: "panel", triangles: selected });
  await page.evaluate(() => {
    window.__pendingResult = null;
    window.__holdResult = true;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: "panel",
    selectionOnly: true,
    operation: { kind: "scanEdit", action: "defeature" },
  });
  await page.waitForFunction(() => !!window.__pendingResult);
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__pendingResult = null;
    window.__holdResult = false;
  });
  assert.deepEqual((await geometry()).positions, original.positions);
  assert.equal(await history(), beforeHistory);
  await mutate("selection_modify", { entityId: "panel", operation: "all" });
  const rejected = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      selectionOnly: true,
      operation: { kind: "scanEdit", action: "defeature" },
    }),
    "failed",
  );
  assert.match(JSON.stringify(rejected.error), /whole|entire|patch|seam/i);
  assert.deepEqual((await geometry()).positions, original.positions);
  assert.equal(await history(), beforeHistory);
  await mutate("selection_set", { entityId: "panel", triangles: selected });
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      selectionOnly: true,
      operation: { kind: "scanEdit", action: "defeature" },
    }),
  );
  if (!replacementManifest) {
    assert.equal(mcp.result.diagnostics.curvaturePatches, 1);
    assert.equal(mcp.result.diagnostics.curvatureFallback, "");
  }
  assert.deepEqual((await geometry()).positions, gui.positions);
  let replacementTopology;
  if (replacementManifest) {
    replacementTopology = (
      await job(await call("mesh_analyze", { entityId: "panel" }))
    ).result.topology;
    for (const key of [
      "components",
      "boundaryLoops",
      "boundaryEdges",
      "nonManifoldEdges",
      "inconsistentEdges",
    ])
      assert.equal(
        replacementTopology[key],
        originalTopology[key],
        `Real-input topology changed: ${key}`,
      );
    assert.equal(mcp.result.diagnostics.removedTriangles, selected.length);
    assert.equal(mcp.result.diagnostics.prunedTriangles, 0);
  }
  assert.equal(await history(), beforeHistory + 1);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual((await geometry()).positions, gui.positions);
  if (replacementManifest)
    assert.deepEqual(
      (await job(await call("mesh_analyze", { entityId: "panel" }))).result
        .topology,
      replacementTopology,
      "Replacement diagnostics changed after reopening",
    );
  if (largePatch) {
    await mutate("viewport_control", {
      action: "camera",
      position: [180, -150, 160],
      target: [0, 0, 0],
      up: [0, 0, 1],
      zoom: 1,
    });
    await page.screenshot({
      path: fileURLToPath(new URL("after-angled.png", out)),
    });
  }
  assert.deepEqual(errors, []);
  ledger.result = {
    defeatureCanvasOnlyStatus: true,
    largePatch,
    selectedFacets: selected.length,
    manufacturedFailureClassOnly: largePatch,
    replacementManifest,
    originalTopology,
    replacementTopology,
    guiMcpEqual: true,
    outputCoordinateSha256: createHash("sha256")
      .update(Buffer.from(Float32Array.from(gui.positions).buffer))
      .digest("hex"),
    undoRedo: true,
    sourcePreserved: true,
    cancellationRollback: true,
    failureRollback: true,
    saveReopen: true,
    beforeViewport,
    afterViewport,
    worstDeviation,
    diagnostics: mcp.result.diagnostics,
    pageErrors: [...errors],
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("defeature-curvature-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
