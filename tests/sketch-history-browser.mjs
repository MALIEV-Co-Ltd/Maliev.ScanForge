import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright";
import { sketchHistoryScope } from "./helpers/sketch-history-scope-browser.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Reuses the live application server in an entirely disposable browser profile.
// No server at 5173 is created, stopped or reconfigured by this validation.
const root = new URL("../", import.meta.url);
const origin =
  process.env.SCANFORGE_SKETCH_HISTORY_ORIGIN ?? "http://127.0.0.1:5173";
const target = new URL(origin);
assert.equal(target.protocol, "http:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.origin, origin);
const targetPort = Number(target.port || 80);
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
const out = new URL(`.resources/sketch-history/${randomUUID()}/`, root);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "sketch-history-browser",
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
  scenarios: [],
};
const evidence = new URL("ledger.json", out);
const save = () => writeFile(evidence, JSON.stringify(ledger, null, 2));
function identity(pid, allowAbsent = false) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -eq $p){'null';exit 0}; [pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  if (!allowAbsent)
    assert(value, "Owned process exited before identity capture");
  if (value)
    assert(
      value.startedAt && value.executable,
      "Process identity is incomplete",
    );
  return value;
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
  assert(
    await portOpen(targetPort),
    "Reviewed application server is unavailable",
  );
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
    args: [
      "--max-old-space-size=128",
      "--max-semi-space-size=16",
      fileURLToPath(new URL("scripts/mcp-server.mjs", root)),
    ],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(bridgePort),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  client = new Client({ name: "sketch-history-validation", version: "1" });
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
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=768 --max-semi-space-size=16",
    ],
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
  const raw = async (name, args = {}) => {
    lease.signal.throwIfAborted();
    const response = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 15000, signal: lease.signal },
    );
    return response.structuredContent ?? JSON.parse(response.content[0].text);
  };
  const call = async (name, args = {}) => {
    const wire = await raw(name, args);
    assert(wire.ok, JSON.stringify(wire));
    return wire;
  };
  const mutate = async (name, args) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  await sketchHistoryScope({
    page,
    call,
    raw,
    mutate,
    tools: (await client.listTools()).tools,
    ledger,
    save,
    signal: lease.signal,
  });
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: fileURLToPath(new URL("sketch-history.png", out)),
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
        const current = identity(resource.pid, true);
        if (
          !current ||
          current.startedAt !== resource.startedAt ||
          current.executable.toLowerCase() !== resource.executable.toLowerCase()
        ) {
          absent = true;
          break;
        }
      } catch (error) {
        ledger.cleanup.push({
          kind: resource.kind,
          pid: resource.pid,
          identityError: error.message,
        });
        failure ??= error;
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
  `Sketch history GUI/MCP regression passed: ${fileURLToPath(evidence)}`,
);
