import { PerspectiveCamera, Vector3 } from "three";
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

  // Independent MCP source intents are compared with actual GUI source selectors.
  await mutate("object_update", {
    entityId: pointId,
    patch: { name: "M4 source point" },
  });
  const planes = [];
  for (const [name, origin, normal, xDirection] of [
    ["Derived PX", [2, 0, 0], [1, 0, 0], [0, 1, 0]],
    ["Derived PY", [0, 3, 0], [0, 1, 0], [0, 0, 1]],
    ["Derived PZ", [0, 0, 4], [0, 0, 1], [1, 0, 0]],
  ])
    planes.push(
      (
        await mutate("datum_construct", {
          kind: "plane",
          name,
          origin,
          normal,
          xDirection,
          displaySize: 10,
        })
      ).result.entityId,
    );
  ledger.derivedPoints = [];
  for (const [mode, label, ids, names, expected] of [
    [
      "center",
      "Primitive center",
      [pointId, lineApplied.entityId],
      ["M4 source point", "M4 line"],
      null,
    ],
    [
      "pair",
      "Two primitives",
      [pointId, lineApplied.entityId],
      ["M4 source point", "M4 line"],
      [2, 0, 0],
    ],
    [
      "threePlanes",
      "Three planes",
      planes,
      ["Derived PX", "Derived PY", "Derived PZ"],
      [2, 3, 4],
    ],
  ]) {
    const rows = (
      await call("reference_construction_sources", {
        kind: "point",
        mode,
        limit: 100,
      })
    ).result.sources;
    for (const id of ids)
      assert(rows.some((row) => row.entityId === id && row.eligible));
    const independent = (
      await mutate("reference_construct", {
        action: "preview",
        kind: "point",
        mode,
        sourceEntityIds: ids,
      })
    ).result;
    if (expected) assert.deepEqual(independent.geometry.position, expected);
    await mutate("reference_construct", {
      action: "cancel",
      sessionId: independent.sessionId,
      version: independent.version,
    });
    const oldIds = new Set(
      (await call("project_get")).result.objects.map((row) => row.id),
    );
    await page.getByRole("tab", { name: "Construct", exact: true }).click();
    await page
      .getByRole("group", { name: "Primitives", exact: true })
      .getByRole("button", { name: "Reference point", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
    await dialog.locator(".app-select > button").first().click();
    await page.getByRole("option", { name: label, exact: true }).click();
    for (let i = 0; i < names.length; i++) {
      await dialog
        .locator(".app-select > button")
        .nth(i + 1)
        .click();
      await page.getByRole("option", { name: names[i], exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="dialog"] .button-row:last-child button:nth-child(2)',
        )?.disabled,
    );
    const actual = (await call("reference_construction_get")).result;
    assert.deepEqual(actual.geometry, independent.geometry);
    assert.deepEqual(actual.definition, independent.definition);
    await page.screenshot({
      path: fileURLToPath(new URL(`derived-${mode}-preview.png`, artifactDir)),
    });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const id = (await call("project_get")).result.objects.find(
      (row) => !oldIds.has(row.id),
    ).id;
    const stored = (await call("object_get", { entityId: id })).result
      .reference;
    assert.deepEqual(stored.definition, independent.definition);
    assert.deepEqual(stored.geometry, independent.geometry);
    await mutate("object_select", { entityId: id });
    await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
    await page
      .getByRole("button", { name: "Edit reference", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
    assert.equal(await dialog.locator("select").first().inputValue(), mode);
    const retained = await dialog.locator("select").evaluateAll((selects) =>
      selects
        .slice(1)
        .map((select) => select.value)
        .filter(Boolean),
    );
    assert.deepEqual(
      retained,
      stored.definition.sources.map((source) => source.id),
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    ledger.derivedPoints.push({
      mode,
      entityId: id,
      sourceIds: ids,
      guiMcpPreviewEqual: true,
      geometry: stored.geometry,
      editRetainedSources: true,
    });
  }
  const threePoint = ledger.derivedPoints.find(
    (row) => row.mode === "threePlanes",
  );
  const threeGeometry = async () =>
    (await call("object_get", { entityId: threePoint.entityId })).result
      .reference.geometry.position;
  await mutate("datum_construct", {
    kind: "plane",
    entityId: planes[0],
    origin: [7, 0, 0],
    normal: [1, 0, 0],
    xDirection: [0, 1, 0],
    displaySize: 10,
  });
  assert.deepEqual(await threeGeometry(), [7, 3, 4]);
  await mutate("history_undo", {});
  assert.deepEqual(await threeGeometry(), [2, 3, 4]);
  await mutate("history_redo", {});
  assert.deepEqual(await threeGeometry(), [7, 3, 4]);
  const derivedArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: derivedArtifact.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await threeGeometry(), [7, 3, 4]);
  ledger.derivedSourceEditHistoryReopen = true;
  console.log(
    "Derived point GUI/public MCP, retained selectors, plane-source edit/history/reopen passed",
  );

  // Located line records retain order/repetitions independently of dependencies.
  const extraLinePreview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      start: [0, 4, 0],
      end: [10, 4, 0],
      name: "Average source",
    })
  ).result;
  const extraLine = (
    await mutate("reference_construct", {
      action: "apply",
      sessionId: extraLinePreview.sessionId,
      version: extraLinePreview.version,
    })
  ).result.entityId;
  const sourcePointName = (await call("object_get", { entityId: pointId }))
    .result.name;
  ledger.derivedLines = [];
  for (const [mode, label, picks, names] of [
    [
      "pair",
      "Two primitives",
      [
        { entityId: pointId },
        { entityId: lineApplied.entityId, parameter: 0.25 },
      ],
      [sourcePointName, "M4 line"],
    ],
    [
      "average",
      "Average lines",
      [
        { entityId: lineApplied.entityId, parameter: 0.25 },
        { entityId: extraLine, parameter: 0.75 },
        { entityId: lineApplied.entityId, parameter: 0.25 },
      ],
      ["M4 line", "Average source", "M4 line"],
    ],
  ]) {
    const seed = (
      await mutate("reference_construct", {
        action: "preview",
        kind: "line",
        start: [0, 0, 0],
        end: [10, 0, 0],
      })
    ).result;
    const independent = (
      await mutate("reference_construct", {
        action: "preview",
        kind: "line",
        mode,
        sourcePicks: picks,
        sessionId: seed.sessionId,
        version: seed.version,
      })
    ).result;
    await mutate("reference_construct", {
      action: "cancel",
      sessionId: independent.sessionId,
      version: independent.version,
    });
    const oldIds = new Set(
      (await call("project_get")).result.objects.map((row) => row.id),
    );
    await page.getByRole("tab", { name: "Construct", exact: true }).click();
    await page
      .getByRole("group", { name: "Primitives", exact: true })
      .getByRole("button", { name: "Reference line", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Reference line", exact: true });
    for (const [field, value] of [
      ["Start X", 0],
      ["Start Y", 0],
      ["Start Z", 0],
      ["End X", 10],
      ["End Y", 0],
      ["End Z", 0],
    ])
      await dialog.getByLabel(field, { exact: true }).fill(String(value));
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="dialog"] .button-row:last-child button:nth-child(2)',
        )?.disabled,
    );
    await dialog.locator(".app-select > button").first().click();
    await page.getByRole("option", { name: label, exact: true }).click();
    if (picks.length > 2)
      await dialog
        .getByRole("button", { name: "Add source", exact: true })
        .click();
    for (let i = 0; i < picks.length; i++) {
      await dialog
        .locator(".app-select > button")
        .nth(i + 1)
        .click();
      await page.getByRole("option", { name: names[i], exact: true }).click();
      if (picks[i].parameter !== undefined)
        await dialog
          .getByLabel(`Source ${i + 1} fraction`, { exact: true })
          .fill(String(picks[i].parameter));
    }
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="dialog"] .button-row:last-child button:nth-child(2)',
        )?.disabled,
    );
    const actual = (await call("reference_construction_get")).result;
    assert.deepEqual(actual.geometryEncoding, independent.geometryEncoding);
    assert.deepEqual(actual.definition, independent.definition);
    await page.screenshot({
      path: fileURLToPath(new URL(`line-${mode}-preview.png`, artifactDir)),
    });
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const id = (await call("project_get")).result.objects.find(
      (row) => !oldIds.has(row.id),
    ).id;
    const stored = (await call("object_get", { entityId: id })).result
      .reference;
    assert.deepEqual(stored.geometryEncoding, independent.geometryEncoding);
    await mutate("object_select", { entityId: id });
    await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
    await page
      .getByRole("button", { name: "Edit reference", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Reference line", exact: true });
    const retained = await dialog
      .locator("select")
      .evaluateAll((selects) => selects.slice(1).map((select) => select.value));
    assert.deepEqual(
      retained,
      picks.map((pick) => pick.entityId),
    );
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="dialog"] .button-row:last-child button:nth-child(2)',
        )?.disabled,
    );
    assert.deepEqual(
      (await call("reference_construction_get")).result.geometryEncoding,
      stored.geometryEncoding,
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    ledger.derivedLines.push({
      mode,
      entityId: id,
      geometryEncoding: stored.geometryEncoding,
      definition: stored.definition,
      guiMcpEqual: true,
      retainedEditCancel: true,
    });
  }
  const lineArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: lineArtifact.artifactId,
      replace: true,
    }),
  );
  for (const row of ledger.derivedLines) {
    const stored = (await call("object_get", { entityId: row.entityId })).result
      .reference;
    assert.deepEqual(stored.geometryEncoding, row.geometryEncoding);
    assert.deepEqual(stored.definition, row.definition);
  }
  console.log(
    "Pair/average GUI/public MCP, repeated retained records, edit Cancel and worker reopen passed",
  );

  const primitiveIds = {};
  for (const [key, name, input] of [
    [
      "sphere",
      "Analytic sphere source",
      { kind: "sphere", center: [2, 3, 4], radius: 2 },
    ],
    [
      "cylinder",
      "Analytic cylinder source",
      {
        kind: "cylinder",
        center: [0, 5, 0],
        axis: [1, 0, 0],
        radius: 1,
        height: 10,
      },
    ],
    [
      "second",
      "Second cylinder source",
      {
        kind: "cylinder",
        center: [0, 9, 0],
        axis: [1, 0, 0],
        radius: 1,
        height: 10,
      },
    ],
  ]) {
    primitiveIds[key] = (
      await job(
        await mutate("cad_create", {
          name,
          recipe: { kind: "primitive", input },
        }),
      )
    ).entityIds[0];
  }
  await mutate("object_update", {
    entityId: primitiveIds.sphere,
    patch: { locked: true },
  });
  ledger.analyticSources = [];
  for (const [key, name, expected] of [
    ["sphere", "Analytic sphere source", [2, 3, 4]],
    ["cylinder", "Analytic cylinder source", [0, 5, 0]],
  ]) {
    const sourceId = primitiveIds[key];
    const independent = (
      await mutate("reference_construct", {
        action: "preview",
        kind: "point",
        mode: "center",
        sourceEntityIds: [sourceId],
      })
    ).result;
    assert.deepEqual(independent.geometry.position, expected);
    await mutate("reference_construct", {
      action: "cancel",
      sessionId: independent.sessionId,
      version: independent.version,
    });
    const oldIds = new Set(
      (await call("project_get")).result.objects.map((row) => row.id),
    );
    await page.getByRole("tab", { name: "Construct", exact: true }).click();
    await page
      .getByRole("group", { name: "Primitives", exact: true })
      .getByRole("button", { name: "Reference point", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
    await dialog.locator(".app-select > button").first().click();
    await page
      .getByRole("option", { name: "Primitive center", exact: true })
      .click();
    await dialog.locator(".app-select > button").nth(1).click();
    await page.getByRole("option", { name, exact: true }).click();
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="dialog"] .button-row:last-child button:nth-child(2)',
        )?.disabled,
    );
    assert.deepEqual(
      (await call("reference_construction_get")).result.geometryEncoding,
      independent.geometryEncoding,
    );
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const entityId = (await call("project_get")).result.objects.find(
      (row) => !oldIds.has(row.id),
    ).id;
    assert.deepEqual(
      (await call("object_get", { entityId })).result.reference.definition,
      independent.definition,
    );
    ledger.analyticSources.push({ key, entityId, sourceId, guiMcpEqual: true });
  }
  const seedAxis = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      start: [0, 0, 0],
      end: [10, 0, 0],
    })
  ).result;
  const axisPicks = [
    { entityId: primitiveIds.cylinder, parameter: 0.25 },
    { entityId: primitiveIds.second, parameter: 0.75 },
  ];
  const independentAxis = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      mode: "average",
      sourcePicks: axisPicks,
      sessionId: seedAxis.sessionId,
      version: seedAxis.version,
    })
  ).result;
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: independentAxis.sessionId,
    version: independentAxis.version,
  });
  const oldAnalyticIds = new Set(
    (await call("project_get")).result.objects.map((row) => row.id),
  );
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Reference line", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference line", exact: true });
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[role="dialog"] .button-row:last-child button:nth-child(2)',
      )?.disabled,
  );
  await dialog.locator(".app-select > button").first().click();
  await page
    .getByRole("option", { name: "Average lines", exact: true })
    .click();
  for (const [index, name, parameter] of [
    [0, "Analytic cylinder source", 0.25],
    [1, "Second cylinder source", 0.75],
  ]) {
    await dialog
      .locator(".app-select > button")
      .nth(index + 1)
      .click();
    await page.getByRole("option", { name, exact: true }).click();
    await dialog
      .getByLabel(`Source ${index + 1} fraction`, { exact: true })
      .fill(String(parameter));
  }
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[role="dialog"] .button-row:last-child button:nth-child(2)',
      )?.disabled,
  );
  assert.deepEqual(
    (await call("reference_construction_get")).result.geometryEncoding,
    independentAxis.geometryEncoding,
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const analyticAxisId = (await call("project_get")).result.objects.find(
    (row) => !oldAnalyticIds.has(row.id),
  ).id;
  const followerPreview = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: [analyticAxisId],
    })
  ).result;
  const followerId = (
    await mutate("reference_construct", {
      action: "apply",
      sessionId: followerPreview.sessionId,
      version: followerPreview.version,
    })
  ).result.entityId;
  const analyticIds = [
    ...ledger.analyticSources.map((row) => row.entityId),
    analyticAxisId,
    followerId,
  ];
  const analyticBefore = await Promise.all(
    analyticIds.map(
      async (entityId) =>
        (await call("object_get", { entityId })).result.reference
          .geometryEncoding,
    ),
  );
  const rebuiltAnalytic = await job(
    await mutate("cad_rebuild", {
      entityId: primitiveIds.cylinder,
      recipe: {
        kind: "primitive",
        input: {
          kind: "cylinder",
          center: [0, 6, 0],
          axis: [1, 0, 0],
          radius: 1,
          height: 10,
        },
      },
    }),
  );
  for (const entityId of [
    ledger.analyticSources.find((row) => row.key === "cylinder").entityId,
    analyticAxisId,
    followerId,
  ])
    assert(rebuiltAnalytic.refreshedEntityIds.includes(entityId));
  const analyticAfter = await Promise.all(
    analyticIds.map(
      async (entityId) =>
        (await call("object_get", { entityId })).result.reference
          .geometryEncoding,
    ),
  );
  assert.deepEqual(
    (await call("object_get", { entityId: analyticIds[1] })).result.reference
      .geometry.position,
    [0, 6, 0],
  );
  assert.deepEqual(
    (await call("object_get", { entityId: analyticAxisId })).result.reference
      .geometry.start,
    [0, 7.5, 0],
  );
  assert.deepEqual(
    (await call("object_get", { entityId: followerId })).result.reference
      .geometry.position,
    [5, 7.5, 0],
  );
  const lockedSphere = (
    await call("object_get", { entityId: primitiveIds.sphere })
  ).result;
  assert.equal(lockedSphere.locked, true);
  assert.match(lockedSphere.constructionOrderKey, /^[0-9a-f]{32}$/);
  assert.notDeepEqual(analyticAfter.slice(1), analyticBefore.slice(1));
  await mutate("history_undo", {});
  assert.deepEqual(
    await Promise.all(
      analyticIds.map(
        async (entityId) =>
          (await call("object_get", { entityId })).result.reference
            .geometryEncoding,
      ),
    ),
    analyticBefore,
  );
  await mutate("history_redo", {});
  assert.deepEqual(
    await Promise.all(
      analyticIds.map(
        async (entityId) =>
          (await call("object_get", { entityId })).result.reference
            .geometryEncoding,
      ),
    ),
    analyticAfter,
  );
  await mutate("object_select", { entityId: primitiveIds.cylinder });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const rebuildPanel = page.getByRole("region", {
    name: "Parametric rebuild",
    exact: true,
  });
  await rebuildPanel
    .getByLabel("Parametric feature recipe", { exact: true })
    .fill(
      JSON.stringify({
        kind: "primitive",
        input: {
          kind: "cylinder",
          center: [0, 8, 0],
          axis: [1, 0, 0],
          radius: 1,
          height: 10,
        },
      }),
    );
  await rebuildPanel
    .getByRole("button", {
      name: "Rebuild feature and dependents",
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("Rebuilt "),
  );
  assert.deepEqual(
    (await call("object_get", { entityId: analyticIds[1] })).result.reference
      .geometry.position,
    [0, 8, 0],
  );
  assert.deepEqual(
    (await call("object_get", { entityId: analyticAxisId })).result.reference
      .geometry.start,
    [0, 8.5, 0],
  );
  assert.deepEqual(
    (await call("object_get", { entityId: followerId })).result.reference
      .geometry.position,
    [5, 8.5, 0],
  );
  const analyticGuiAfter = await Promise.all(
    analyticIds.map(
      async (entityId) =>
        (await call("object_get", { entityId })).result.reference
          .geometryEncoding,
    ),
  );
  await mutate("history_undo", {});
  assert.deepEqual(
    await Promise.all(
      analyticIds.map(
        async (entityId) =>
          (await call("object_get", { entityId })).result.reference
            .geometryEncoding,
      ),
    ),
    analyticAfter,
  );
  await mutate("history_redo", {});
  assert.deepEqual(
    await Promise.all(
      analyticIds.map(
        async (entityId) =>
          (await call("object_get", { entityId })).result.reference
            .geometryEncoding,
      ),
    ),
    analyticGuiAfter,
  );
  const analyticArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: analyticArtifact.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    await Promise.all(
      analyticIds.map(
        async (entityId) =>
          (await call("object_get", { entityId })).result.reference
            .geometryEncoding,
      ),
    ),
    analyticGuiAfter,
  );
  ledger.analyticRecipeInputs = {
    realCadWorker: true,
    lockedSphereReadAndKeyMigration: true,
    averageGuiMcpEqual: true,
    mixedDescendantRebuild: true,
    guiRebuildSharedClosure: true,
    undoRedo: true,
    workerReopen: true,
  };
  console.log(
    "Real-worker sphere/cylinder GUI/public MCP sources, locked read, mixed CAD rebuild/history/reopen passed",
  );

  // Point-cloud vertex acquisition crosses the real JSON transport, preserving -0 via source intents.
  const cloudXYZ = [1.0000005, -3e-7, 6.8, 10, 0, 0, 0, 10, 0];
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles({
      name: "m4-picked-cloud.scanforge",
      mimeType: "application/x-scanforge",
      buffer: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "M4 picked cloud",
          entities: [
            {
              id: "pick-cloud",
              name: "Picked cloud",
              kind: "pointcloud",
              positions: cloudXYZ,
              color: "#2288cc",
              pointSize: 10,
              visible: true,
              opacity: 1,
            },
          ],
        }),
      ),
    });
  await page
    .getByRole("button", { name: "Picked cloud", exact: true })
    .waitFor();
  for (let attempt = 0; ; attempt++) {
    const state = (await call("application_inspect", { maxControls: 1 }))
      .result;
    if (!state.busy) break;
    assert(attempt < 120, "Point-cloud project presentation did not finish");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await mutate("viewport_control", {
    action: "camera",
    position: [25, -30, 25],
    target: [3, 3, 3],
    up: [0, 0, 1],
    projection: "perspective",
    zoom: 1,
  });
  await mutate("sketch_manage", {
    action: "create",
    name: "Preserved during coordinate picks",
    sketch: {
      version: 1,
      points: [],
      segments: [],
      arcs: [],
      constraints: [],
      frame: {
        origin: [0, 0, 0],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
  });
  await mutate("ui_set", { workspace: "sketch", toolPanelOpen: true });
  await page
    .getByRole("region", { name: "Parametric sketch", exact: true })
    .getByRole("button", { name: "Line", exact: true })
    .click();
  const sketchBeforeCoordinatePicks = (await call("sketch_get")).result.sketch;
  const vertexPick = (
    await call("reference_construction_pick", {
      entityId: "pick-cloud",
      pointIndex: 0,
    })
  ).result;
  const expectedPickEncoding = JSON.parse(
    await readFile(
      new URL(
        "tests/fixtures/reference-point-picked-cloud-native-r10.json",
        root,
      ),
      "utf8",
    ),
  ).accepted.geometryEncoding;
  assert.deepEqual(vertexPick.positionEncoding, expectedPickEncoding);
  assert.equal(
    Object.is(vertexPick.position[1], -0),
    false,
    "JSON numeric inspection loses -0; source intents must preserve it",
  );
  const independentPick = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { entityId: "pick-cloud", pointIndex: 0 },
    })
  ).result;
  assert.deepEqual(independentPick.geometryEncoding, expectedPickEncoding);
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: independentPick.sessionId,
    version: independentPick.version,
  });
  const canvas = page.locator(".viewport canvas").first();
  async function clickCloudVertex(index) {
    const view = (await call("viewport_get")).result,
      camera = new PerspectiveCamera();
    camera.projectionMatrix.fromArray(view.projectionMatrix);
    camera.matrixWorld.fromArray(view.cameraWorldMatrix);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const clip = new Vector3(
        ...cloudXYZ.slice(index * 3, index * 3 + 3).map(Math.fround),
      ).project(camera),
      rect = await canvas.boundingBox();
    assert(
      rect && clip.z >= -1 && clip.z <= 1,
      "Picked cloud vertex must be visible",
    );
    await page.mouse.click(
      rect.x + ((clip.x + 1) * rect.width) / 2,
      rect.y + ((1 - clip.y) * rect.height) / 2,
    );
  }
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Reference point", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference point", exact: true });
  await dialog
    .getByRole("button", { name: "Pick position", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Pick reference coordinate", exact: true })
    .getByRole("button", { name: "Cancel picking", exact: true })
    .click();
  await dialog.getByLabel("Position X", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("Position X", { exact: true }).inputValue(),
    "0",
  );
  await dialog
    .getByRole("button", { name: "Pick position", exact: true })
    .click();
  await clickCloudVertex(0);
  await dialog.getByLabel("Position X", { exact: true }).waitFor();
  assert.equal(
    Number(await dialog.getByLabel("Position X", { exact: true }).inputValue()),
    1,
  );
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[role="dialog"] .button-row:last-child button:nth-child(2)',
      )?.disabled,
  );
  assert.deepEqual(
    (await call("reference_construction_get")).result.geometryEncoding,
    expectedPickEncoding,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("picked-point-preview.png", artifactDir)),
  });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const pickedPointId = (await call("project_get")).result.objects.find(
    (row) => row.kind === "referencePoint",
  ).id;
  const readPickedPoint = async () =>
    (await call("object_get", { entityId: pickedPointId })).result.reference;
  assert.deepEqual(
    (await readPickedPoint()).geometryEncoding,
    expectedPickEncoding,
  );
  assert.deepEqual((await readPickedPoint()).definition.sources, []);
  const independentPickedLine = (
    await mutate("reference_construct", {
      action: "preview",
      kind: "line",
      startPick: { entityId: "pick-cloud", pointIndex: 0 },
      endPick: { entityId: "pick-cloud", pointIndex: 1 },
    })
  ).result;
  await mutate("reference_construct", {
    action: "cancel",
    sessionId: independentPickedLine.sessionId,
    version: independentPickedLine.version,
  });
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Reference line", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Reference line", exact: true });
  await dialog.getByRole("button", { name: "Pick start", exact: true }).click();
  await clickCloudVertex(0);
  await dialog.getByLabel("Start X", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Pick end", exact: true }).click();
  await clickCloudVertex(1);
  await dialog.getByLabel("End X", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[role="dialog"] .button-row:last-child button:nth-child(2)',
      )?.disabled,
  );
  assert.deepEqual(
    (await call("reference_construction_get")).result.geometryEncoding,
    independentPickedLine.geometryEncoding,
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const pickedLineId = (await call("project_get")).result.objects.find(
    (row) => row.kind === "referenceLine",
  ).id;
  assert.deepEqual(
    (await call("object_get", { entityId: pickedLineId })).result.reference
      .definition.sources,
    [],
  );
  await mutate("object_delete", { entityId: "pick-cloud" });
  assert.deepEqual(
    (await readPickedPoint()).geometryEncoding,
    expectedPickEncoding,
  );
  const pickedArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: pickedArtifact.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    (await readPickedPoint()).geometryEncoding,
    expectedPickEncoding,
  );
  assert.deepEqual(
    (await call("object_get", { entityId: pickedLineId })).result.reference
      .geometryEncoding,
    independentPickedLine.geometryEncoding,
  );
  assert.deepEqual(
    (await call("sketch_get")).result.sketch,
    sketchBeforeCoordinatePicks,
    "Coordinate picks must not publish active sketch gestures",
  );
  ledger.pickedCloudCoordinates = {
    activeSketchPreserved: true,
    guiMcpPointEqual: true,
    guiMcpLineEqual: true,
    signedZeroPreservedAcrossPublicJson: true,
    pickCancel: true,
    bakedWithoutSourceLinks: true,
    sourceDeleted: true,
    workerReopen: true,
  };
  console.log(
    "Actual GUI/public MCP cloud picks, signed-zero-safe intents, numeric bake and source-delete/reopen passed",
  );

  ledger.numericEditInitialization = [];
  for (const [kind, entityId] of [
    ["point", pickedPointId],
    ["line", pickedLineId],
  ]) {
    const original = (await call("object_get", { entityId })).result.reference;
    const fields = original.editorInputs;
    assert.equal(fields.kind, kind);
    if (kind === "point") assert.deepEqual(fields.position, [1, 0, 6.8]);
    const independent = (
      await mutate("reference_construct", {
        action: "preview",
        kind,
        entityId,
        initialize: true,
      })
    ).result;
    await mutate("reference_construct", {
      action: "cancel",
      sessionId: independent.sessionId,
      version: independent.version,
    });
    for (const action of ["Cancel", "Apply"]) {
      await mutate("object_select", { entityId });
      await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
      await page
        .getByRole("button", { name: "Edit reference", exact: true })
        .click();
      dialog = page.getByRole("dialog", {
        name: `Reference ${kind}`,
        exact: true,
      });
      await dialog.locator("fieldset:not([disabled])").waitFor();
      const coordinates =
        kind === "point"
          ? [["Position", fields.position]]
          : [
              ["Start", fields.start],
              ["End", fields.end],
            ];
      for (const [label, values] of coordinates)
        for (let i = 0; i < 3; i++)
          assert.equal(
            Number(
              await dialog
                .getByLabel(`${label} ${["X", "Y", "Z"][i]}`, { exact: true })
                .inputValue(),
            ),
            values[i],
          );
      await dialog
        .getByRole("button", { name: "Preview", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '[role="dialog"] .button-row:last-child button:nth-child(2)',
          )?.disabled,
      );
      assert.deepEqual(
        (await call("reference_construction_get")).result.geometryEncoding,
        independent.geometryEncoding,
      );
      await dialog.getByRole("button", { name: action, exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.deepEqual(
        (await call("object_get", { entityId })).result.reference
          .geometryEncoding,
        action === "Cancel"
          ? original.geometryEncoding
          : independent.geometryEncoding,
      );
    }
    await mutate("history_undo", {});
    assert.deepEqual(
      (await call("object_get", { entityId })).result.reference
        .geometryEncoding,
      original.geometryEncoding,
    );
    await mutate("history_redo", {});
    assert.deepEqual(
      (await call("object_get", { entityId })).result.reference
        .geometryEncoding,
      independent.geometryEncoding,
    );
    ledger.numericEditInitialization.push({
      kind,
      entityId,
      guiMcpEqual: true,
      cancelPreservedOriginal: true,
      undoRedo: true,
      geometryEncoding: independent.geometryEncoding,
    });
  }
  const initializedArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: initializedArtifact.artifactId,
      replace: true,
    }),
  );
  for (const row of ledger.numericEditInitialization)
    assert.deepEqual(
      (await call("object_get", { entityId: row.entityId })).result.reference
        .geometryEncoding,
      row.geometryEncoding,
    );
  console.log(
    "Native-style numeric editor fields, GUI/public MCP initialize, Cancel/Apply, history and worker reopen passed",
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
