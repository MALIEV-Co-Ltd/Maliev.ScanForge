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
  owner: "scanforge-datum-metadata-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/datum-primitive-integration/", root);
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
      name: "Fitted sphere",
      recipe: {
        kind: "primitive",
        input: { kind: "sphere", center: [3, 4, 5], radius: 2.25 },
      },
    }),
  );
  const exported = await job(
    await call("project_export", { format: "project" }),
  );
  const chunks = [];
  let offset = 0;
  for (;;) {
    const download = await call("artifact_read", {
      artifactId: exported.artifactId,
      offset,
      length: 262144,
    });
    chunks.push(Buffer.from(download.result.base64, "base64"));
    offset = download.result.nextOffset;
    if (download.result.eof) break;
  }
  const file = Buffer.concat(chunks),
    length = file.readUInt32LE(8),
    manifest = JSON.parse(file.subarray(16, 16 + length).toString());
  assert.equal(file.subarray(0, 8).toString(), "SCANFRG2");
  const record = manifest.records[manifest.current[0]];
  function decode(ref) {
    const chunk = manifest.chunks[ref.chunk],
      raw = file.subarray(
        16 + length + chunk.offset,
        16 + length + chunk.offset + chunk.bytes,
      ),
      bytes = chunk.codec === "gzip" ? gunzipSync(raw) : raw;
    if (ref.type === "text") return bytes.toString();
    const width = ref.type === "f64" ? 8 : 4;
    return Array.from({ length: bytes.length / width }, (_, i) =>
      ref.type === "f64"
        ? bytes.readDoubleLE(i * width)
        : ref.type === "f32"
          ? bytes.readFloatLE(i * width)
          : bytes.readUInt32LE(i * width),
    );
  }
  const planeFit = {
    kind: "plane",
    center: [3, 4, 5],
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  };
  const sphere = {
    ...record,
    kind: "mesh",
    fit: undefined,
    parametric: undefined,
    kernelId: undefined,
    brep: undefined,
  };
  for (const key of ["positions", "normals", "edgePositions", "brep"])
    if (record[key]) sphere[key] = decode(record[key]);
  delete sphere.brep;
  delete sphere.kernelId;
  const plane = {
    id: "plane-scan",
    name: "Fitted plane scan",
    kind: "mesh",
    positions: [3, 4, 5, 4, 4, 5, 3, 5, 5],
    color: "#bbbbbb",
    visible: true,
    opacity: 1,
  };
  plane.positions = [];
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const a = [3 + x / 6, 4 + y / 6, 5],
        b = [3 + (x + 1) / 6, 4 + y / 6, 5],
        c = [3 + x / 6, 4 + (y + 1) / 6, 5],
        d = [3 + (x + 1) / 6, 4 + (y + 1) / 6, 5];
      plane.positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Primitive alignment parity",
    units: "mm",
    entities: [
      sphere,
      plane,
      {
        ...sphere,
        id: "linked-cad",
        name: "Scan-derived CAD",
        kind: "cad",
        brep: decode(record.brep),
        surfaceScanId: sphere.id,
      },
    ],
  };
  const payload = Buffer.from(JSON.stringify(project));
  let artifactId;
  for (let offset = 0; offset < payload.length; offset += 1048576) {
    const upload = await call("artifact_put", {
      name: "primitive-fixture.json",
      offset,
      base64: payload.subarray(offset, offset + 1048576).toString("base64"),
      ...(artifactId ? { artifactId } : {}),
    });
    artifactId = upload.result.artifactId;
  }
  await job(
    await mutate("project_import", {
      artifactId,
      replace: true,
    }),
  );
  const segment = async (entityId) =>
    job(
      await mutate("mesh_process", {
        entityId,
        operation: { kind: "segment", tolerance: 0.001, angleDegrees: 180 },
        createNew: true,
      }),
    );
  const sphereSegments = await segment(created.entityIds[0]),
    planeSegments = await segment("plane-scan");
  assert.equal(sphereSegments.segmentClassifications[0].kind, "sphere");
  assert.equal(planeSegments.segmentClassifications[0].kind, "plane");
  assert.equal(
    sphereSegments.entityIds.length,
    sphereSegments.segmentClassifications.length,
  );
  assert.equal(planeSegments.entityIds.length, 1);
  for (const entityId of [created.entityIds[0], "plane-scan"])
    await mutate("object_update", { entityId, patch: { visible: false } });
  const surface = await job(
    await mutate("cad_create", {
      name: "Construction plane",
      recipe: {
        kind: "surface",
        patch: {
          format: "scanforge-nurbs",
          version: 1,
          countU: 2,
          countV: 2,
          degreeU: 1,
          degreeV: 1,
          knotsU: [0, 0, 1, 1],
          knotsV: [0, 0, 1, 1],
          points: [
            [3, 4, 5],
            [4, 4, 5],
            [3, 5, 5],
            [4, 5, 5],
          ],
          weights: [1, 1, 1, 1],
        },
      },
    }),
  );
  const ids = [
      ...sphereSegments.entityIds,
      planeSegments.entityIds[0],
      surface.entityIds[0],
      "linked-cad",
    ],
    planeId = planeSegments.entityIds[0],
    surfaceId = surface.entityIds[0],
    constraints = [
      { kind: "plane", point: [3, 4, 5], direction: [0, 1, 0], axis: 2 },
    ];
  const before = await call("project_get");
  const preview = await job(
    await mutate("alignment_preview", { entityIds: ids, constraints }),
  );
  const expected = new Map(
    preview.targets.map((target) => [target.entityId, target]),
  );
  assert.ok(Math.abs(expected.get(ids[0]).fit.radius - 2.25) < 1e-5);
  assert.notDeepEqual(expected.get(planeId).fit.axis, planeFit.axis);
  assert.equal(expected.get("linked-cad").surfaceScanId, sphere.id);
  assert.deepEqual(
    (await call("project_get")).result.objects.map((object) => object.fit),
    before.result.objects.map((object) => object.fit),
  );
  await mutate("preview_discard", { target: "datum" });
  await mutate("object_select", { entityId: ids[0] });
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
  for (const entityId of ids.slice(1))
    await page
      .getByRole("checkbox", {
        name:
          "Move " +
          before.result.objects.find((object) => object.id === entityId).name,
        exact: true,
      })
      .check();
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
  const placed = await call("project_get");
  for (const object of placed.result.objects.filter((object) =>
    ids.includes(object.id),
  ))
    assert.deepEqual(object.fit, expected.get(object.id).fit);
  assert.deepEqual(
    placed.result.objects.find((object) => object.id === surfaceId).planeFrame,
    expected.get(surfaceId).planeFrame,
  );
  await mutate("object_select", { entityId: planeId });
  await page
    .getByRole("button", { name: "Read alignment references", exact: true })
    .click();
  const shown = page.locator("dl[data-reference-id]");
  await shown.waitFor();
  assert.deepEqual(
    JSON.parse(await shown.getAttribute("data-reference-point")),
    expected.get(planeId).fit.center,
  );
  await mutate("history_undo", {});
  assert.deepEqual(
    (await call("project_get")).result.objects.map((object) => object.fit),
    before.result.objects.map((object) => object.fit),
  );
  await mutate("history_redo", {});
  await mutate("object_select", { entityId: "linked-cad" });
  const sourceReference = page.locator(`[data-source-scan-id="${sphere.id}"]`);
  if (!(await sourceReference.isVisible()))
    await page
      .getByRole("button", {
        name: "Align object to origin / references",
        exact: true,
      })
      .click();
  await sourceReference.waitFor();
  const dependentTargets = await call("alignment_targets", {
    entityIds: [sphere.id],
  });
  assert.deepEqual(dependentTargets.result.entityIds, [
    sphere.id,
    "linked-cad",
  ]);
  assert.deepEqual(dependentTargets.result.blocked, []);
  await mutate("object_select", { entityId: sphere.id });
  const includeButton = page.getByRole("button", {
    name: "Include dependent features",
    exact: true,
  });
  if (!(await includeButton.isVisible()))
    await page
      .getByRole("button", {
        name: "Align object to origin / references",
        exact: true,
      })
      .click();
  await includeButton.click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Move Scan-derived CAD", exact: true })
      .isChecked(),
    true,
  );
  assert.deepEqual(
    (await call("project_get")).result.objects.map((object) => object.fit),
    placed.result.objects.map((object) => object.fit),
  );
  ledger.steps = [
    "real sphere/plane segmentation retains classified fits through MCP",
    "native nontrivial rotation preserves fitted parameters in Preview",
    "GUI Apply equals shared MCP fit and plane-frame output",
    "GUI reference inspection sees moved fitted parameters",
    "MCP Undo/Redo restores fitted parameters",
    "Exact CAD alignment retains source-scan dependency through GUI Apply and MCP Preview",
    "GUI dependent-target inclusion equals shared MCP discovery",
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
