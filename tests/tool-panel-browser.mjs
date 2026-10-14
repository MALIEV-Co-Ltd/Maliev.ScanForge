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
  out = new URL("../.resources/tool-panels/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "tool-panel-isolation-browser",
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
  client = new Client({ name: "tool-panel-validation", version: "1" });
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
    new URL("tool-panels-browser-ledger.json", out),
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

  const mesh = {
    id: "moving",
    name: "Moving scan",
    kind: "mesh",
    positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    visible: true,
    color: "#b4bec4",
    opacity: 1,
  };
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Tool panel verification",
    units: "mm",
    entities: [mesh, { ...mesh, id: "fixed", name: "Fixed scan" }],
  };
  const upload = (
    await call("artifact_put", {
      name: "panels.json",
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
  await mutate("object_select", { entityId: "moving" });
  await mutate("ui_set", { ribbonTab: "scan" });
  await page.getByRole("button", { name: "Fine align", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Tool options" });
  await inspector
    .getByRole("heading", { name: "Fine alignment", exact: true })
    .first()
    .waitFor();
  const text = await inspector.innerText();
  for (const forbidden of [
    "Mesh reconstruction tools",
    "Reduce polygons",
    "Segmentation angle",
    "Global coarse alignment",
    "Source landmarks",
    "Align object to origin",
  ])
    assert(!text.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
  for (const heading of ["Geometry", "Display"])
    assert.equal(
      await inspector
        .getByRole("heading", { name: heading, exact: true })
        .count(),
      0,
    );
  assert(text.includes("Registration target"));
  assert.equal(
    (await call("application_inspect")).result.workspace,
    "fineAlign",
  );
  const checked = [];
  for (const [workspace, label] of [
    ["repairMesh", "Repair mesh topology"],
    ["segmentMesh", "Segmentation angle"],
    ["fillet", "Create fillet"],
    ["chamfer", "Create chamfer"],
    ["shell", "Create hollow shell"],
    ["surfaceThicken", "Thicken surface"],
    ["loft", "Create exact loft"],
    ["sweep", "Create exact sweep"],
    ["extrude", "Extrude sketch to CAD"],
    ["revolve", "Revolve profile to CAD"],
    ["boolean", "Create boolean result"],
  ]) {
    await mutate("ui_set", { workspace, toolPanelOpen: true });
    await inspector.getByText(label, { exact: false }).first().waitFor();
    const content = await inspector.innerText();
    assert(!content.includes("Display"), workspace);
    assert(!content.includes("Registration target"), workspace);
    assert.equal(
      (await call("application_inspect")).result.workspace,
      workspace,
    );
    checked.push(workspace);
  }
  for (const [workspace, resolved] of [
    ["processing", "repairMesh"],
    ["advancedCad", "loft"],
    ["reconstruct", "extrude"],
  ]) {
    await mutate("ui_set", { workspace });
    assert.equal(
      (await call("application_inspect")).result.workspace,
      resolved,
    );
  }
  await mutate("ui_set", { workspace: "fineAlign" });
  await page.screenshot({
    path: fileURLToPath(new URL("fine-align.png", out)),
  });
  await page.getByRole("button", { name: "Object color", exact: true }).click();
  await inspector.getByLabel("Object color", { exact: true }).waitFor();
  assert.equal(
    (await call("application_inspect")).result.workspace,
    "objectColor",
  );
  assert.equal(
    await inspector.getByLabel("Opacity", { exact: true }).count(),
    0,
  );
  assert.equal(
    await inspector
      .getByRole("heading", { name: "Geometry", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await inspector
      .getByText("Align object to origin / references", { exact: true })
      .count(),
    0,
  );
  await mutate("ui_set", { workspace: "fit" });
  await inspector
    .getByRole("heading", { name: "Surface fitting", exact: true })
    .waitFor();
  assert(
    (await inspector.innerText()).toLowerCase().includes("surface fitting"),
  );
  assert(!(await inspector.innerText()).includes("Extrude sketch to CAD"));
  const cloud = {
    ...mesh,
    id: "cloud",
    name: "Scan points",
    kind: "pointcloud",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  };
  const cloudUpload = (
    await call("artifact_put", {
      name: "cloud-panels.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({ ...project, entities: [cloud] }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: cloudUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "cloud" });
  await page.getByRole("button", { name: "Reduce noise", exact: true }).click();
  await inspector
    .getByRole("button", { name: "Reduce point noise", exact: true })
    .waitFor();
  assert.equal(
    (await call("application_inspect")).result.workspace,
    "pointNoise",
  );
  assert(!(await inspector.innerText()).includes("Target points"));
  assert(!(await inspector.innerText()).includes("Select connected points"));
  await page
    .getByRole("button", { name: "Reduce polygons", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Reduce point count", exact: true })
    .waitFor();
  assert.equal(
    (await call("application_inspect")).result.workspace,
    "pointReduce",
  );
  assert(!(await inspector.innerText()).includes("Smoothing iterations"));
  assert(!(await inspector.innerText()).includes("Select connected points"));
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    guiFineAlign: true,
    guiPointCloudPanels: true,
    fittingPanel: true,
    guiObjectColor: true,
    mcpPanels: checked,
    legacyNavigation: true,
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
    new URL("tool-panels-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
