import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
// Optional extracted single-hole component: positions, rim, center and radius.

const half = process.env.SCANFORGE_HALF_RECONSTRUCTION === "1";
const fine = half || process.env.SCANFORGE_FINE_RECONSTRUCTION === "1";
const resolution = half ? 0.5 : fine ? 1 : 0.5;
const root = new URL("../", import.meta.url),
  out = new URL(
    half
      ? "../.resources/half-browser/"
      : fine
        ? "../.resources/fine-browser/"
        : "../.resources/watertight-browser/",
    import.meta.url,
  );
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "watertight-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
function identity(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${pid} | Select-Object Id,Path,@{Name='actualStartedAt';Expression={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(result.status, 0, "Could not record owned process identity");
  return JSON.parse(result.stdout);
}
Object.assign(ledger, identity(process.pid));
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
  client = new Client({ name: "watertight-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...identity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=512",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("watertight-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
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

  const artifactJson = async (artifact) => {
    const chunks = [];
    let offset = 0;
    do {
      const wire = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const bytes = Buffer.from(wire.base64, "base64");
      assert(bytes.length > 0);
      chunks.push(bytes);
      offset += bytes.length;
    } while (offset < artifact.bytes);
    return JSON.parse(Buffer.concat(chunks).toString());
  };

  const { BoxGeometry } = await import("three");
  function cube(id, offset) {
    const indexed = new BoxGeometry(2, 2, 2),
      g = indexed.toNonIndexed();
    const p = Array.from(g.getAttribute("position").array);
    // Deliberately remove one triangle from each input.
    p.splice(0, 9);
    for (let i = 0; i < p.length; i += fine ? 1 : 3) p[i] += offset;
    indexed.dispose();
    g.dispose();
    return {
      id,
      name: id,
      kind: "mesh",
      positions: p,
      visible: true,
      color: "#aaaaaa",
      opacity: 1,
    };
  }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Watertight reconstruction parity",
    units: "mm",
    entities: [
      cube("panel", 0),
      cube("Aligned reference", half ? 260 : fine ? 120 : 1),
    ],
  };
  const bytes = Buffer.from(JSON.stringify(project));
  let upload;
  for (let offset = 0; offset < bytes.length; offset += 262144) {
    upload = (
      await call("artifact_put", {
        name: "panel.json",
        offset,
        base64: bytes.subarray(offset, offset + 262144).toString("base64"),
        ...(upload ? { artifactId: upload.artifactId } : {}),
      })
    ).result;
  }
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "panel" });

  const geometry = async (id) =>
    artifactJson(
      (await call("object_get", { entityId: id, includeGeometry: true })).result
        .geometry,
    );
  const before = await geometry("panel"),
    reference = await geometry("Aligned reference");
  const history = async () => (await call("history_get")).result.cursor;
  const cursor = await history();
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page
    .getByRole("button", { name: "Re-polygonize", exact: true })
    .click();
  const controls = page.locator(".scan-tools-panel");
  await controls
    .getByRole("checkbox", { name: "Aligned reference", exact: true })
    .check();
  await controls.getByRole("spinbutton").fill(String(resolution));
  await controls.getByRole("button", { name: "Apply", exact: true }).click();
  await page
    .getByText(/Verified watertight voxel surface/)
    .first()
    .waitFor({ timeout: 60000 })
    .catch(async (error) => {
      await page.screenshot({
        path: fileURLToPath(new URL("failure.png", out)),
      });
      console.error(await page.locator("body").innerText());
      throw error;
    });
  const gui = await geometry("panel");
  assert.notDeepEqual(gui.positions, before.positions);
  assert.deepEqual(
    (await geometry("Aligned reference")).positions,
    reference.positions,
  );
  assert.equal(await history(), cursor + 1);
  await page.screenshot({ path: fileURLToPath(new URL("result.png", out)) });
  const measured = await job(
    await call("mesh_analyze", { entityId: "panel", tolerance: 0.000001 }),
  );
  const topology = measured.result.topology;
  for (const key of [
    "boundaryEdges",
    "nonManifoldEdges",
    "nonManifoldVertices",
    "inconsistentEdges",
    "degenerateTriangles",
    "duplicateTriangles",
  ])
    assert.equal(topology[key], 0, key);
  assert.equal(topology.components, fine ? 2 : 1);
  await mutate("history_undo", {});
  assert.deepEqual((await geometry("panel")).positions, before.positions);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry("panel")).positions, gui.positions);
  await mutate("history_undo", {});
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      targetIds: ["Aligned reference"],
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution },
      },
    }),
  );
  assert.equal(mcp.result.diagnostics.watertight, true);
  assert.equal(mcp.result.diagnostics.inputMeshes, 2);
  if (fine)
    assert(
      mcp.result.diagnostics.gridPoints > (half ? 128_000_000 : 1_000_000),
    );
  assert.deepEqual(mcp.result.topology, { ...topology, watertight: true });
  assert.deepEqual((await geometry("panel")).positions, gui.positions);
  assert.deepEqual(
    (await geometry("Aligned reference")).positions,
    reference.positions,
  );
  assert.deepEqual(errors, []);
  ledger.result = {
    guiMcpEqual: true,
    referencePreserved: true,
    undoRedo: true,
    topology,
    diagnostics: mcp.result.diagnostics,
    pageErrors: errors,
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
    new URL("watertight-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
