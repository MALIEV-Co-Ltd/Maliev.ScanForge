import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Uses an existing dev server and a disposable browser/workspace and MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const out = join(tmpdir(), `scanforge-cloud-reconstruction-${randomUUID()}`);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser;
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
  client = new Client({ name: "cloud-reconstruction-parity", version: "1" });
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
    for (let i = 0; i < 300; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") {
        assert.equal(state.status, "succeeded", JSON.stringify(state));
        return state.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Fine alignment job timeout");
  };
  const cloud = (id, z) => ({
    id,
    name: id + ".asc",
    kind: "pointcloud",
    positions: Array.from({ length: 81 }, (_, i) => [
      (i % 9) / 2,
      Math.floor(i / 9) / 2,
      z,
    ]).flat(),
    normals: Array.from({ length: 81 }, () => [0, 0, 1]).flat(),
    visible: true,
    color: "#80ff80",
    opacity: 1,
  });
  const original = {
    format: "maliev-scanforge",
    version: 1,
    name: "Cloud reconstruction parity",
    units: "mm",
    entities: [cloud("source", 0), cloud("target", 0.1)],
  };
  const upload = (name, bytes) =>
    call("artifact_put", {
      name,
      offset: 0,
      base64: Buffer.from(bytes).toString("base64"),
    });
  const saved = await upload("cloud.json", JSON.stringify(original));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  const geometry = async (entityId) => {
    const info = (await call("object_get", { entityId, includeGeometry: true }))
      .result;
    const data = (
      await call("artifact_read", {
        artifactId: info.geometry.artifactId,
        offset: 0,
      })
    ).result;
    assert(data.eof);
    return JSON.parse(Buffer.from(data.base64, "base64").toString());
  };
  const before = await geometry("source"),
    target = await geometry("target");
  await mutate("object_select", { entityId: "source" });
  await mutate("command_run", { name: "ribbon:repolygonize" });
  const panel = page.getByRole("region", {
    name: "Re-polygonize",
    exact: true,
  });
  await panel.getByLabel("Point resolution (mm)", { exact: true }).fill("0.5");
  await panel
    .getByRole("checkbox", { name: "target.asc", exact: true })
    .check();
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await panel
    .getByText(/Verified watertight voxel surface/)
    .waitFor({ timeout: 60000 });
  const gui = await geometry("source");
  assert.equal(
    (await call("object_get", { entityId: "source" })).result.kind,
    "mesh",
  );
  assert(gui.positions.length > 0);
  await page.screenshot({ path: join(out, "cloud-to-mesh.png") });
  await mutate("history_undo");
  assert.equal(
    (await call("object_get", { entityId: "source" })).result.kind,
    "pointcloud",
  );
  assert.deepEqual(await geometry("source"), before);
  const run = await job(
    await mutate("mesh_process", {
      entityId: "source",
      targetIds: ["target"],
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution: 0.5 },
      },
    }),
  );
  assert.deepEqual(
    await geometry("source"),
    gui,
    "GUI/public stdio MCP full output equality",
  );
  assert.deepEqual(
    await geometry("target"),
    target,
    "additional target remains unchanged",
  );
  assert.deepEqual(
    {
      points: run.diagnostics.inputPoints,
      processed: run.diagnostics.processedPoints,
      represented: run.diagnostics.representedPoints,
    },
    { points: 162, processed: 162, represented: 162 },
  );
  assert.equal(run.diagnostics.watertight, true);
  await mutate("history_undo");
  await mutate("history_redo");
  assert.deepEqual(await geometry("source"), gui);
  const exported = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    await geometry("source"),
    gui,
    "project roundtrip preserves complete output",
  );
  assert.deepEqual(await geometry("target"), target);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    scope:
      "Synthetic XYZ GUI/public stdio MCP real-worker reconstruction, history and project roundtrip; excludes original-scan quality and native equivalence",
    diagnostics: run.diagnostics,
    triangles: gui.positions.length / 9,
    errors,
  };
  await writeFile(
    join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, out }));
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
}
