import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Uses an existing dev server and a disposable browser/workspace and MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5174";
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser;
let developmentServer;
const timeout = setTimeout(() => void browserServer?.close(), 240000);
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
  client = new Client({ name: "fine-alignment-parity", version: "1" });
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
  const geometry = async (ids) => {
    const result = [];
    for (const entityId of ids) {
      const object = (
        await call("object_get", { entityId, includeGeometry: true })
      ).result;
      const bytes = [];
      let offset = 0,
        eof = false;
      while (!eof) {
        const chunk = (
          await call("artifact_read", {
            artifactId: object.geometry.artifactId,
            offset,
            length: 262144,
          })
        ).result;
        bytes.push(Buffer.from(chunk.base64, "base64"));
        offset = chunk.nextOffset;
        eof = chunk.eof;
      }
      const raw = Buffer.concat(bytes);
      const decoded = JSON.parse(raw.toString("utf8"));
      assert(
        decoded.positions.length > 0 &&
          decoded.positions.every(Number.isFinite),
        "Authored coordinates detached or invalid",
      );
      result.push({
        id: entityId,
        sha256: createHash("sha256").update(raw).digest("hex"),
        coordinates: decoded.positions.length,
      });
      await call("artifact_delete", { artifactId: object.geometry.artifactId });
    }
    return result;
  };
  const points = [];
  for (const z of [0, 3])
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 10; j++) {
        const x = i - 10,
          y = j - 5,
          c = Math.cos(0.43),
          s = Math.sin(0.43),
          a = x * c - y * s,
          b = x * s + y * c;
        points.push(
          a + 32,
          b * Math.cos(0.6) - z * Math.sin(0.6) - 18,
          b * Math.sin(0.6) + z * Math.cos(0.6) + 75,
        );
      }
  const upload = (
    await call("artifact_put", {
      name: "cad-setup.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "CAD setup parity",
          units: "mm",
          entities: [
            {
              id: "scan",
              name: "Tilted scan",
              kind: "pointcloud",
              positions: points,
              visible: true,
              color: "#a6a6a6",
              opacity: 1,
            },
          ],
        }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  const ids = ["scan"],
    original = await geometry(ids),
    history = (await call("history_get")).result;
  await mutate("object_select", { entityId: "scan" });
  await mutate("command_run", { name: "ribbon:align" });
  await page.getByLabel("Coordinate setup method").selectOption("automatic");
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Alignment preview ready" })
    .waitFor();
  assert.deepEqual(await geometry(ids), original);
  const menuBox = await page
    .getByRole("complementary", { name: "Tool options", exact: true })
    .boundingBox();
  const applyBox = await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .boundingBox();
  assert(
    applyBox.y + applyBox.height <= menuBox.y + menuBox.height + 1,
    JSON.stringify({
      menuBox,
      applyBox,
      parents: await page
        .getByRole("button", { name: "Apply alignment", exact: true })
        .evaluate((el) => {
          const a = [];
          for (let p = el; p && a.length < 7; p = p.parentElement) {
            const c = getComputedStyle(p),
              r = p.getBoundingClientRect();
            a.push({
              tag: p.tagName,
              cls: p.className,
              h: r.height,
              y: r.y,
              flex: c.flex,
              display: c.display,
              overflow: c.overflow,
              minHeight: c.minHeight,
            });
          }
          return a;
        }),
    }),
  );
  await mutate("viewport_set", { view: "iso" });
  await mutate("viewport_set", { view: "fit" });
  await page
    .getByRole("button", { name: "Cancel alignment", exact: true })
    .click();
  assert.deepEqual(await geometry(ids), original);
  assert.deepEqual((await call("history_get")).result, history);
  await mutate("command_run", { name: "ribbon:align" });
  await page.getByLabel("Coordinate setup method").selectOption("automatic");
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Alignment preview ready" })
    .waitFor();
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .click();
  await page.getByLabel("Coordinate setup method").waitFor({ state: "hidden" });
  const guiAligned = await geometry(ids);
  assert.notDeepEqual(guiAligned, original);
  await mutate("history_undo");
  assert.deepEqual(await geometry(ids), original);
  const options = {
    referenceEntityId: "scan",
    origin: "center",
    primaryAxis: "X",
  };
  const preview = await job(
    await mutate("alignment_preview", { entityIds: ids, automatic: options }),
  );
  const applied = await job(
    await mutate("alignment_apply", { entityIds: ids, automatic: options }),
  );
  assert.deepEqual(applied.matrix, preview.matrix);
  assert(applied.automatic.planeRms < 0.0001);
  const b = applied.targets[0].bounds;
  assert(Math.abs(b.min[2]) < 0.0001);
  assert(Math.abs(b.min[0] + 10) < 0.0001);
  assert(Math.abs(b.min[1] + 5) < 0.0001);
  const aligned = await geometry(ids);
  assert.notDeepEqual(aligned, original);
  assert.deepEqual(aligned, guiAligned, "GUI and MCP automatic setup differ");
  assert.equal((await call("history_get")).result.cursor, history.cursor + 1);
  await mutate("history_undo");
  assert.deepEqual(await geometry(ids), original);
  await mutate("history_redo");
  assert.deepEqual(await geometry(ids), aligned);
  const savedHistory = (await call("history_get")).result;
  const saved = await job(await call("project_export", { format: "project" }));
  assert(saved.bytes > 0);
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    await geometry(ids),
    aligned,
    "CAD result changed after project save/reopen",
  );
  assert.deepEqual(
    (await call("history_get")).result,
    savedHistory,
    "CAD history changed after reopen",
  );
  await mutate("history_undo");
  assert.deepEqual(await geometry(ids), original);
  await mutate("history_redo");
  assert.deepEqual(await geometry(ids), aligned);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    preview,
    applied,
    errors,
    checks: [
      "GUI automatic preview/cancel and apply matching MCP geometry",
      "MCP same deterministic frame",
      "base at Z=0 and centered XY",
      "one history step",
      "exact Undo/Redo hashes",
      "binary project save/reopen with exact geometry and history",
    ],
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
