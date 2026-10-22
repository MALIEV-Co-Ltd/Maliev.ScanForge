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
  out = new URL("../.resources/point-edit/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "point-cloud-edit-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
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
  client = new Client({ name: "point-cloud-edit-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({ kind: "browser", pid: browserServer.process().pid });
  await writeFile(
    new URL("point-edit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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

  const positions = Array.from({ length: 400 }, (_, i) => [
    i % 20,
    Math.floor(i / 20),
    0,
  ]).flat();
  const cloud = {
    id: "cloud",
    name: "scan.asc",
    kind: "pointcloud",
    positions,
    normals: Array.from({ length: 400 }, (_, i) =>
      i % 2 ? [1, 0, 0] : [0, 0, 1],
    ).flat(),
    visible: true,
    color: "#b4bec4",
    opacity: 1,
  };
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Point edit validation",
    units: "mm",
    entities: [cloud],
  };
  const asc = Array.from({ length: 400 }, (_, i) =>
    [
      ...positions.slice(i * 3, i * 3 + 3),
      ...cloud.normals.slice(i * 3, i * 3 + 3),
    ].join(" "),
  ).join("\n");
  await page.locator('input[type="file"][accept*=".asc"]').setInputFiles({
    name: cloud.name,
    mimeType: "text/plain",
    buffer: Buffer.from(asc),
  });
  await page
    .getByRole("dialog", { name: "Import scan", exact: true })
    .getByRole("button", { name: "Import", exact: true })
    .click();
  let imported;
  for (let attempt = 0; attempt < 120; attempt++) {
    imported = (await call("project_get")).result.objects.find(
      (object) => object.name === cloud.name && object.kind === "pointcloud",
    );
    if (imported) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(imported, "GUI ASC import did not publish the point cloud");
  const cloudId = imported.id;
  // GUI import centers XY bounds and places the base on Z=0.
  const importedPositions = positions.map((value, i) =>
    Math.fround(value - (i % 3 === 2 ? 0 : 9.5)),
  );
  const geometry = async (id) => {
    const object = (
      await call("object_get", { entityId: id, includeGeometry: true })
    ).result;
    return JSON.parse(
      Buffer.from(
        (
          await call("artifact_read", {
            artifactId: object.geometry.artifactId,
          })
        ).result.base64,
        "base64",
      ).toString(),
    );
  };
  const original = await geometry(cloudId);
  assert.deepEqual(original.positions, importedPositions);
  assert.deepEqual(original.normals, cloud.normals);
  await page.getByRole("button", { name: "Edit scan", exact: true }).click();
  assert(
    (await page.locator(".status-details").innerText()).includes("Points: 400"),
  );
  await page
    .getByRole("button", { name: "Select all points", exact: true })
    .click();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      (await call("selection_get", { entityId: cloudId })).result.count === 400
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await call("selection_get", { entityId: cloudId })).result.count,
    400,
  );
  await page
    .getByRole("button", { name: "Select by drawing a rectangle", exact: true })
    .click();
  await page.getByRole("button", { name: "Deselect all", exact: true }).click();
  await mutate("viewport_set", { view: "fit" });
  await mutate("viewport_set", { view: "top" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const canvas =
    (await page
      .locator(".viewport canvas")
      .first()
      .boundingBox()
      .catch(() => null)) ??
    (await page.locator("canvas").first().boundingBox());
  assert(canvas);
  await page.mouse.move(
    canvas.x + canvas.width * 0.4,
    canvas.y + canvas.height * 0.25,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width * 0.65,
    canvas.y + canvas.height * 0.7,
    { steps: 8 },
  );
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const painted = (await call("selection_get", { entityId: cloudId })).result
    .count;
  if (!painted)
    await page.screenshot({
      path: fileURLToPath(new URL("selection-debug.png", out)),
    });
  assert(
    painted > 0 && painted < 400,
    `Rectangle selected ${painted}; ${JSON.stringify(canvas)}; ${JSON.stringify(errors)}`,
  );
  await mutate("selection_set", { entityId: cloudId, points: [0, 1, 2] });
  await page.getByText("More selection actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete selected points", exact: true })
    .click();
  let edited = await geometry(cloudId);
  assert.equal(edited.positions.length / 3, 397);
  assert.equal(edited.normals.length, 397 * 3);
  assert.deepEqual(edited.positions, importedPositions.slice(9));
  assert.deepEqual(edited.normals, cloud.normals.slice(9));
  assert(
    (await page.locator(".status-details").innerText()).includes("Points: 397"),
  );
  await page.getByLabel("Apply to selection only", { exact: true }).uncheck();
  await page
    .getByRole("spinbutton", { name: "Target points", exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Reduce point count", exact: true })
    .click();
  for (let i = 0; i < 100; i++) {
    edited = await geometry(cloudId);
    if (edited.positions.length / 3 === 100) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(edited.positions.length / 3, 100);
  assert.equal(edited.normals.length, 300);
  const retained = Array.from(
    { length: 100 },
    (_, i) => 3 + Math.floor((i * 397) / 100),
  );
  const retain = (values) => retained.flatMap((i) => values.slice(i * 3, i * 3 + 3));
  assert.deepEqual(edited.positions, retain(importedPositions));
  assert.deepEqual(edited.normals, retain(cloud.normals));
  await mutate("selection_set", { entityId: cloudId, points: [0] });
  await job(
    await mutate("mesh_process", {
      entityId: cloudId,
      operation: {
        kind: "pointCloudEdit",
        action: "smooth",
        iterations: 3,
        neighborRadius: 5,
        deviation: 0.05,
      },
      selectionOnly: true,
    }),
  );
  const smoothed = await geometry(cloudId);
  assert.deepEqual(smoothed.positions.slice(3), edited.positions.slice(3));
  assert.deepEqual(smoothed.normals, edited.normals);
  await page.screenshot({
    path: fileURLToPath(new URL("point-edit-browser.png", out)),
  });
  assert.deepEqual(errors, []);
  const mesh = {
    ...cloud,
    id: "mesh",
    kind: "mesh",
    normals: undefined,
    positions: [
      0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 30, 0, 0, 40,
      0, 0, 30, 10, 0,
    ],
  };
  const meshUpload = (
    await call("artifact_put", {
      name: "connected.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({ ...project, entities: [mesh] }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: meshUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("selection_set", { entityId: "mesh", triangles: [0] });
  await page.getByRole("button", { name: "Edit scan", exact: true }).click();
  await page
    .getByRole("button", { name: "Select connected objects", exact: true })
    .click();
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await call("selection_get", { entityId: "mesh" })).result.count === 2)
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await call("selection_get", { entityId: "mesh" })).result.count,
    2,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("connected-mesh-browser.png", out)),
  });
  ledger.result = {
    passed: true,
    connectedMeshSelection: true,
    rectangleSelection: painted,
    deletedPoints: 3,
    reducedPoints: 100,
    selectionOnlyMcpSmoothing: true,
    normalsPreserved: true,
    publicGuiAscImport: true,
    importedPoints: 400,
    exactRetainedSamples: true,
    errors,
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("point-edit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
