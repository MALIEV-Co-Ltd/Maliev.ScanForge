import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const startedAt = new Date().toISOString();
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "scanforge-sketch-construction-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/sketch-construction/", root);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport;
let failed, activePage;
const mime = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  wasm: "application/wasm",
  json: "application/json",
  svg: "image/svg+xml",
};
const staticServer = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const file = new URL(
      path === "/" ? "index.html" : path.slice(1),
      new URL("dist/", root),
    );
    if (!file.href.startsWith(new URL("dist/", root).href))
      throw Error("Forbidden path");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        mime[file.pathname.split(".").pop()] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
staticServer.requestTimeout = 10000;
await new Promise((resolve, reject) => {
  staticServer.once("error", reject);
  staticServer.listen(0, "127.0.0.1", resolve);
});
const appPort = staticServer.address().port,
  origin = `http://127.0.0.1:${appPort}`;
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const bridgePort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
ledger.resources.push({
  kind: "http-server",
  pid: process.pid,
  executable: process.execPath,
  startedAt,
  port: appPort,
  bind: "127.0.0.1",
  purpose: "isolated built application",
});
const deadline = setTimeout(() => {
  failed = Error("Browser validation exceeded4minute lease");
  void cleanup();
}, 240000);
async function cleanup() {
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await new Promise((resolve) => {
    staticServer.close(resolve);
    staticServer.closeAllConnections();
  });
  for (const port of [appPort, bridgePort]) {
    let closed = false;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      closed = true;
    }
    ledger.cleanup.push({ port, closed });
    assert(closed, `Port ${port} remained open`);
  }
  for (const resource of ledger.resources.filter((r) =>
    ["mcp-stdio-child", "disposable-browser"].includes(r.kind),
  )) {
    let exited = false;
    try {
      process.kill(resource.pid, 0);
    } catch {
      exited = true;
    }
    ledger.cleanup.push({ pid: resource.pid, exited });
    assert(exited, `${resource.kind} process still alive`);
  }
  await writeFile(
    evidence,
    JSON.stringify(
      { ...ledger, passed: !failed, error: failed?.message },
      null,
      2,
    ),
  );
}
try {
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
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "scanforge-browser-smoke", version: "1.0.0" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-stdio-child",
    pid: transport.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    port: bridgePort,
    bind: "127.0.0.1",
    purpose: "actual stdio SDK and browser bridge",
  });
  const discovered = await client.listTools();
  assert(discovered.tools.length >= 35);
  const guide = await client.readResource({ uri: "scanforge://agent-guide" });
  assert(guide.contents[0].text.includes("expectedRevision"));
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    kind: "disposable-browser",
    pid: browserServer.process().pid,
    executable: "installed Chrome",
    startedAt: new Date().toISOString(),
    purpose: "isolated profile and UI validation",
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  activePage = page;
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
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
  // Closing Settings must leave the paired session alive.
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const wire = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
    return wire;
  }
  async function mutate(name, args) {
    const state = await call("project_get");
    return call(name, {
      ...args,
      expectedRevision: state.revision,
      requestId: randomUUID(),
    });
  }
  async function job(receipt) {
    const id = receipt.result.jobId;
    for (let i = 0; i < 120; i++) {
      const result = await call("job_get", { jobId: id });
      if (result.result.status !== "running") {
        assert.equal(result.result.status, "succeeded", JSON.stringify(result));
        return result.result.result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Geometry job failed to settle");
  }
  await mutate("settings_set", {
    patch: { theme: "dark", floorGrid: false, originVisible: false },
  });
  const sketch = {
    version: 1,
    points: [
      { id: "a", x: -20, y: -20 },
      { id: "b", x: -20, y: 20 },
      { id: "c", x: 20, y: -20 },
      { id: "d", x: 20, y: 20 },
    ],
    segments: [
      { id: "ordinary", a: "a", b: "b" },
      { id: "reference", a: "c", b: "d", construction: true },
    ],
    constraints: [],
  };
  await mutate("sketch_manage", {
    action: "create",
    name: "Construction display",
    sketch,
  });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.getByLabel("Control points", { exact: true }).uncheck();
  await mutate("viewport_control", {
    action: "camera",
    position: [0, 0, 100],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "perspective",
    zoom: 1,
  });
  const view = (await call("viewport_get")).result;
  const canvas = page.locator(".viewport > canvas").first();
  const halfHeight = 100 * Math.tan((42 * Math.PI) / 360),
    aspect = view.viewport.width / view.viewport.height;
  const screen = ([x, y]) => [
    ((x / (halfHeight * aspect) + 1) * view.viewport.width) / 2,
    ((1 - y / halfHeight) * view.viewport.height) / 2,
  ];
  async function pixels(name, samples) {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const png = await canvas.screenshot();
    await writeFile(new URL(name + ".png", artifactDir), png);
    return page.evaluate(
      async ({ base64, samples }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const surface = new OffscreenCanvas(image.width, image.height),
          context = surface.getContext("2d");
        context.drawImage(image, 0, 0);
        const { data, width, height } = context.getImageData(
          0,
          0,
          image.width,
          image.height,
        );
        const visible = samples.map(([x, y]) => {
          for (let yy = Math.round(y) - 1; yy <= Math.round(y) + 1; yy++)
            for (let xx = Math.round(x) - 1; xx <= Math.round(x) + 1; xx++) {
              if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
              const offset = (yy * width + xx) * 4,
                rgb = [data[offset], data[offset + 1], data[offset + 2]];
              if (
                Math.min(...rgb) > 140 &&
                Math.max(...rgb) - Math.min(...rgb) < 25
              )
                return true;
            }
          return false;
        });
        return {
          coverage: visible.filter(Boolean).length / visible.length,
          changes: visible.filter((value, i) => i && value !== visible[i - 1])
            .length,
        };
      },
      { base64: png.toString("base64"), samples },
    );
  }
  const lineSamples = (x) =>
    Array.from({ length: 300 }, (_, i) => screen([x, -17 + (i * 34) / 299]));
  const regular = await pixels("ordinary-line", lineSamples(-20));
  const dashed = await pixels("construction-line", lineSamples(20));
  assert(regular.coverage > 0.97, JSON.stringify({ regular }));
  assert(
    dashed.coverage < 0.94 && dashed.coverage > 0.2 && dashed.changes >= 6,
    JSON.stringify({ dashed }),
  );
  const before = (await call("sketch_get")).result.sketch;
  await mutate("sketch_set", {
    sketch: {
      ...before,
      segments: before.segments.map((s) => ({ ...s, construction: false })),
    },
  });
  const solid = await pixels("reference-as-ordinary", lineSamples(20));
  assert(solid.coverage > 0.97, JSON.stringify({ solid }));
  await mutate("history_undo", { scope: "sketch" });
  const restored = (await call("sketch_get")).result.sketch;
  assert.deepEqual(restored, before);
  const restoredPixels = await pixels("construction-undo", lineSamples(20));
  assert(
    restoredPixels.coverage < 0.94 && restoredPixels.changes >= 6,
    JSON.stringify({ restoredPixels }),
  );
  await panel
    .getByLabel("reference For construction", { exact: true })
    .uncheck();
  const gui = (await call("sketch_get")).result.sketch;
  assert.equal(
    gui.segments.find((s) => s.id === "reference").construction,
    false,
  );
  assert.deepEqual(gui.points, before.points);
  const guiSolid = await pixels("gui-toggle-solid", lineSamples(20));
  assert(guiSolid.coverage > 0.97, JSON.stringify({ guiSolid }));
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, before);
  const arcSketch = {
    ...sketch,
    points: [
      sketch.points[0],
      sketch.points[1],
      { id: "start", x: 10, y: 0 },
      { id: "end", x: 30, y: 0 },
      { id: "center", x: 20, y: 0 },
    ],
    segments: [sketch.segments[0]],
    arcs: [
      {
        id: "arc",
        a: "start",
        b: "end",
        center: "center",
        clockwise: false,
        construction: true,
      },
    ],
  };
  await mutate("sketch_set", { sketch: arcSketch });
  const arcSamples = Array.from({ length: 400 }, (_, i) => {
    const angle = Math.PI + 0.15 + (i * (Math.PI - 0.3)) / 399;
    return screen([20 + 10 * Math.cos(angle), 10 * Math.sin(angle)]);
  });
  const arcDash = await pixels("construction-arc", arcSamples);
  assert(
    arcDash.coverage < 0.94 && arcDash.coverage > 0.2 && arcDash.changes >= 6,
    JSON.stringify({ arcDash }),
  );
  await mutate("sketch_set", {
    sketch: {
      ...arcSketch,
      arcs: [{ ...arcSketch.arcs[0], construction: false }],
    },
  });
  const arcSolid = await pixels("ordinary-arc", arcSamples);
  assert(arcSolid.coverage > 0.95, JSON.stringify({ arcSolid }));
  const separated = {
    version: 1,
    points: [
      { id: "near-a", x: 20, y: -20 },
      { id: "near-b", x: 20, y: 20 },
      { id: "far-a", x: 10020, y: -20 },
      { id: "far-b", x: 10020, y: 20 },
    ],
    segments: [
      { id: "near", a: "near-a", b: "near-b", construction: true },
      { id: "far", a: "far-a", b: "far-b", construction: true },
    ],
    constraints: [],
  };
  await mutate("sketch_set", { sketch: separated });
  const separatedNear = await pixels(
    "separated-near-reference",
    lineSamples(20),
  );
  assert(
    separatedNear.coverage < 0.94 &&
      separatedNear.coverage > 0.2 &&
      separatedNear.changes >= 6,
    JSON.stringify({ separatedNear }),
  );
  await mutate("viewport_control", {
    action: "camera",
    position: [10000, 0, 100],
    target: [10000, 0, 0],
    up: [0, 1, 0],
    projection: "perspective",
    zoom: 1,
  });
  const separatedFar = await pixels("separated-far-reference", lineSamples(20));
  assert(
    separatedFar.coverage < 0.94 &&
      separatedFar.coverage > 0.2 &&
      separatedFar.changes >= 6,
    JSON.stringify({ separatedFar }),
  );
  assert.deepEqual(
    (await call("sketch_get")).result.sketch,
    separated,
    "camera/render preserve separated reference coordinates",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.pixelChecks = {
    regular,
    dashed,
    solid,
    restoredPixels,
    guiSolid,
    arcDash,
    arcSolid,
    separatedNear,
    separatedFar,
  };
  ledger.steps = [
    "actual viewport canvas has gaps for construction lines/arcs and continuous ordinary curves",
    "MCP construction toggle and undo update rendered material without changing positions",
    "GUI construction toggle agrees with MCP and sketch history",
    "widely separated construction primitives remain dashed when framed individually",
  ];
  console.log("PASS: " + JSON.stringify(ledger.pixelChecks));
} catch (error) {
  failed = error;
  if (activePage) {
    await writeFile(
      new URL("failure-dom.txt", artifactDir),
      await activePage.locator("body").innerText(),
    );
    await activePage.screenshot({
      path: fileURLToPath(new URL("failure.png", artifactDir)),
    });
  }
  throw error;
} finally {
  await cleanup();
}
