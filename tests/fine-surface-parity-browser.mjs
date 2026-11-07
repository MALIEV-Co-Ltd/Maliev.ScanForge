import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5188";
let server, transport, client, browserServer, browser;
try {
  if (process.env.SCANFORGE_TEST_START_SERVER === "1") {
    const url = new URL(origin);
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        url.hostname,
        "--port",
        url.port,
        "--strictPort",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw Error("Development server exited");
      if (output.includes("ready in")) {
        try {
          ready = (await fetch(origin)).ok;
        } catch {}
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw Error("Development server did not become ready");
  }
  const token = randomBytes(32).toString("hex"),
    reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
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
  client = new Client({ name: "fine-surface-parity", version: "1" });
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
    throw Error("Fine alignment timed out");
  };
  const entity = (id, positions) => ({
    id,
    name: `${id}.asc`,
    kind: "mesh",
    positions,
    visible: true,
    color: "#cccccc",
    opacity: 1,
  });
  const source = {
    ...entity(
      "moving",
      [2, 2, 0.02, 4, 2, 0.02, 2, 4, 0.02, 2, 2, 0.3, 2, 4, 0.3, 4, 2, 0.3],
    ),
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
  };
  const fixed = entity("fixed", [0, 0, 0, 20, 0, 0, 0, 20, 0]);
  const upload = (
    await call("artifact_put", {
      name: "thin-wall.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Fine surface parity",
          units: "mm",
          entities: [source, fixed],
        }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  const geometry = async () => {
    const obj = (
      await call("object_get", { entityId: "moving", includeGeometry: true })
    ).result;
    const chunk = (
      await call("artifact_read", {
        artifactId: obj.geometry.artifactId,
        offset: 0,
      })
    ).result;
    assert(chunk.eof);
    await call("artifact_delete", { artifactId: obj.geometry.artifactId });
    return JSON.parse(Buffer.from(chunk.base64, "base64").toString()).positions;
  };
  await mutate("object_select", { entityId: "moving" });
  await mutate("command_run", { name: "ribbon:fineAlign" });
  await page
    .getByRole("button", { name: "Registration target", exact: true })
    .click();
  await page.getByRole("option", { name: "fixed.asc", exact: true }).click();
  await page.getByLabel("Expected overlap (%)", { exact: true }).fill("85");
  const before = await geometry(),
    baseline = (await call("project_get")).revision;
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  await page
    .getByText(/Insufficient compatible overlap/)
    .first()
    .waitFor();
  assert.deepEqual(await geometry(), before);
  assert.equal((await call("project_get")).revision, baseline);
  const rejected = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { kind: "icp", overlapPercent: 85 },
    }),
  );
  assert.equal(rejected.registration.applied, false);
  assert.equal(rejected.registration.matching, "fullTargetSurface");
  assert.equal(rejected.registration.rejectedNormalPoints, 3);
  assert.equal((await call("project_get")).revision, baseline);
  await page.getByLabel("Expected overlap (%)", { exact: true }).fill("50");
  await page
    .getByLabel("Target overlap RMS (mm)", { exact: true })
    .fill("0.01");
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  await page
    .getByText(/Target accuracy reached/)
    .first()
    .waitFor();
  const gui = await geometry();
  assert.notDeepEqual(gui, before);
  await mutate("history_undo");
  assert.deepEqual(await geometry(), before);
  const accepted = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { kind: "icp", overlapPercent: 50, targetRms: 0.01 },
    }),
  );
  assert.equal(accepted.registration.matching, "fullTargetSurface");
  assert.equal(accepted.registration.normalCompatibility, true);
  assert.deepEqual(await geometry(), gui);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      rejected: rejected.registration.terminationReason,
      guiMcpGeometryEqual: true,
      errors,
    }),
  );
} finally {
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  server?.kill();
}
