import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
    let output = "";
    developmentServer.stdout.on("data", (chunk) => {
      output += chunk;
    });
    developmentServer.stderr.on("data", (chunk) => {
      output += chunk;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (developmentServer.exitCode !== null)
        throw Error("Development server exited");
      if (output.includes("ready in")) {
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

  const mesh = {
    id: "moving",
    name: "Moving scan",
    kind: "mesh",
    positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    visible: true,
    color: "#aaaaaa",
    opacity: 1,
  };
  const upload = (
    await call("artifact_put", {
      name: "menu-audit.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Command menu audit",
          units: "mm",
          entities: [mesh, { ...mesh, id: "fixed", name: "Fixed scan" }],
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
  await mutate("object_select", { entityId: "moving" });
  const scope = await readFile(
    new URL("../src/ui/tool-panel-scope.tsx", import.meta.url),
    "utf8",
  );
  const commands = [...scope.matchAll(/^  (\w+): \[/gm)].map((m) => m[1]);
  const results = [];
  async function check(name, label = "Tool options") {
    const menu = page.getByRole("complementary", { name: label, exact: true });
    await menu.waitFor({ state: "visible" });
    const metrics = await menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const title = el.querySelector(
        ":scope > h2, :scope > .tool-panel > header, :scope > .tool-panel > h3",
      );
      const close = title?.querySelector("button");
      const cb = close?.getBoundingClientRect();
      const tb = title?.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        closeGap: cb && tb ? tb.right - cb.right : null,
        panels: [...el.querySelectorAll(".panel")]
          .filter((p) => p.getBoundingClientRect().height > 0)
          .map((p) => ({
            class: p.className,
            border: getComputedStyle(p).borderBottomWidth,
          })),
        buttons: [...el.querySelectorAll("button")]
          .filter((b) => b.getBoundingClientRect().height > 0)
          .map((b) => ({
            name: b.getAttribute("aria-label") ?? b.textContent.trim(),
            height: b.getBoundingClientRect().height,
          })),
        clipped: [
          ...el.querySelectorAll(
            'input[type="number"],textarea,.app-select > button',
          ),
        ]
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return (
              r.width > 0 && (r.left < box.left || r.right > box.right + 1)
            );
          })
          .map((c) => c.getAttribute("aria-label") ?? c.tagName),
      };
    });
    assert(metrics.width <= 280, name + JSON.stringify(metrics));
    assert(metrics.height <= 560, name + JSON.stringify(metrics));
    assert(
      metrics.closeGap !== null && metrics.closeGap <= 1,
      name + " close " + JSON.stringify(metrics),
    );
    assert(
      metrics.panels.every((p) => p.border === "0px"),
      name + " panel border " + JSON.stringify(metrics),
    );
    assert.deepEqual(metrics.clipped, [], name);
    assert(
      metrics.buttons.every((button) => button.height <= 30),
      name +
        " oversized buttons " +
        JSON.stringify(metrics.buttons.filter((button) => button.height > 30)),
    );
    results.push({ name, ...metrics });
  }
  for (const workspace of [
    ...commands,
    "transform",
    "section",
    "measure",
    "deviation",
    "fit",
    "surface",
    "sketch",
    "properties",
  ]) {
    await mutate("ui_set", { workspace, toolPanelOpen: true });
    await check(workspace);
    assert.equal(
      (await call("application_inspect")).result.workspace,
      workspace,
    );
  }
  for (const command of [
    "editScan",
    "splitMesh",
    "reduceNoise",
    "reducePolygons",
    "scaleMesh",
    "shrinkwrap",
    "repolygonize",
    "averageMesh",
    "mirrorMesh",
    "unroll",
  ]) {
    await mutate("command_run", { name: "ribbon:" + command });
    await check(command);
  }
  await mutate("command_run", { name: "ribbon:alignInteractive" });
  await check("interactive", "Interactive alignment");
  await page
    .getByRole("button", { name: "Close Interactive alignment", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "Interactive alignment", exact: true })
    .waitFor({ state: "hidden" });
  await mutate("command_run", { name: "ribbon:alignNPoints" });
  await check("npoints", "N-points alignment");
  await page
    .getByRole("button", { name: "Close Align by N points", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "N-points alignment", exact: true })
    .waitFor({ state: "hidden" });
  for (const [command, label, close] of [
    ["globalFineAlign", "Global fine align", "Close Global fine align"],
    ["sketchFromSection", "Create Sketch", "Close Create Sketch"],
    ["fitSurface", "Fit Surface", "Close Fit Surface"],
  ]) {
    if (command === "fitSurface")
      await mutate("selection_set", { entityId: "moving", triangles: [0] });
    await mutate("command_run", { name: "ribbon:" + command });
    await check(command, label);
    await page.getByRole("button", { name: close, exact: true }).click();
    await page
      .getByRole("complementary", { name: label, exact: true })
      .waitFor({ state: "hidden" });
  }
  for (const [name, edit, title] of [
    ["components", "Edit individual meshes", "Individual meshes"],
    ["holes", "Edit holes", "Fill holes"],
    ["boundaries", "Edit boundaries", "Edit boundaries"],
  ]) {
    await mutate("command_run", { name: "ribbon:editScan" });
    await page.getByRole("button", { name: edit, exact: true }).click();
    await check(name);
    await page
      .getByRole("button", { name: `Close ${title}`, exact: true })
      .click();
    await page
      .getByRole("group", { name: "Mesh editing", exact: true })
      .waitFor({ state: "visible" });
  }
  const cloud = {
    ...mesh,
    id: "cloud",
    name: "Scan points",
    kind: "pointcloud",
  };
  const cloudUpload = (
    await call("artifact_put", {
      name: "cloud-menu-audit.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Cloud menus",
          units: "mm",
          entities: [
            cloud,
            { ...cloud, id: "fixed-cloud", name: "Fixed points" },
          ],
        }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: cloudUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "cloud" });
  for (const command of [
    "reduceNoise",
    "reducePolygons",
    "editScan",
    "fineAlign",
  ]) {
    await mutate("command_run", { name: "ribbon:" + command });
    await check("cloud-" + command);
  }
  await page.setViewportSize({ width: 700, height: 900 });
  for (const workspace of ["fineAlign", "pointNoise", "pointReduce"]) {
    await mutate("ui_set", { workspace, toolPanelOpen: true });
    await check("narrow-" + workspace);
    const bounds = await page
      .getByRole("complementary", { name: "Tool options", exact: true })
      .boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= 700 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 900,
    );
  }
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    origin,
    results,
    errors,
    scope:
      "Rendered command menus via public MCP navigation; no geometry operations executed.",
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
