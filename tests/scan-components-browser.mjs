import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/component-cleanup/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = 1536;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Component replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "component-cleanup-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
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
let server, reserve, browserServer, browser, client, transport, failed, page;
const fixturePath = fileURLToPath(new URL("component-cleanup-panel.stl", out));
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
  client = new Client({ name: "component-cleanup-validation", version: "1" });
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
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=768",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("component-cleanup-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (window.__holdComponentResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingComponentResult = true;
            }
          });
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
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Workspace did not settle before component validation");
  };
  const mutate = async (name, args) => {
    await idle();
    return call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  };
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 1800; i++) {
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

  const artifactJson = async (artifact) => {
    const chunks = [];
    for (let offset = 0; offset < artifact.bytes;) {
      const read = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const chunk = Buffer.from(read.base64, "base64");
      assert(chunk.length > 0);
      chunks.push(chunk);
      offset += chunk.length;
    }
    await call("artifact_delete", { artifactId: artifact.artifactId });
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const geometry = async (entityId = "scan") => {
    await idle();
    return (
      await artifactJson(
        (await call("object_get", { entityId, includeGeometry: true })).result
          .geometry,
      )
    ).positions;
  };
  const digest = (positions) =>
    createHash("sha256")
      .update(Buffer.from(new Float32Array(positions).buffer))
      .digest("hex");
  const rawEqual = (actual, expected, message) =>
    assert.equal(digest(actual), digest(expected), message);
  const positions = [],
    groups = [];
  for (let n = 1; n <= 3; n++) {
    const part = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = [n * 10 + x, y, 0],
          b = [n * 10 + x + 1, y, 0],
          c = [n * 10 + x + 1, y + 1, 0],
          d = [n * 10 + x, y + 1, 0];
        part.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    groups.push(part);
    positions.push(...part);
  }
  // Retained corners may be near-coincident without being identical.
  groups[2][2] = 2e-7;
  positions.splice(
    groups[0].length + groups[1].length,
    groups[2].length,
    ...groups[2],
  );
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Component lifecycle control",
    units: "mm",
    entities: [
      {
        id: "scan",
        name: "Three components",
        source: "manufactured-components-control.stl",
        kind: "mesh",
        positions,
        visible: true,
        color: "#b4bec4",
        opacity: 1,
      },
    ],
  };
  const upload = (
    await call("artifact_put", {
      name: "component-control.json",
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
  await call("artifact_delete", { artifactId: upload.artifactId });
  await mutate("object_select", { entityId: "scan" });
  await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
  await mutate("viewport_control", {
    action: "camera",
    position: [20, 2, 45],
    target: [20, 2, 0],
    up: [0, 1, 0],
    zoom: 1,
  });
  const baseline = (await call("project_get")).result.undo;
  rawEqual(
    await geometry(),
    positions,
    "Import changed original corner records",
  );
  const runEdit = async (operation, expected = "succeeded") =>
    job(
      await mutate("mesh_process", {
        entityId: "scan",
        operation: { kind: "scanEdit", ...operation },
      }),
      expected,
    );
  const inspect = async () =>
    artifactJson((await runEdit({ action: "inventory" })).result.artifact);
  const report = await inspect();
  assert.deepEqual(
    report.inventory.components
      .map((c) => c.triangles.length)
      .sort((a, b) => a - b),
    [2, 8, 18],
  );
  const middle = report.inventory.components.findIndex(
    (c) => c.triangles.length === 8,
  );
  const small = report.inventory.components.findIndex(
    (c) => c.triangles.length === 2,
  );
  assert.equal(report.inventory.components[middle].area, 4);
  assert.equal(
    (await call("project_get")).result.undo,
    baseline,
    "Inventory added history",
  );
  const controls = page.getByRole("region", {
    name: "Individual meshes",
    exact: true,
  });
  const open = async () => {
    await mutate("command_run", { name: "ribbon:editScan" });
    if (!(await controls.isVisible()))
      await page
        .getByRole("button", { name: "Edit individual meshes", exact: true })
        .click();
    await controls.getByRole("button", { name: /· 8 triangles ·/ }).waitFor();
    assert.match(await controls.innerText(), /3 meshes/);
  };
  const reset = async () => {
    await mutate("history_seek", { index: baseline });
    await mutate("object_select", { entityId: "scan" });
    rawEqual(await geometry(), positions, "History reset changed source");
    const restored = (await call("project_get")).result;
    assert.equal(restored.objects.length, 1);
    assert.equal(
      restored.objects.find((o) => o.id === "scan").visible,
      true,
      "History did not restore extracted source visibility",
    );
  };
  const waitHistory = async (index) => {
    for (let i = 0; i < 120; i++) {
      if ((await call("project_get")).result.undo === index) {
        await idle();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("GUI component operation did not commit");
  };
  const cases = [
    {
      name: "keep",
      button: "Leave selected only",
      action: "componentKeep",
      indices: [middle],
      expected: groups[1],
    },
    {
      name: "flip",
      button: "Flip normals",
      action: "componentFlip",
      indices: [middle],
      expected: positions.map((v, i) => {
        const start = groups[0].length,
          end = start + groups[1].length;
        if (i < start || i >= end) return v;
        const corner = i % 9;
        return positions[
          i + (corner >= 3 && corner < 6 ? 3 : corner >= 6 ? -3 : 0)
        ];
      }),
    },
    {
      name: "extract",
      button: "Create new object",
      action: "componentExtract",
      indices: [middle],
      expected: groups[1],
      extract: true,
    },
    {
      name: "triangle-threshold-inclusive",
      button: "Remove small meshes",
      action: "componentRemove",
      indices: [small],
      threshold: 2,
      expected: [...groups[1], ...groups[2]],
    },
    {
      name: "area-threshold-exclusive",
      button: "Remove small meshes",
      action: "componentRemove",
      indices: [small],
      threshold: 4,
      area: true,
      expected: [...groups[1], ...groups[2]],
    },
  ];
  await reset();
  await open();
  const items = controls
    .getByRole("group", { name: "Individual meshes items", exact: true })
    .getByRole("button");
  assert.equal(await items.count(), 3);
  for (let i = 0; i < 3; i++) {
    assert.match(
      await items.nth(i).innerText(),
      new RegExp(`· ${[2, 8, 18][i]} triangles · ${[1, 4, 9][i]}.00 mm²`),
    );
  }
  await controls
    .getByRole("button", { name: "Next item", exact: true })
    .click();
  assert.equal(await items.nth(1).getAttribute("aria-pressed"), "true");
  await controls
    .getByRole("button", { name: "Previous item", exact: true })
    .click();
  assert.equal(await items.nth(0).getAttribute("aria-pressed"), "true");
  assert.equal(
    (await call("project_get")).result.undo,
    baseline,
    "Component navigation added history",
  );
  const results = [];
  for (const c of cases) {
    await reset();
    await open();
    await controls.getByRole("button", { name: /· 8 triangles ·/ }).click();
    if (c.threshold !== undefined) {
      if (c.area) {
        await controls.locator(".app-select > button").click();
        await page
          .getByRole("option", { name: "Area smaller than (mm²)", exact: true })
          .click();
      }
      await controls
        .getByRole("spinbutton", { name: "Threshold", exact: true })
        .fill(String(c.threshold));
    }
    await page.screenshot({
      path: fileURLToPath(new URL(`${c.name}-before.png`, out)),
    });
    await controls.getByRole("button", { name: c.button, exact: true }).click();
    await waitHistory(baseline + 1);
    const guiProject = (await call("project_get")).result;
    let guiGeometry;
    if (c.extract) {
      assert.equal(guiProject.objects.length, 2);
      const created = guiProject.objects.find((o) => o.id !== "scan");
      assert.equal(
        guiProject.objects.find((o) => o.id === "scan").visible,
        false,
      );
      assert.equal(created.visible, true);
      assert.equal(created.source, "manufactured-components-control.stl");
      assert.equal(
        (await call("application_inspect")).result.selectedId,
        created.id,
        "GUI did not select extracted owner",
      );
      rawEqual(await geometry(), positions, "GUI extraction altered source");
      guiGeometry = await geometry(
        guiProject.objects.find((o) => o.id !== "scan").id,
      );
    } else guiGeometry = await geometry();
    rawEqual(
      guiGeometry,
      c.expected,
      `GUI ${c.name} differs from raw-corner oracle`,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`${c.name}-after.png`, out)),
    });
    await reset();
    await runEdit({ action: c.action, indices: c.indices });
    const mcpProject = (await call("project_get")).result;
    let mcpGeometry;
    if (c.extract) {
      assert.equal(mcpProject.objects.length, 2);
      const created = mcpProject.objects.find((o) => o.id !== "scan");
      assert.equal(
        mcpProject.objects.find((o) => o.id === "scan").visible,
        false,
      );
      assert.equal(created.visible, true);
      assert.equal(created.source, "manufactured-components-control.stl");
      assert.equal(
        (await call("application_inspect")).result.selectedId,
        created.id,
        "MCP did not select extracted owner",
      );
      assert.equal(
        created.name,
        guiProject.objects.find((o) => o.id !== "scan").name,
        "GUI/MCP extracted names differ",
      );
      rawEqual(await geometry(), positions, "MCP extraction altered source");
      mcpGeometry = await geometry(
        mcpProject.objects.find((o) => o.id !== "scan").id,
      );
    } else mcpGeometry = await geometry();
    rawEqual(mcpGeometry, c.expected, `MCP ${c.name} differs from oracle`);
    rawEqual(mcpGeometry, guiGeometry, `GUI/MCP ${c.name} mismatch`);
    await mutate("history_undo", {});
    rawEqual(await geometry(), positions, "Undo changed source");
    assert.equal(
      (await call("project_get")).result.objects.find((o) => o.id === "scan")
        .visible,
      true,
      "Undo did not restore original visibility",
    );
    await mutate("history_redo", {});
    if (c.extract)
      rawEqual(
        await geometry(
          (await call("project_get")).result.objects.find(
            (o) => o.id !== "scan",
          ).id,
        ),
        c.expected,
        "Redo lost extracted owner",
      );
    else rawEqual(await geometry(), c.expected, "Redo changed output");
    const saved = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: saved.result.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: saved.result.artifactId });
    const reopened = (await call("project_get")).result;
    if (c.extract) {
      assert.equal(reopened.objects.length, 2);
      rawEqual(await geometry(), positions, "Reopen altered extraction source");
      rawEqual(
        await geometry(reopened.objects.find((o) => o.id !== "scan").id),
        c.expected,
        "Reopen changed extraction",
      );
    } else
      rawEqual(await geometry(), c.expected, "Reopen changed component output");
    results.push({
      name: c.name,
      triangles: c.expected.length / 9,
      geometrySha256: digest(c.expected),
      guiMcpParity: true,
      rawCornerOracle: true,
      undoRedo: true,
      binarySaveReopen: true,
      sourceVisibilityAndSelection: c.extract ? true : null,
    });
    // Binary import starts a new history; reimport the immutable original for the next case.
    const source = (
      await call("artifact_put", {
        name: "component-control.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(project)).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: source.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: source.artifactId });
    assert.equal((await call("project_get")).result.undo, baseline);
  }
  await reset();
  await page.evaluate(() => {
    window.__holdComponentResult = true;
    window.__pendingComponentResult = false;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: "scan",
    operation: {
      kind: "scanEdit",
      action: "componentRemove",
      indices: [small],
    },
  });
  await page.waitForFunction(() => window.__pendingComponentResult);
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdComponentResult = false;
  });
  rawEqual(await geometry(), positions, "Cancelled result changed original");
  assert.equal((await call("project_get")).result.undo, baseline);
  await open();
  await page.evaluate(() => {
    window.__holdComponentResult = true;
    window.__pendingComponentResult = false;
  });
  await controls
    .getByRole("button", { name: "Leave selected only", exact: true })
    .click();
  await page.waitForFunction(() => window.__pendingComponentResult);
  await controls
    .getByRole("button", { name: "Cancel and back", exact: true })
    .click();
  await page.evaluate(() => {
    window.__holdComponentResult = false;
  });
  rawEqual(await geometry(), positions, "Cancelled GUI result changed source");
  assert.equal((await call("project_get")).result.undo, baseline);
  assert.deepEqual(errors, []);
  ledger.result = {
    inputCoordinateSha256: digest(positions),
    componentTriangles: [2, 8, 18],
    componentAreas: report.inventory.components.map((c) => c.area),
    inventoryHistoryIsolation: true,
    renderedCountsAreasAndNavigation: true,
    cases: results,
    mcpHeldResultCancellation: true,
    guiCancelAndBack: true,
    pageErrors: errors,
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
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
  await unlink(fixturePath).catch((error) => {
    if (error.code !== "ENOENT") failed ??= error;
  });
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("component-cleanup-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
