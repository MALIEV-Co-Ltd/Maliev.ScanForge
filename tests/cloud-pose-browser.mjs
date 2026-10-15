import { gunzipSync } from "node:zlib";
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
  owner: "scanforge-cloud-pose-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/cloud-pose-browser/", root);
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
  failed = Error("Browser validation exceeded 4 minute lease");
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

  const fixture = JSON.parse(
    await readFile(
      new URL("tests/fixtures/alignment-cloud-pose-native.json", root),
      "utf8",
    ),
  ).cases[0];
  const floats = (hex) => {
    const b = Buffer.from(hex, "hex");
    return Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4));
  };
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Deferred cloud",
    units: "mm",
    entities: [
      {
        id: "cloud",
        name: "ASC cloud",
        kind: "pointcloud",
        positions: floats(fixture.positionsBits),
        normals: floats(fixture.normalsBits),
        visible: true,
        color: "#abcdef",
        opacity: 1,
        meshSelection: {
          hidden: [2],
          saved: [{ id: "keep", name: "Keep", triangles: [1, 3] }],
        },
      },
    ],
  };
  const upload = await call("artifact_put", {
    name: "cloud.json",
    offset: 0,
    base64: Buffer.from(JSON.stringify(project)).toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: upload.result.artifactId,
      replace: true,
    }),
  );
  const constraints = [
    { kind: "plane", point: [3, 4, 5], direction: [0, 1, 0], axis: 2 },
  ];
  const beforeSourceOnly = (await call("project_get")).result.undo;
  await mutate("landmark_edit", { action: "begin", movingId: "cloud" });
  assert.equal((await call("landmark_get")).result.fixedId, null);
  assert.deepEqual((await call("landmark_get")).result.referenceIds, []);
  const sourceOnlyDialog = page.getByRole("complementary", {
    name: "N-points alignment",
  });
  assert.match(
    await sourceOnlyDialog
      .getByRole("button", { name: "Fixed alignment target", exact: true })
      .innerText(),
    /All visible references/,
  );
  assert.equal(
    await sourceOnlyDialog
      .getByRole("button", { name: "Preview", exact: true })
      .isDisabled(),
    true,
  );
  await sourceOnlyDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal((await call("landmark_get")).result.active, false);
  assert.equal((await call("project_get")).result.undo, beforeSourceOnly);
  await mutate("object_select", { entityId: "cloud" });
  await mutate("selection_set", { entityId: "cloud", points: [1, 3] });
  const preview = await job(
    await mutate("alignment_preview", { entityIds: ["cloud"], constraints }),
  );
  assert(preview.targets[0].pointCloudPose);
  await mutate("preview_discard", { target: "datum" });
  await mutate("object_select", { entityId: "cloud" });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Reference 1 type", { exact: true })
    .selectOption("plane");
  for (const [axis, value] of [
    ["X", "3"],
    ["Y", "4"],
    ["Z", "5"],
  ])
    await page
      .getByLabel("Reference 1 point (mm) " + axis, { exact: true })
      .fill(value);
  for (const [axis, value] of [
    ["X", "0"],
    ["Y", "1"],
    ["Z", "0"],
  ])
    await page
      .getByLabel("Reference 1 direction " + axis, { exact: true })
      .fill(value);
  await page
    .getByLabel("Reference 1 target axis", { exact: true })
    .selectOption("2");
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByText("Alignment preview ready · model unchanged", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .waitFor();
  const applied = await call("object_get", { entityId: "cloud" });
  assert.equal(
    applied.result.pointCloudPose,
    preview.targets[0].pointCloudPose,
  );
  assert.equal(
    (await call("selection_get", { entityId: "cloud" })).result.count,
    2,
  );
  await mutate("history_undo", {});
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.pointCloudPose,
    undefined,
  );
  await mutate("history_redo", {});
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.pointCloudPose,
    preview.targets[0].pointCloudPose,
  );
  await mutate("selection_set", { entityId: "cloud", points: [1, 3] });
  const second = await job(
    await mutate("alignment_apply", { entityIds: ["cloud"], constraints }),
  );
  assert.notEqual(
    second.targets[0].pointCloudPose,
    preview.targets[0].pointCloudPose,
  );
  assert.equal(
    (await call("selection_get", { entityId: "cloud" })).result.count,
    2,
  );
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.pointCloudPose,
    second.targets[0].pointCloudPose,
  );
  const geo = await call("object_get", {
    entityId: "cloud",
    includeGeometry: true,
  });
  assert(
    geo.result.geometryArtifact || geo.result.geometry || geo.result.artifactId,
    JSON.stringify(geo),
  );
  const geometry = async () => {
    const object = (
      await call("object_get", { entityId: "cloud", includeGeometry: true })
    ).result;
    const data = (
      await call("artifact_read", { artifactId: object.geometry.artifactId })
    ).result;
    return JSON.parse(Buffer.from(data.base64, "base64").toString());
  };
  const beforePaired = await geometry();
  const sourceLandmarks = [0, 3, 7].flatMap((i) =>
    beforePaired.positions.slice(i * 3, i * 3 + 3),
  );
  const targetLandmarks = sourceLandmarks.map(
    (v, i) => v + [25, -15, 8][i % 3],
  );
  const targetUpload = await call("artifact_put", {
    name: "fixed-paired.asc",
    offset: 0,
    base64: Buffer.from(
      [0, 1, 2]
        .map((i) => targetLandmarks.slice(i * 3, i * 3 + 3).join(" "))
        .join("\n"),
    ).toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: targetUpload.result.artifactId,
      unit: "mm",
    }),
  );
  const fixed = (await call("project_get")).result.objects.find(
    (o) => o.name === "fixed-paired.asc",
  );
  assert.equal(fixed.kind, "pointcloud");
  const fixedBefore = (await call("object_get", { entityId: fixed.id })).result;
  const otherUpload = await call("artifact_put", {
    name: "other-reference.asc",
    offset: 0,
    base64: Buffer.from(targetLandmarks.slice(6, 9).join(" ")).toString(
      "base64",
    ),
  });
  await job(
    await mutate("project_import", {
      artifactId: otherUpload.result.artifactId,
      unit: "mm",
    }),
  );
  const otherReference = (await call("project_get")).result.objects.find(
    (object) => object.name === "other-reference.asc",
  );
  assert.equal(otherReference.kind, "pointcloud");
  const otherBefore = (
    await call("object_get", { entityId: otherReference.id })
  ).result;
  await mutate("selection_set", { entityId: "cloud", points: [1, 3] });
  await mutate("landmark_edit", {
    action: "begin",
    movingId: "cloud",
    fixedId: fixed.id,
  });
  const precisionWitness = [0.0001, 16777217, -0.00000003];
  await page
    .getByRole("button", { name: "Fixed alignment target", exact: true })
    .click();
  await page
    .getByRole("option", { name: "All visible references", exact: true })
    .click();
  assert.equal((await call("landmark_get")).result.fixedId, null);
  assert((await call("landmark_get")).result.referenceIds.includes(fixed.id));
  await mutate("landmark_edit", {
    action: "reference-target",
    fixedId: fixed.id,
  });
  assert(
    (
      await page
        .getByRole("button", { name: "Fixed alignment target", exact: true })
        .innerText()
    ).includes(fixed.name),
  );
  await mutate("landmark_edit", {
    action: "pick",
    entityId: "cloud",
    point: precisionWitness,
  });
  assert.deepEqual(
    (await call("landmark_get")).result.picks[0].point,
    precisionWitness.map(Math.fround),
  );
  await mutate("landmark_edit", { action: "clear" });
  await mutate("landmark_edit", { action: "reference-target" });
  for (let i = 0; i < 3; i++) {
    await mutate("landmark_edit", {
      action: "pick",
      entityId: "cloud",
      point: sourceLandmarks.slice(i * 3, i * 3 + 3),
    });
    await mutate("landmark_edit", {
      action: "pick",
      entityId: i === 2 ? otherReference.id : fixed.id,
      point: targetLandmarks.slice(i * 3, i * 3 + 3),
    });
  }
  const landmarkDialog = page.getByRole("complementary", {
    name: "N-points alignment",
  });
  await landmarkDialog
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await landmarkDialog.getByText(/Preview RMS:/).waitFor();
  const guiPaired = (await call("landmark_get")).result;
  assert.equal(guiPaired.fixedId, null);
  assert(guiPaired.picks.some((pick) => pick.entityId === otherReference.id));
  assert(guiPaired.pointCloudPose);
  assert.equal(guiPaired.diagnostics.localBuffersRetained, true);
  assert.equal(guiPaired.candidateCount, 1);
  assert.equal(guiPaired.candidateIndex, 0);
  assert.equal(guiPaired.canPreview, false);
  assert.equal(guiPaired.canReset, true);
  assert.equal(guiPaired.canRemove, false);
  assert.equal(
    await landmarkDialog
      .getByRole("button", { name: "Preview", exact: true })
      .isDisabled(),
    true,
  );
  const repeatedPreview = await job(
    await mutate("landmark_preview", { parallel: true, workerCount: 2 }),
    "failed",
  );
  assert.match(repeatedPreview.error.message, /Reset/i);
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.pointCloudPose,
    second.targets[0].pointCloudPose,
  );
  assert.deepEqual(await geometry(), beforePaired);
  await mutate("landmark_edit", { action: "reset" });
  assert.equal((await call("landmark_get")).result.canPreview, true);
  const agentPaired = await job(
    await mutate("landmark_preview", { parallel: true, workerCount: 2 }),
  );
  assert.deepEqual(agentPaired.registration, guiPaired.registration);
  assert.equal(agentPaired.pointCloudPose, guiPaired.pointCloudPose);
  await mutate("landmark_accept", {});
  const paired = (await call("object_get", { entityId: "cloud" })).result;
  assert.equal(paired.kind, "pointcloud");
  assert.equal(paired.pointCloudPose, guiPaired.pointCloudPose);
  assert.equal(
    (await call("selection_get", { entityId: "cloud" })).result.count,
    2,
  );
  assert.deepEqual(
    (await call("object_get", { entityId: fixed.id })).result,
    fixedBefore,
  );
  assert.deepEqual(
    (await call("object_get", { entityId: otherReference.id })).result,
    otherBefore,
  );
  const afterPaired = await geometry();
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(), beforePaired);
  await mutate("history_redo", {});
  assert.deepEqual(await geometry(), afterPaired);
  const selectionFailure = await job(
    await mutate("mesh_process", {
      entityId: "cloud",
      selectionOnly: true,
      createNew: true,
      operation: { kind: "paired", sourceLandmarks, targetLandmarks },
    }),
    "failed",
  );
  assert.match(selectionFailure.error.message, /omit selectionOnly/);
  assert.deepEqual(await geometry(), afterPaired);
  await mutate("history_undo", {});
  const processed = await job(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: {
        kind: "paired",
        sourceLandmarks,
        targetLandmarks,
        parallel: true,
        workerCount: 2,
      },
    }),
  );
  assert.equal(processed.diagnostics.pointCloudPose, guiPaired.pointCloudPose);
  assert.deepEqual(await geometry(), afterPaired);
  await mutate("history_undo", {});
  await mutate("object_select", { entityId: "cloud" });
  await mutate("ui_set", {
    workspace: "landmarkAlignment",
    toolPanelOpen: true,
    mode: "inspect",
  });
  const lines = (points) =>
    [0, 1, 2].map((i) => points.slice(i * 3, i * 3 + 3).join(",")).join("\n");
  await page
    .getByLabel("Source registration landmarks", { exact: true })
    .fill(lines(sourceLandmarks));
  await page
    .getByLabel("Target registration landmarks", { exact: true })
    .fill(lines(targetLandmarks));
  await page
    .getByRole("button", { name: "Align paired landmarks", exact: true })
    .click();
  await page.getByRole("status", { name: "Mesh operation result" }).waitFor();
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.kind,
    "pointcloud",
  );
  assert.equal(
    (await call("object_get", { entityId: "cloud" })).result.pointCloudPose,
    guiPaired.pointCloudPose,
  );
  assert.deepEqual(await geometry(), afterPaired);
  ledger.steps = [
    "GUI Apply equals shared MCP pose",
    "First GUI Apply preserves legacy JSON point selection",
    "Preview discarded without mutation",
    "MCP Undo/Redo restores pose",
    "Repeated MCP Apply composes retained pose",
    "Repeated Apply preserves active point selection",
    "Binary project recovery retains exact pose",
    "World geometry remains available through MCP",
    "Source-only GUI/MCP admission and optional reference filters preserve history",
    "Fixed picks span multiple ASC references without modifying either reference",
    "MCP landmark picks retain native Float32 coordinate precision",
    "Point-pair GUI/MCP preview composes native cloud pose",
    "Single-result preview locks GUI and MCP until reset",
    "Paired accept and undo preserve point type, normals and selection",
    "mesh_process paired and legacy GUI panel preserve the same native pose",
    "MCP rejects point masks for whole-cloud registration without changing geometry",
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
