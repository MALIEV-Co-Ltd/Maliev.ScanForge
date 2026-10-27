import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL(
    process.env.SCANFORGE_FLIP_ADMISSION_OUTPUT ??
      "../.resources/flip-admission-browser/",
    import.meta.url,
  );
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "flip-admission-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server,
  reserve,
  browserServer,
  browser,
  client,
  transport,
  failed,
  currentPage;
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
        builtRoot,
      );
      if (!file.href.startsWith(builtRoot.href)) throw Error("Invalid path");
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
  client = new Client({ name: "transform-validation", version: "1" });
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
      "--js-flags=--max-old-space-size=1536",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("flip-admission-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  currentPage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__transformRequests = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
      }
      postMessage(data, ...args) {
        if (this.processing)
          window.__transformRequests.push({
            kind: data.kind,
            operation: data.operation?.kind,
          });
        if (
          this.processing &&
          window.__forceFlipFailure &&
          data.kind === "scanTools" &&
          data.operation?.kind === "flipNormals"
        ) {
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: { error: "Injected Flip failure" },
              }),
            ),
          );
          return;
        }
        return super.postMessage(data, ...args);
      }
    };
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

  const history = async () => (await call("history_get")).result.cursor;

  const sourcePath = process.env.SCANFORGE_M2_SECOND_PLY;
  assert(
    sourcePath,
    "Set SCANFORGE_M2_SECOND_PLY to the pinned second original PLY",
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(sourcePath))
      .digest("hex"),
    "3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f",
  );
  await page
    .locator('input[type=file][accept*=".ply"]')
    .setInputFiles(sourcePath);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "ply-2.ply", exact: true })
    .waitFor({ timeout: 180000 });
  const source = (await call("project_get")).result.objects.find(
    (o) => o.name === "ply-2.ply",
  );
  assert(
    source &&
      source.indexedTopology &&
      source.indexedTopology.triangles > 2000000,
    JSON.stringify(source),
  );
  const target = source.id;
  const readDigest = async () =>
    (
      await job(await call("object_geometry_digest", { entityId: target }))
    ).result.buffers.map(({ path, encoding, elements, sha256 }) => ({
      path,
      encoding,
      elements,
      sha256,
    }));
  const before = await readDigest();
  const cursor = await history();
  const requestCount = await page.evaluate(
    () => window.__transformRequests.length,
  );
  const started = await mutate("mesh_process", {
    entityId: target,
    operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
  });
  let observed, terminal, cancel;
  for (let i = 0; i < 1000; i++) {
    const state = (await call("job_get", { jobId: started.result.jobId }))
      .result;
    if (state.status !== "running") {
      terminal = state;
      break;
    }
    if (state.stage === "Validating indexed topology") {
      observed = state;
      cancel = await call("job_cancel", { jobId: started.result.jobId });
      break;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  assert(
    observed,
    "Did not observe indexed topology validation before job ended",
  );
  assert(cancel, "Cancellation request was not sent");
  terminal = await job(started, "cancelled");
  const requests = await page.evaluate(
    (n) => window.__transformRequests.slice(n),
    requestCount,
  );
  console.log(
    JSON.stringify({
      observedStage: observed.stage,
      terminalStatus: terminal.status,
      requests,
    }),
  );
  assert.deepEqual(await readDigest(), before);
  assert.equal(await history(), cursor);
  assert(
    !requests.some(
      (r) => r.kind === "scanTools" && r.operation === "flipNormals",
    ),
    "Flip worker was dispatched before cancellation",
  );
  await mutate("object_select", { entityId: target });
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Flip normals", exact: true }).click();
  const status = page.getByRole("group", {
    name: "Operation progress",
    exact: true,
  });
  await status
    .getByLabel("Validating indexed topology", { exact: true })
    .waitFor({ timeout: 10000 });
  await page.screenshot({
    path: fileURLToPath(new URL("gui-validating.png", out)),
  });
  await status
    .getByRole("button", { name: "Cancel scan operation", exact: true })
    .click();
  await status
    .getByRole("button", { name: "Cancel scan operation", exact: true })
    .waitFor({ state: "hidden", timeout: 30000 });
  assert.deepEqual(await readDigest(), before);
  assert.equal(await history(), cursor);
  await page.evaluate(() => {
    window.__forceFlipFailure = true;
  });
  await page.getByRole("button", { name: "Flip normals", exact: true }).click();
  await status
    .getByLabel("Flip normals failed.", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByText("Injected Flip failure", { exact: false }).waitFor();
  assert.deepEqual(await readDigest(), before);
  assert.equal(await history(), cursor);
  await page.evaluate(() => {
    window.__forceFlipFailure = false;
  });
  await job(
    await mutate("mesh_process", {
      entityId: target,
      operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
    }),
  );
  assert.notDeepEqual(await readDigest(), before);
  assert.equal(await history(), cursor + 1);
  await mutate("history_undo", {});
  assert.deepEqual(await readDigest(), before);
  assert.equal(await history(), cursor);
  assert.deepEqual(errors, []);
  ledger.result = {
    sourceFacets: source.indexedTopology.triangles,
    sourceVertices: source.indexedTopology.vertices,
    observedStage: observed.stage,
    terminalStatus: terminal.status,
    sourceDigestsUnchanged: true,
    historyUnchanged: true,
    workerNotDispatched: true,
    guiStageAndCancel: true,
    injectedGuiFailureStatus: true,
    retryAndUndo: true,
    pageErrors: errors,
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  if (currentPage) {
    await currentPage
      .screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
      .catch(() => {});
    await writeFile(
      new URL("failure-dom.txt", out),
      await currentPage.locator("body").innerText(),
    ).catch(() => {});
  }
  failed = error;
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
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
    new URL("flip-admission-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
