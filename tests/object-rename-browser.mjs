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
  out = new URL("../.resources/object-rename/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "object-rename-browser",
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
  client = new Client({ name: "object-rename-validation", version: "1" });
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
    new URL("object-rename-browser-ledger.json", out),
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
    kind: "mesh",
    positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    visible: true,
    color: "#b4bec4",
    opacity: 1,
  };
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Rename validation",
    units: "mm",
    entities: ["a", "b", "c"].map((id) => ({
      ...mesh,
      id,
      name: `Original ${id}`,
    })),
  };
  const upload = (
    await call("artifact_put", {
      name: "rename.json",
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
  const names = async () =>
    (await call("project_get")).result.objects.map((o) => o.name);
  await mutate("object_select", { entityId: "a" });
  await page.keyboard.press("F2");
  const dialog = page.getByRole("dialog", {
    name: "Rename object",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("individual");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await names(), ["individual", "Original b", "Original c"]);
  await mutate("history_undo", {});
  await mutate("object_select", { entityId: "a" });
  await mutate("object_select", { entityId: "c", range: true });
  await page.keyboard.press("F2");
  await dialog.getByRole("heading", { name: "Rename 3 objects" }).waitFor();
  await dialog.getByLabel("Name", { exact: true }).fill("scan");
  await dialog.getByLabel("Name", { exact: true }).press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await names(), ["scan - 1", "scan - 2", "scan - 3"]);
  await mutate("history_undo", {});
  assert.deepEqual(await names(), ["scan - 1", "scan - 2", "scan - 3"]);
  await mutate("history_redo", {});
  assert.deepEqual(await names(), ["scan - 1", "scan - 2", "scan - 3"]);
  await mutate("object_rename", { entityIds: ["c", "a", "b"], name: "cloud" });
  assert.deepEqual(await names(), ["cloud - 1", "cloud - 2", "cloud - 3"]);
  const selected = (await call("project_get")).result.selectedIds;
  assert.equal(selected.length, 3);
  await page.keyboard.press("F2");
  await dialog.getByLabel("Name", { exact: true }).fill("cancelled");
  await dialog.getByLabel("Name", { exact: true }).press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await names(), ["cloud - 1", "cloud - 2", "cloud - 3"]);
  await mutate("object_select", {});
  await page.keyboard.press("F2");
  assert.equal(await dialog.count(), 0);
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    singleF2: true,
    batchF2: true,
    geometryUndoPreservesNames: true,
    mcpParity: true,
    cancel: true,
    noSelectionGuard: true,
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
    new URL("object-rename-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
