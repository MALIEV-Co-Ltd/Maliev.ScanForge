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
  out = new URL("../.resources/adaptive-grid/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "adaptive-grid-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    persistentData: false,
    resources: [],
  };
function processIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid}) | Select-Object @{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='executable';e={$_.Path}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return {
    ...JSON.parse(result.stdout),
    expiresAt: ledger.expiresAt,
    persistentData: false,
  };
}
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
  client = new Client({ name: "adaptive-grid-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...processIdentity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("adaptive-grid-browser-ledger.json", out),
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

  const scale = page.locator(".viewport-scale");
  const importModel = async (width) => {
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Adaptive grid validation",
      units: "mm",
      entities: [
        {
          id: "model",
          name: "Size sample",
          kind: "mesh",
          visible: true,
          color: "#b4bec4",
          opacity: 1,
          positions: [0, 0, 0, width, 0, 0, 0, width / 2, 0],
        },
      ],
    };
    const artifact = (
      await call("artifact_put", {
        name: "grid.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(project)).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: artifact.artifactId,
        replace: true,
      }),
    );
    await mutate("viewport_set", { view: "fit" });
    await scale.waitFor({ state: "visible" });
  };
  const settings = async () => (await call("project_get")).result.settings;
  for (const [size, expected] of [
    [40, 10],
    [250, 25],
    [600, 50],
    [1100, 100],
  ]) {
    await importModel(size);
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector(".viewport-scale")
          ?.textContent.includes(`Grid ${expected} mm`),
      expected,
    );
    assert.equal((await settings()).effectiveGridSpacing, expected);
    assert.equal((await settings()).automaticGrid, true);
    const state = await settings();
    const barWidth = await scale
      .locator("i")
      .evaluate((el) => el.getBoundingClientRect().width);
    assert(Math.abs(barWidth - state.scale.widthPx) < 5);
  }
  await page
    .getByRole("button", { name: "Grid and snap settings", exact: true })
    .click();
  await page.getByLabel("Automatic grid spacing", { exact: true }).uncheck();
  await page
    .getByRole("spinbutton", { name: "Grid spacing (mm)", exact: true })
    .fill("25");
  await page.waitForFunction(() =>
    document
      .querySelector(".viewport-scale")
      ?.textContent.includes("Grid 25 mm"),
  );
  assert.equal((await settings()).effectiveGridSpacing, 25);
  assert.equal((await settings()).automaticGrid, false);
  await mutate("settings_set", {
    patch: { automaticGrid: true, gridSpacing: 2.5, snapGrid: true },
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".viewport-scale")
      ?.textContent.includes("Grid 100 mm"),
  );
  const automatic = await settings();
  assert.equal(automatic.gridSpacing, 2.5);
  assert.equal(automatic.snapGrid, true);
  assert.equal(automatic.effectiveGridSpacing, 100);
  assert(
    await page
      .getByLabel("Automatic grid spacing", { exact: true })
      .isChecked(),
  );
  await page
    .getByRole("button", { name: "Close grid settings", exact: true })
    .click();
  const before = (await settings()).scale;
  const canvas = page.locator(".viewport canvas").first();
  await canvas.hover();
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(700);
  const after = (await settings()).scale;
  assert.notDeepEqual(after, before);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(100);
  const bounds = await scale.boundingBox();
  const viewport = await page.locator(".viewport").boundingBox();
  assert(bounds.x + bounds.width <= viewport.x + viewport.width);
  assert(bounds.y + bounds.height <= viewport.y + viewport.height);
  await mutate("viewport_control", {
    action: "projection",
    projection: "perspective",
  });
  assert.equal((await settings()).scale.reference, "view-center");
  await mutate("settings_set", { patch: { theme: "dark" } });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({ path: fileURLToPath(new URL("dark.png", out)) });
  await mutate("settings_set", { patch: { theme: "light", floorGrid: false } });
  await page.waitForFunction(() =>
    document.querySelector(".viewport-scale")?.textContent.includes("Grid off"),
  );
  assert(await scale.isVisible());
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.screenshot({ path: fileURLToPath(new URL("light.png", out)) });
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    modelSizes: [40, 250, 600, 1100],
    automaticSpacing: [10, 25, 50, 100],
    guiAndMcpParity: true,
    independentSnap: true,
    zoom: true,
    resize: true,
    themes: true,
    gridOff: true,
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
    new URL("adaptive-grid-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
