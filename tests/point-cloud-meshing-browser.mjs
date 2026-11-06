import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Browser plugin unavailable: disposable Playwright profile + real public MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5187";
const out = new URL("../docs/evidence/cloudcompare-20261028/", import.meta.url);
await mkdir(out, { recursive: true });
assert(
  (await (await fetch(`${origin}/src/point-cloud-meshing.ts`)).text()).includes(
    "projected-delaunay-2.5d",
  ),
  "Dev server does not serve this implementation",
);
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let client, transport, browserServer, browser;
const evidence = {
  origin,
  browser: "Browser plugin not available; isolated Playwright Chrome",
  startedAt: new Date().toISOString(),
  passed: false,
  checks: [],
};
const timeout = setTimeout(() => void browserServer?.close(), 180000);
try {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../scripts/mcp-server.mjs", import.meta.url)),
    ],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(port),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  client = new Client({ name: "projected-cloud-meshing-parity", version: "1" });
  await client.connect(transport);
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  assert.match(await page.title(), /ScanForge/i);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI agents", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill(`http://127.0.0.1:${port}`);
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
  const mutate = async (name, args = {}) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt) => {
    for (let i = 0; i < 600; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Meshing job timed out");
  };
  const succeeded = async (receipt) => {
    const state = await job(receipt);
    assert.equal(state.status, "succeeded", JSON.stringify(state));
    return state.result;
  };
  const load = async (positions) => {
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Projected cloud meshing",
      units: "mm",
      entities: [
        {
          id: "cloud",
          name: "surface.asc",
          kind: "pointcloud",
          positions,
          visible: true,
          color: "#80ff80",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "cloud-mesh.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(project)).toString("base64"),
      })
    ).result;
    await succeeded(
      await mutate("project_import", {
        artifactId: upload.artifactId,
        replace: true,
      }),
    );
    await mutate("object_select", { entityId: "cloud" });
    await mutate("viewport_control", { action: "fit" });
  };
  const geometry = async (entityId) => {
    const entity = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (
        await call("artifact_read", {
          artifactId: entity.geometry.artifactId,
          offset,
        })
      ).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) break;
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const meshGeometry = (geometry) => ({
    positions: geometry.positions,
    vertices: geometry.indexedMesh.vertices,
    triangles: geometry.indexedMesh.triangles,
  });
  const positions = Array.from({ length: 100 }, (_, i) => [
    i % 10,
    Math.floor(i / 10),
    0.02 * (i % 10) ** 2,
  ]).flat();
  await load(positions);
  const before = (await call("project_get")).result;
  const source = await geometry("cloud");
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.getByText("Mesh a projected surface", { exact: true }).click();
  await page.getByLabel("Maximum mesh edge (mm)", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Create projected mesh", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: fileURLToPath(new URL("meshing-gui-controls.png", out)),
  });
  await page
    .getByRole("button", { name: "Create projected mesh", exact: true })
    .click();
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = (await call("project_get")).result;
      if (current.objects.length === 2) break;
      if (attempt === 199)
        throw Error(
          `GUI meshing did not create a mesh: ${await page.locator("body").innerText()}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    await page.screenshot({
      path: fileURLToPath(new URL("meshing-gui-failure.png", out)),
    });
    throw error;
  }
  const after = (await call("project_get")).result;
  assert.equal(after.objects.length, 2);
  assert.equal(after.undo, before.undo + 1);
  const meshId = after.objects.find((o) => o.id !== "cloud").id;
  const gui = await geometry(meshId);
  assert.deepEqual(await geometry("cloud"), source);
  await mutate("viewport_control", { action: "fit" });
  await page.screenshot({
    path: fileURLToPath(new URL("meshing-gui-result.png", out)),
  });
  await mutate("history_undo");
  assert.equal((await call("project_get")).result.objects.length, 1);
  await mutate("history_redo");
  assert.deepEqual(meshGeometry(await geometry(meshId)), meshGeometry(gui));
  await mutate("history_undo");
  const mcp = await succeeded(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 2 },
    }),
  );
  assert.deepEqual(
    meshGeometry(await geometry(mcp.entityIds[0])),
    meshGeometry(gui),
  );
  assert.deepEqual(await geometry("cloud"), source);
  assert.equal(mcp.diagnostics.triangles, 162);
  evidence.guiMcp = mcp.diagnostics;
  evidence.checks.push(
    "GUI/public MCP identical expanded and indexed geometry",
    "source unchanged",
    "single history entry",
    "Undo/Redo restore exact mesh",
  );
  for (const [plane, points] of [
    ["xz", [0, 0, 0, 1, 0, 0, 0, 0, 1]],
    ["yz", [0, 0, 0, 0, 1, 0, 0, 0, 1]],
  ]) {
    await load(points);
    const result = await succeeded(
      await mutate("mesh_process", {
        entityId: "cloud",
        operation: { kind: "pointCloudMesh", plane, maxEdgeLength: 2 },
      }),
    );
    assert.equal(result.diagnostics.triangles, 1);
    assert.equal(result.diagnostics.projectionPlane, plane);
  }
  await load([0, 0, 0, 1, 0, 10, 0, 1, 0]);
  const cutoffBefore = await call("project_get");
  const failed = await job(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 2 },
    }),
  );
  assert.equal(failed.status, "failed");
  assert.match(failed.error.message, /No triangle/);
  const cutoffAfter = await call("project_get");
  assert.equal(cutoffAfter.revision, cutoffBefore.revision);
  assert.equal(cutoffAfter.result.undo, cutoffBefore.result.undo);
  const unpruned = await succeeded(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 0 },
    }),
  );
  assert.equal(unpruned.diagnostics.triangles, 1);
  evidence.edgeCutoff = {
    failure: failed.error,
    unpruned: unpruned.diagnostics,
  };
  evidence.checks.push(
    "XZ/YZ projections via public MCP",
    "3D edge cutoff rejects a steep triangle and leaves revision/history unchanged",
  );
  const fixedText = await readFile(
    new URL("fixtures/projected-meshing-fixed.ply", import.meta.url),
    "utf8",
  );
  const fixed = fixedText
    .split(/end_header\r?\n/)[1]
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => line.trim().split(/\s+/).slice(0, 3).map(Number));
  await load(fixed);
  const real = await succeeded(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 2 },
    }),
  );
  evidence.nativeFixture = real.diagnostics;
  assert.equal(real.diagnostics.sourcePoints, 437);
  assert.equal(real.diagnostics.triangles, 772);
  await writeFile(
    new URL("meshing-scanforge-native-fixture-geometry.json", out),
    JSON.stringify(await geometry(real.entityIds[0])) + "\n",
  );
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  evidence.passed = true;
} catch (error) {
  evidence.error = error.message;
  throw error;
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    new URL("meshing-browser-evidence.json", out),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
}
