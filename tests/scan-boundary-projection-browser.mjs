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
    : new URL("../.resources/boundary-projection/", import.meta.url);
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
    `Boundary replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "boundary-projection-browser",
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
const fixturePath = fileURLToPath(
  new URL("boundary-projection-panel.stl", out),
);
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
  client = new Client({ name: "boundary-projection-validation", version: "1" });
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
    new URL("boundary-projection-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__boundaryMutationRequests = 0;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (window.__holdBoundaryResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingBoundaryResult = true;
            }
          });
      }
      postMessage(data, ...args) {
        if (
          this.processing &&
          data.kind === "scanEdit" &&
          data.action === "boundarySmooth"
        )
          window.__boundaryMutationRequests++;
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
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Workspace did not settle before boundary validation");
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
  const positions = [],
    groups = [];
  for (let n = 1; n <= 3; n++) {
    const part = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = [n * 10 + x, y, 0],
          b = [n * 10 + x + 1, y, 0],
          c = [n * 10 + x + 1, y + 1, 0],
          d = [n * 10 + x, y + 1, 0];
        part.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    groups.push(part);
    positions.push(...part);
  }
  // Retained corners may be near-coincident without being identical.
  groups[2][2] = 2e-7;
  positions.splice(
    groups[0].length + groups[1].length,
    groups[2].length,
    ...groups[2],
  );
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Boundary lifecycle control",
    units: "mm",
    entities: [
      {
        id: "scan",
        name: "Three components",
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
      name: "component-control.json",
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
  await call("artifact_delete", { artifactId: upload.artifactId });
  await mutate("object_select", { entityId: "scan" });
  await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
  await mutate("viewport_control", {
    action: "camera",
    position: [20, 2, 45],
    target: [20, 2, 0],
    up: [0, 1, 0],
    zoom: 1,
  });
  const baseline = (await call("project_get")).result.undo;
  rawEqual(
    await geometry(),
    positions,
    "Import changed original corner records",
  );
  const runEdit = async (operation, expected = "succeeded") =>
    job(
      await mutate("mesh_process", {
        entityId: "scan",
        operation: { kind: "scanEdit", ...operation },
      }),
      expected,
    );
  const inspect = async () =>
    artifactJson((await runEdit({ action: "inventory" })).result.artifact);
  const report = await inspect();
  assert.deepEqual(
    report.inventory.components
      .map((c) => c.triangles.length)
      .sort((a, b) => a - b),
    [2, 8, 18],
  );
  const middle = report.inventory.components.findIndex(
    (c) => c.triangles.length === 8,
  );
  const small = report.inventory.components.findIndex(
    (c) => c.triangles.length === 2,
  );
  assert.equal(report.inventory.components[middle].area, 4);
  assert.equal(
    (await call("project_get")).result.undo,
    baseline,
    "Inventory added history",
  );

  const originalSketch = {
    version: 1,
    frame: { origin: [0, 0, 0], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 2, y: 1 },
    ],
    segments: [{ id: "s", a: "a", b: "b" }],
    constraints: [],
  };
  const original = (
    await mutate("sketch_manage", {
      action: "create",
      name: "Original authoring",
      sketch: originalSketch,
    })
  ).result.sketchId;
  const bank = async () => (await call("sketch_get")).result;
  const controls = page.getByRole("region", {
    name: "Edit boundaries",
    exact: true,
  });
  const open = async () => {
    await mutate("command_run", { name: "ribbon:editScan" });
    if (!(await controls.isVisible()))
      await page
        .getByRole("button", { name: "Edit boundaries", exact: true })
        .click();
    await controls
      .getByRole("button", { name: /Boundary 2 · closed/ })
      .waitFor();
  };
  const selectedBoundary = report.inventory.boundaries.findIndex((b) =>
    b.points.every((v, i) => i % 3 !== 0 || (v >= 20 && v <= 22)),
  );
  assert(selectedBoundary >= 0);
  const normalized = (row) => ({
    name: row.name,
    sketch: row.sketch,
    ...(row.visible === undefined ? {} : { visible: row.visible }),
  });
  const waitBank = async (count) => {
    for (let i = 0; i < 120; i++) {
      const current = await bank();
      if ((current.sketches?.length ?? 0) === count) {
        await idle();
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Boundary sketch publication did not finish");
  };
  const results = [];
  for (const all of [false, true]) {
    const beforeBank = await bank(),
      beforeIds = beforeBank.sketches.map((row) => row.id);
    const history = (await call("project_get")).result.undo;
    await mutate("object_select", { entityId: "scan" });
    await open();
    await controls
      .getByRole("button", {
        name: new RegExp(`Boundary ${selectedBoundary + 1} · closed`),
      })
      .click();
    await controls
      .getByRole("spinbutton", { name: "Fit tolerance (mm)", exact: true })
      .fill("0.05");
    await controls
      .getByRole("button", {
        name: all ? "Project all" : "Project selected",
        exact: true,
      })
      .click();
    const expectedCount = all ? 3 : 1;
    const guiBank = await waitBank(beforeIds.length + expectedCount);
    assert.equal(
      (await call("project_get")).result.undo,
      history + 1,
      "GUI boundary projection has no model-history transaction",
    );
    assert.equal(
      guiBank.activeSketchId,
      beforeBank.activeSketchId,
      "GUI projection changed active authoring owner",
    );
    assert.deepEqual(
      guiBank.sketch,
      beforeBank.sketch,
      "GUI projection replaced active draft",
    );
    const guiRows = guiBank.sketches.filter(
      (row) => !beforeIds.includes(row.id),
    );
    assert.deepEqual(
      guiBank.sketches.filter((row) => beforeIds.includes(row.id)),
      beforeBank.sketches,
    );
    assert.deepEqual(
      guiRows.map((row) => row.name),
      guiRows.map((_, i) => `Projected boundary ${i + 1}`),
    );
    for (const row of guiRows) {
      assert(row.sketch.points.length >= 4);
      assert.equal(
        row.sketch.segments.at(-1).b,
        row.sketch.points[0].id,
        "Projected loop has no shared closing endpoint",
      );
      assert.deepEqual(row.sketch.frame.normal, [0, 0, 1]);
      assert.equal(row.sketch.frame.origin[2], 0);
    }
    rawEqual(await geometry(), positions, "GUI projection changed source mesh");
    await page.screenshot({
      path: fileURLToPath(
        new URL(all ? "all-projected.png" : "selected-projected.png", out),
      ),
    });
    await mutate("history_undo", {});
    assert.deepEqual(
      (await bank()).sketches,
      beforeBank.sketches,
      "Undo changed unrelated saved sketches",
    );
    const later = (
      await mutate("sketch_manage", {
        action: "create",
        name: all ? "Later all" : "Later selected",
        sketch: originalSketch,
      })
    ).result.sketchId;
    await mutate("history_redo", {});
    let state = await bank();
    assert.equal(
      state.activeSketchId,
      later,
      "Redo replaced independent active sketch",
    );
    assert.deepEqual(
      state.sketches.filter((row) => guiRows.some((g) => g.id === row.id)),
      guiRows,
    );
    assert(state.sketches.some((row) => row.id === later));
    await mutate("history_seek", { index: history });
    state = await bank();
    assert(!state.sketches.some((row) => guiRows.some((g) => g.id === row.id)));
    assert(state.sketches.some((row) => row.id === later));
    const mcpBefore = await bank();
    const operation = {
      kind: "scanEdit",
      action: "boundaryProject",
      indices: all
        ? report.inventory.boundaries.map((_, i) => i)
        : [selectedBoundary],
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      fitTolerance: 0.05,
      createSketches: true,
    };
    const request = {
      entityId: "scan",
      operation,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    };
    const receipt = await call("mesh_process", request),
      done = await job(receipt);
    const ids = done.result.sketchIds;
    assert.equal(ids.length, expectedCount);
    const mcpBank = await bank(),
      mcpRows = mcpBank.sketches.filter((row) => ids.includes(row.id));
    assert.deepEqual(
      mcpRows.map(normalized),
      guiRows.map(normalized),
      "GUI/MCP projected sketches differ",
    );
    assert.equal(mcpBank.activeSketchId, mcpBefore.activeSketchId);
    assert.deepEqual(mcpBank.sketch, mcpBefore.sketch);
    assert.deepEqual(
      mcpBank.sketches.filter((row) => !ids.includes(row.id)),
      mcpBefore.sketches,
    );
    rawEqual(await geometry(), positions, "MCP projection changed source");
    const repeated = await call("mesh_process", request);
    assert.equal(
      repeated.result.jobId,
      receipt.result.jobId,
      "Retry created a separate job",
    );
    assert.deepEqual(
      (await bank()).sketches,
      mcpBank.sketches,
      "Retry duplicated sketches",
    );
    for (const createSketches of [undefined, false]) {
      const readonly = { ...operation };
      if (createSketches === undefined) delete readonly.createSketches;
      else readonly.createSketches = false;
      const count = (await call("project_get")).result.undo;
      const read = await runEdit(readonly);
      const curves = await artifactJson(read.result.artifact);
      assert.equal(curves.curves.length, expectedCount);
      assert.deepEqual((await bank()).sketches, mcpBank.sketches);
      assert.equal((await call("project_get")).result.undo, count);
    }
    await mutate("history_undo", {});
    assert.deepEqual((await bank()).sketches, mcpBefore.sketches);
    await mutate("history_redo", {});
    assert.deepEqual((await bank()).sketches, mcpBank.sketches);
    const saved = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: saved.result.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: saved.result.artifactId });
    assert.deepEqual(
      await bank(),
      mcpBank,
      "Binary reopen changed sketch bank or active authoring",
    );
    rawEqual(await geometry(), positions, "Reopen changed source mesh");
    results.push({
      scope: all ? "all" : "selected",
      sketches: expectedCount,
      normalizedSketchSha256: createHash("sha256")
        .update(JSON.stringify(mcpRows.map(normalized)))
        .digest("hex"),
      guiMcpParity: true,
      sourceUnchanged: true,
      closedSharedEndpoints: true,
      authoringIsolation: true,
      ownedHistoryAndSeek: true,
      retryIdempotent: true,
      defaultAndExplicitReadonly: true,
      binarySaveReopen: true,
    });
    await mutate("history_seek", { index: history });
  }
  const beforeCancel = await bank(),
    cancelHistory = (await call("project_get")).result.undo;
  await page.evaluate(() => {
    window.__holdBoundaryResult = true;
    window.__pendingBoundaryResult = false;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: "scan",
    operation: {
      kind: "scanEdit",
      action: "boundaryProject",
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      createSketches: true,
    },
  });
  await page.waitForFunction(() => window.__pendingBoundaryResult);
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdBoundaryResult = false;
  });
  assert.deepEqual(await bank(), beforeCancel);
  assert.equal((await call("project_get")).result.undo, cancelHistory);
  await mutate("object_select", { entityId: "scan" });
  await open();
  await page.evaluate(() => {
    window.__holdBoundaryResult = true;
    window.__pendingBoundaryResult = false;
  });
  await controls
    .getByRole("button", { name: "Project all", exact: true })
    .click();
  await page.waitForFunction(() => window.__pendingBoundaryResult);
  await controls
    .getByRole("button", { name: "Cancel and back", exact: true })
    .click();
  await page.evaluate(() => {
    window.__holdBoundaryResult = false;
  });
  assert.deepEqual(await bank(), beforeCancel);
  assert.equal((await call("project_get")).result.undo, cancelHistory);
  await mutate("object_update", { entityId: "scan", patch: { locked: true } });
  const lockedHistory = (await call("project_get")).result.undo;
  const rejected = await runEdit(
    {
      kind: "scanEdit",
      action: "boundaryProject",
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      createSketches: true,
    },
    "failed",
  );
  assert.match(JSON.stringify(rejected), /lock/i);
  assert.deepEqual(await bank(), beforeCancel);
  assert.equal((await call("project_get")).result.undo, lockedHistory);
  const read = await runEdit({
    kind: "scanEdit",
    action: "boundaryProject",
    plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
  });
  await artifactJson(read.result.artifact);
  rawEqual(
    await geometry(),
    positions,
    "Rejected publication or locked report changed geometry",
  );
  await mutate("object_update", { entityId: "scan", patch: { locked: false } });
  const render = await runEdit({
    kind: "scanEdit",
    action: "boundaryProject",
    plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    fitTolerance: 0.05,
    createSketches: true,
  });
  const renderedIds = render.result.sketchIds;
  assert.equal(renderedIds.length, 3);
  await mutate("object_update", {
    entityId: "scan",
    patch: { visible: false },
  });
  await mutate("ui_set", {
    workspace: "mesh",
    mode: "inspect",
    toolPanelOpen: false,
  });
  const canvas = page.locator(".viewport canvas").first();
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await frames();
  const hiddenCanvas = await canvas.screenshot({
    path: fileURLToPath(new URL("projection-hidden-canvas.png", out)),
  });
  for (const sketchId of renderedIds)
    await mutate("sketch_manage", {
      action: "visibility",
      sketchId,
      visible: true,
    });
  await frames();
  const visibleCanvas = await canvas.screenshot({
    path: fileURLToPath(new URL("projection-visible-canvas.png", out)),
  });
  const hiddenCanvasSha256 = createHash("sha256")
      .update(hiddenCanvas)
      .digest("hex"),
    visibleCanvasSha256 = createHash("sha256")
      .update(visibleCanvas)
      .digest("hex");
  assert.notEqual(
    visibleCanvasSha256,
    hiddenCanvasSha256,
    "Saved boundary sketches did not render after visibility activation",
  );
  assert(
    (await bank()).sketches
      .filter((row) => renderedIds.includes(row.id))
      .every((row) => row.visible === true),
  );
  await page.screenshot({
    path: fileURLToPath(new URL("projection-visible.png", out)),
  });
  const visibleBank = await bank(),
    visibleSave = await job(
      await call("project_export", { format: "project" }),
    );
  await job(
    await mutate("project_import", {
      artifactId: visibleSave.result.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: visibleSave.result.artifactId });
  assert.deepEqual(
    await bank(),
    visibleBank,
    "Reopen changed independent saved-sketch visibility",
  );
  rawEqual(
    await geometry(),
    positions,
    "Visibility replay changed source coordinates",
  );
  assert.deepEqual(errors, []);
  ledger.result = {
    inputCoordinateSha256: digest(positions),
    initialAuthoringId: original,
    cases: results,
    mcpHeldResultCancellation: true,
    guiCancelAndBack: true,
    lockedPublicationRejected: true,
    lockedReadonlyAllowed: true,
    independentSavedVisibilityRendered: true,
    visibleSketchBinaryReopen: true,
    hiddenCanvasSha256,
    visibleCanvasSha256,
    pageErrors: errors,
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
    new URL("boundary-projection-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
