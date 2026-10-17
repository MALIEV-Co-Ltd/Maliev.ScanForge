import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Reuses the live application server in an entirely disposable browser profile.
// No server at 5173 is created, stopped or reconfigured by this validation.
const root = new URL("../", import.meta.url);
const origin = "http://127.0.0.1:5173";
const requiredMiB = 4608;
assert(
  freemem() >= requiredMiB * 1024 * 1024,
  `Browser admission requires ${requiredMiB} MiB free; wait for capacity.`,
);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit", timeout: 10000, windowsHide: true },
);
assert.equal(admission.status, 0, "Existing resource admission failed");
const out = new URL(`.resources/sketch-reset/${randomUUID()}/`, root);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "sketch-reset-browser",
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
  scenarios: [],
};
const evidence = new URL("ledger.json", out);
const save = () => writeFile(evidence, JSON.stringify(ledger, null, 2));
function identity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
const runner = identity(process.pid);
ledger.runner = runner;
let reserve, transport, client, browserServer, browser, bridgePort, failure;
const lease = new AbortController();
const timer = setTimeout(() => {
  failure ??= Error(
    "Sketch browser validation exceeded its three-minute lease",
  );
  lease.abort(failure);
  void browserServer?.close().catch(() => {});
  void transport?.close().catch(() => {});
}, 180000);
try {
  assert(await portOpen(5173), "Existing application server is unavailable");
  reserve = http.createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  bridgePort = reserve.address().port;
  ledger.resources.push({
    ...runner,
    kind: "port-reservation",
    port: bridgePort,
    bind: "127.0.0.1",
    persistentData: false,
  });
  await save();
  await new Promise((resolve) => reserve.close(resolve));
  const token = randomBytes(32).toString("hex");
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
  client = new Client({ name: "sketch-reset-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    ...identity(transport.pid),
    kind: "mcp-server",
    port: bridgePort,
    bind: "127.0.0.1",
    persistentData: false,
  });
  await save();
  assert(
    freemem() >= requiredMiB * 1024 * 1024,
    "Browser admission changed; wait for capacity",
  );
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    timeout: 20000,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    ...identity(browserServer.process().pid),
    kind: "browser",
    persistentData: false,
  });
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [];
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
    lease.signal.throwIfAborted();
    const response = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 15000, signal: lease.signal },
    );
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
  const readSketch = async () => (await call("sketch_get")).result.sketch;
  const assertEventually = async (expected) => {
    for (let i = 0; i < 40; i++) {
      const actual = await readSketch();
      try {
        assert.deepEqual(actual, expected);
        return;
      } catch (error) {
        if (i === 39) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  for (const plane of ["OYZ", "OXZ"]) {
    const frame =
      plane === "OYZ"
        ? { origin: [17, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] }
        : {
            origin: [0, -23, 0],
            u: [0, 0, 1],
            v: [1, 0, 0],
            normal: [0, 1, 0],
          };
    const source = {
      version: 1,
      frame,
      reference: {
        kind: "section",
        sourceId: "scan-reference",
        axis: plane === "OYZ" ? "x" : "y",
        offset: plane === "OYZ" ? 17 : -23,
        onSlicingPlane: true,
        selectedOnly: false,
        sampled: false,
        segments: [0, 0, 2, 2],
      },
      points: [
        { id: "old-a", x: 2, y: 3 },
        { id: "old-b", x: 7, y: 8 },
      ],
      segments: [{ id: "old-line", a: "old-a", b: "old-b" }],
      constraints: [],
    };
    await mutate("sketch_manage", {
      action: "create",
      name: `Reset ${plane}`,
      sketch: source,
    });
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
    await assertEventually(source);
    const panel = page.getByRole("region", {
      name: "Parametric sketch",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "Reset rectangle", exact: true })
      .click();
    let reset;
    for (let i = 0; i < 40; i++) {
      reset = await readSketch();
      if (reset.points.length === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(reset.frame, source.frame);
    assert.deepEqual(reset.reference, source.reference);
    assert.deepEqual(
      reset.points.map(({ x, y }) => [x, y]),
      [
        [0, 0],
        [40, 0],
        [40, 30],
        [0, 30],
      ],
    );
    assert.equal(reset.segments.length, 4);
    assert.equal(reset.constraints.length, 7);
    assert(!reset.arcs?.length);
    await panel
      .getByRole("button", { name: "Undo sketch edit", exact: true })
      .click();
    await assertEventually(source);
    await panel
      .getByRole("button", { name: "Redo sketch edit", exact: true })
      .click();
    await assertEventually(reset);
    // The existing MCP geometry replacement must express exactly the GUI result.
    await mutate("sketch_set", { sketch: source });
    await assertEventually(source);
    await mutate("sketch_set", { sketch: reset });
    await assertEventually(reset);
    ledger.scenarios.push({
      plane,
      guiReset: true,
      undoRedo: true,
      mcpEquivalent: true,
    });
    await save();
  }
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: fileURLToPath(new URL("sketch-reset.png", out)),
  });
  ledger.browserErrors = errors;
} catch (error) {
  failure ??= error;
} finally {
  clearTimeout(timer);
  for (const [kind, close] of [
    ["browser-context", () => browser?.close()],
    ["browser-server", () => browserServer?.close()],
    ["mcp-client", () => client?.close()],
    ["mcp-transport", () => transport?.close()],
  ]) {
    try {
      await close();
    } catch (error) {
      ledger.cleanup.push({ kind, error: error.message });
      failure ??= error;
    }
  }
  if (reserve?.listening)
    await new Promise((resolve) => reserve.close(resolve));
  for (const resource of ledger.resources.filter(
    (r) => r.kind === "browser" || r.kind === "mcp-server",
  )) {
    let absent = false;
    for (let i = 0; i < 30; i++) {
      try {
        process.kill(resource.pid, 0);
      } catch {
        absent = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    ledger.cleanup.push({
      kind: resource.kind,
      pid: resource.pid,
      originalStart: resource.startedAt,
      absent,
    });
    if (!absent)
      failure ??= Error(
        `Owned ${resource.kind} ${resource.pid} remains; preserve for exact-identity investigation`,
      );
  }
  if (bridgePort) {
    const closed = !(await portOpen(bridgePort));
    ledger.cleanup.push({ port: bridgePort, closed });
    if (!closed) failure ??= Error("Owned bridge port remains open");
  }
  ledger.existingApplicationPreserved = await portOpen(5173);
  if (!ledger.existingApplicationPreserved)
    failure ??= Error(
      "Existing application server is unavailable after validation",
    );
  ledger.finishedAt = new Date().toISOString();
  ledger.passed = !failure;
  ledger.error = failure?.message;
  await save();
}
if (failure) throw failure;
console.log(
  `Sketch reset browser regression passed: ${fileURLToPath(evidence)}`,
);
