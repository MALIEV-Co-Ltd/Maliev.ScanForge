import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
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
  owner: "scanforge-sketch-symmetry-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/sketch-symmetry/", root);
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
  const sketch = {
    version: 1,
    points: [
      { id: "a", x: -3, y: 0 },
      { id: "b", x: -3, y: 4 },
      { id: "c", x: 4, y: 0.3 },
      { id: "d", x: 4, y: 4.3 },
      { id: "o", x: 0, y: -5 },
      { id: "q", x: 0, y: 10 },
    ],
    segments: [
      { id: "left", a: "a", b: "b" },
      { id: "right", a: "c", b: "d" },
      { id: "axis", a: "o", b: "q", construction: true },
    ],
    constraints: ["a", "b", "o", "q"].map((id) => {
      const point = {
        a: { x: -3, y: 0 },
        b: { x: -3, y: 4 },
        o: { x: 0, y: -5 },
        q: { x: 0, y: 10 },
      }[id];
      return { id: "fix-" + id, kind: "fixed", point: id, ...point };
    }),
  };
  const relation = {
    id: "mcp-symmetry",
    kind: "symmetric",
    first: "left",
    second: "right",
    axis: "axis",
    reverse: false,
  };
  const candidate = {
    ...sketch,
    constraints: [...sketch.constraints, relation],
  };
  const solved = (await call("sketch_solve", { sketch: candidate })).result;
  assert(solved.converged);
  assert.equal(solved.degreesOfFreedom, 0);
  assert.equal(
    discovered.tools.find((t) => t.name === "sketch_set").inputSchema.properties
      .solve.default,
    false,
  );
  const active = (
    await mutate("sketch_manage", {
      action: "create",
      name: "Symmetric lines",
      sketch,
    })
  ).result.sketchId;
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.getByRole("button", { name: "Constraint", exact: true }).click();
  await page.getByRole("option", { name: "symmetric", exact: true }).click();
  await panel
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  let gui;
  for (let i = 0; i < 80; i++) {
    const current = (await call("sketch_get")).result.sketch;
    if (current.constraints.some((c) => c.kind === "symmetric")) {
      gui = current;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(gui, "GUI symmetry committed");
  assert.deepEqual(
    gui.points,
    solved.sketch.points,
    "GUI/MCP same exact solved coordinates",
  );
  await panel.getByRole("button", { name: "Constraint", exact: true }).click();
  const popup = page.getByRole("listbox", {
    name: "Choose an option",
    exact: true,
  });
  await popup.waitFor({ state: "visible" });
  const sidebar = await page.locator("aside.inspector").boundingBox();
  assert(sidebar);
  await page.mouse.move(sidebar.x + 20, sidebar.y + 80);
  await page.mouse.wheel(0, -180);
  await popup.waitFor({ state: "hidden" });
  const persisted = gui.constraints.find((c) => c.kind === "symmetric");
  assert.deepEqual({ ...persisted, id: relation.id }, relation);
  assert.equal(
    (await call("project_get")).result.undo,
    0,
    "sketch edits preserve model history",
  );
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  assert.deepEqual((await call("sketch_get")).result.sketch, sketch);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, gui);
  const conflicting = {
    ...gui,
    constraints: [
      ...gui.constraints,
      { id: "conflict", kind: "fixed", point: "c", x: 7, y: 0 },
    ],
  };
  const revision = (await call("project_get")).revision;
  const invalid = await client.callTool({
    name: "sketch_set",
    arguments: {
      sketch: conflicting,
      solve: true,
      expectedRevision: revision,
      requestId: randomUUID(),
    },
  });
  const invalidWire =
    invalid.structuredContent ?? JSON.parse(invalid.content[0].text);
  assert.equal(invalidWire.ok, false);
  assert.match(invalidWire.error.message, /conflict|unsolved/i);
  assert.deepEqual((await call("sketch_get")).result.sketch, gui);
  assert.equal((await call("project_get")).revision, revision);
  const saved = await job(await call("project_export", { format: "project" }));
  const artifact = (
    await call("artifact_read", { artifactId: saved.artifactId })
  ).result;
  await writeFile(
    new URL("symmetry-example.scanforge", artifactDir),
    Buffer.from(artifact.base64, "base64"),
  );
  await mutate("sketch_set", { sketch });
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  const restored = (await call("sketch_get")).result;
  assert.equal(restored.activeSketchId, active);
  assert.deepEqual(restored.sketch, gui);
  assert.deepEqual(restored.sketches.find((s) => s.id === active).sketch, gui);
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  await panel
    .getByRole("button", { name: "Remove segment axis", exact: true })
    .click();
  const removed = (await call("sketch_get")).result.sketch;
  assert(!removed.constraints.some((c) => c.kind === "symmetric"));
  assert(!removed.segments.some((s) => s.id === "axis"));
  for (const reverse of [false, true]) {
    const arcSketch = {
      version: 1,
      points: [
        { id: "a", x: -2, y: 0 },
        { id: "b", x: -3, y: 1 },
        { id: "lc", x: -3, y: 0 },
        { id: "c", x: reverse ? 3.2 : 2.2, y: reverse ? 1.2 : 0.2 },
        { id: "d", x: reverse ? 2.2 : 3.2, y: reverse ? 0.2 : 1.2 },
        { id: "rc", x: 3.2, y: 0.2 },
        { id: "o", x: 0, y: -4 },
        { id: "q", x: 0, y: 5 },
      ],
      segments: [{ id: "axis", a: "o", b: "q", construction: true }],
      arcs: [
        { id: "left", a: "a", b: "b", center: "lc", clockwise: false },
        { id: "right", a: "c", b: "d", center: "rc", clockwise: !reverse },
      ],
      constraints: [],
    };
    arcSketch.constraints = arcSketch.points
      .filter((p) => ["a", "b", "lc", "o", "q"].includes(p.id))
      .map((p) => ({
        id: "fix-" + p.id,
        kind: "fixed",
        point: p.id,
        x: p.x,
        y: p.y,
      }));
    const arcRelation = { ...relation, reverse };
    const expected = (
      await call("sketch_solve", {
        sketch: {
          ...arcSketch,
          constraints: [...arcSketch.constraints, arcRelation],
        },
      })
    ).result;
    assert(expected.converged);
    assert.equal(expected.degreesOfFreedom, 0);
    await mutate("sketch_manage", {
      action: "create",
      name: "Symmetric arcs " + reverse,
      sketch: arcSketch,
    });
    await panel
      .getByRole("button", { name: "Constraint", exact: true })
      .click();
    await page.getByRole("option", { name: "symmetric", exact: true }).click();
    await panel
      .getByLabel("Reverse endpoint pairing", { exact: true })
      .setChecked(reverse);
    await panel
      .getByRole("button", { name: "Add constraint", exact: true })
      .click();
    let applied;
    for (let i = 0; i < 80; i++) {
      const current = (await call("sketch_get")).result.sketch;
      if (current.constraints.some((c) => c.kind === "symmetric")) {
        applied = current;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(applied, "GUI arc symmetry committed");
    assert.deepEqual(applied.points, expected.sketch.points);
    assert.deepEqual(
      {
        ...applied.constraints.find((c) => c.kind === "symmetric"),
        id: arcRelation.id,
      },
      arcRelation,
    );
    const arcSaved = await job(
      await call("project_export", { format: "project" }),
    );
    await mutate("sketch_set", { sketch: arcSketch });
    await job(
      await mutate("project_import", {
        artifactId: arcSaved.artifactId,
        replace: true,
      }),
    );
    assert.deepEqual((await call("sketch_get")).result.sketch, applied);
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "official SDK and discoverable solve flag",
    "mouse selection survives stale scroll; actual panel movement dismisses popup",
    "GUI symmetry through shared solve-before-apply operation",
    "exact GUI/MCP solved coordinates and local DOF",
    "sketch GUI undo and MCP redo preserve model timeline",
    "conflicting atomic solve preserves draft/revision",
    "project export/reimport preserves active sketch and symmetry relation",
    "GUI axis deletion removes dependent symmetry",
    "GUI/MCP arc symmetry and reversed endpoint pairing preserve exact solved coordinates after project reopen",
  ];
  console.log("PASS: " + ledger.steps.join("; "));
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
