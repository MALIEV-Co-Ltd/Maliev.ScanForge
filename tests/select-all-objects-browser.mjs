import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Uses an existing dev server and a disposable browser/workspace and MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser;
let developmentServer;
const timeout = setTimeout(() => void browserServer?.close(), 180000);
try {
  if (process.env.SCANFORGE_TEST_START_SERVER === "1") {
    const url = new URL(origin);
    developmentServer = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        url.hostname,
        "--port",
        url.port,
        "--strictPort",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let serverOutput = "";
    developmentServer.stdout.on("data", (chunk) => {
      serverOutput += chunk;
    });
    developmentServer.stderr.on("data", (chunk) => {
      serverOutput += chunk;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (developmentServer.exitCode !== null)
        throw Error("Development server exited before becoming ready");
      if (serverOutput.includes("ready in")) {
        try {
          ready = (await fetch(origin)).ok;
        } catch {}
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw Error("Development server did not become ready");
  }
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../scripts/mcp-server.mjs", import.meta.url)),
    ],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(port),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  client = new Client({ name: "object-select-all-parity", version: "1" });
  await client.connect(transport);
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI agents", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill(`http://127.0.0.1:${port}`);
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
  const mutate = async (name, args = {}) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt) => {
    for (let i = 0; i < 300; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") {
        assert.equal(state.status, "succeeded", JSON.stringify(state));
        return state.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Fine alignment job timeout");
  };
  const entities = ["first", "hidden", "locked", "disabled", "last"].map(
    (id, i) => ({
      id,
      name: id,
      kind: "pointcloud",
      positions: [i, 0, 0, i + 1, 0, 0, i, 1, 0],
      visible: id !== "hidden",
      color: "#cccccc",
      opacity: 1,
      ...(id === "locked" ? { locked: true } : {}),
      ...(id === "disabled" ? { selectable: false } : {}),
    }),
  );
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Select all shortcut",
    units: "mm",
    entities,
  };
  const upload = (
    await call("artifact_put", {
      name: "select-all.json",
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
  await page.getByRole("button", { name: "first", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.object-list .object-name[aria-pressed="true"]',
      ).length === 1,
  );
  const before = (await call("project_get")).result;
  await page.evaluate(() => {
    window.__selectAllPrevented = null;
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "a")
        window.__selectAllPrevented = e.defaultPrevented;
    });
  });
  await page.keyboard.press("Control+a");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.object-list .object-name[aria-pressed="true"]',
      ).length === 3,
  );
  assert.equal(await page.evaluate(() => window.__selectAllPrevented), true);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "");
  const selected = (await call("project_get")).result.selectedIds;
  assert.deepEqual(selected, ["first", "hidden", "last"]);
  const after = (await call("project_get")).result;
  assert.equal(after.undo, before.undo);
  assert.equal(after.redo, before.redo);
  await mutate("object_select");
  const all = (await mutate("object_select", { all: true })).result;
  assert.deepEqual(all.selectedIds, selected);
  const afterMcp = (await call("project_get")).result;
  assert.equal(afterMcp.undo, before.undo);
  assert.equal(afterMcp.redo, before.redo);
  // A normal editor textbox retains Ctrl+A's native selection behavior.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI agents", exact: true }).click();
  assert.deepEqual((await call("project_get")).result.selectedIds, selected);
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Local bridge URL" });
  await input.click();
  await input.press("Control+a");
  const range = await input.evaluate((el) => ({
    start: el.selectionStart,
    end: el.selectionEnd,
    length: el.value.length,
  }));
  assert.equal(range.start, 0);
  assert.equal(range.end, range.length);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    selected,
    mcp: all.selectedIds,
    defaultPrevented: true,
    inputSelectionPreserved: true,
    errors,
    browser: "Browser plugin not available; isolated Playwright Chrome",
  };
  console.log(JSON.stringify(evidence));
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  developmentServer?.kill();
}
