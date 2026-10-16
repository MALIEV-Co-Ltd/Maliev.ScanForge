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
  out = new URL("../.resources/surface-orbit/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "surface-orbit-browser",
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
  client = new Client({ name: "surface-orbit-validation", version: "1" });
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
    new URL("surface-orbit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: 2,
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Hold only disposable picking-index messages, reproducing the unready-index path.
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__heldNavigationIndexes = 0;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.holdPicking = String(url).includes("viewport-picking-worker");
      }
      postMessage(...args) {
        if (!this.holdPicking) super.postMessage(...args);
        else window.__heldNavigationIndexes++;
      }
    };
  });
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

  const positions = [];
  for (const z of [1, -1])
    for (let y = 0; y < 72; y++)
      for (let x = 0; x < 72; x++) {
        const a = -4 + x * 0.125,
          b = -4 + y * 0.125;
        positions.push(
          a,
          b,
          z,
          a + 0.125,
          b,
          z,
          a,
          b + 0.125,
          z,
          a + 0.125,
          b,
          z,
          a + 0.125,
          b + 0.125,
          z,
          a,
          b + 0.125,
          z,
        );
      }
  const artifact = (
    await call("artifact_put", {
      name: "orbit.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Surface orbit validation",
          units: "mm",
          entities: [
            {
              id: "mesh",
              name: "Layered scan",
              kind: "mesh",
              visible: true,
              color: "#b4bec4",
              opacity: 1,
              positions,
            },
          ],
        }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: artifact.artifactId,
      replace: true,
    }),
  );
  assert(
    await page.evaluate(() => window.__heldNavigationIndexes > 0),
    "must exercise the unready-index fallback",
  );
  const { PerspectiveCamera, Vector3 } = await import("three");
  const cameraPoint = (point, state) => {
    const camera = new PerspectiveCamera();
    camera.position.fromArray(state.position);
    camera.up.fromArray(state.up);
    camera.lookAt(new Vector3(...state.target));
    camera.updateMatrixWorld();
    return new Vector3(...point).applyMatrix4(camera.matrixWorldInverse);
  };
  const view = async () => (await call("viewport_get")).result;
  const canvas = page.locator(".viewport canvas").first();
  const results = [];
  for (const projection of ["orthographic", "perspective"]) {
    await mutate("viewport_control", { action: "fit" });
    await mutate("viewport_control", {
      action: "camera",
      projection,
      position: [0, 0, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    for (const [x, y] of [
      [0.62, 0.42],
      [0.43, 0.61],
    ]) {
      const before = await view();
      const hit = (await call("viewport_pick", { x, y, maxHits: 1 })).result
        .hits[0];
      assert(
        hit,
        "expected visible triangle under pointer " +
          JSON.stringify({ projection, x, y, before }),
      );
      const fixed = cameraPoint(hit.point, before);
      const rect = await canvas.boundingBox();
      const px = rect.x + rect.width * x,
        py = rect.y + rect.height * y;
      await page.mouse.move(px, py);
      await page.mouse.down({ button: "middle" });
      const afterDown = await view();
      assert.deepEqual(afterDown.position, before.position);
      assert.deepEqual(afterDown.target, before.target);
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(px + (65 * i) / 12, py + (32 * i) / 12);
        await page.waitForTimeout(20);
        const current = await view();
        const drift = cameraPoint(hit.point, current).distanceTo(fixed);
        assert(
          drift < 0.0001,
          "GUI pivot drift " + drift + " in " + projection,
        );
      }
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(50);
      const guiDrift = cameraPoint(hit.point, await view()).distanceTo(fixed);
      assert(guiDrift < 0.0001, "release changed pivot");
      // Same surface selection is accessible without pointer synthesis through MCP.
      const mcpHit = (await call("viewport_pick", { x, y, maxHits: 1 })).result
        .hits[0];
      assert(mcpHit);
      const mcpBefore = cameraPoint(mcpHit.point, await view());
      await mutate("viewport_control", {
        action: "rotate",
        direction: "left",
        degrees: 12,
        x,
        y,
      });
      const mcpDrift = cameraPoint(mcpHit.point, await view()).distanceTo(
        mcpBefore,
      );
      assert(mcpDrift < 0.0001, "MCP pivot drift " + mcpDrift);
      results.push({ projection, x, y, guiDrift, mcpDrift });
    }
    const beforeMiss = await view();
    const miss = await client.callTool({
      name: "viewport_control",
      arguments: {
        action: "rotate",
        direction: "left",
        degrees: 10,
        x: 0,
        y: 0,
        expectedRevision: (await call("project_get")).revision,
        requestId: randomUUID(),
      },
    });
    const missWire = miss.structuredContent ?? JSON.parse(miss.content[0].text);
    assert.equal(missWire.ok, false);
    assert.deepEqual((await view()).position, beforeMiss.position);
  }
  await page.screenshot({ path: fileURLToPath(new URL("orbit.png", out)) });
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    unreadyIndex: true,
    triangles: 20736,
    deviceScaleFactor: 2,
    results,
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
    new URL("surface-orbit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
