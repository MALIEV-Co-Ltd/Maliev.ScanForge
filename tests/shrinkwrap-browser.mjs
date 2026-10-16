import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
// Optional extracted single-hole component: positions, rim, center and radius.

const half = false;
const fine = half || process.env.SCANFORGE_FINE_RECONSTRUCTION === "1";
const resolution = half ? 0.5 : fine ? 1 : 0.5;
const root = new URL("../", import.meta.url),
  out = new URL(
    half
      ? "../.resources/half-browser/"
      : fine
        ? "../.resources/fine-browser/"
        : "../.resources/shrinkwrap-browser/",
    import.meta.url,
  );
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "shrinkwrap-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed, page;
const errors = [];
function identity(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${pid} | Select-Object Id,Path,@{Name='actualStartedAt';Expression={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(result.status, 0, "Could not record owned process identity");
  return JSON.parse(result.stdout);
}
Object.assign(ledger, identity(process.pid));
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
  client = new Client({ name: "watertight-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...identity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=512",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("shrinkwrap-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
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

  const artifactJson = async (artifact) => {
    const chunks = [];
    let offset = 0;
    do {
      const wire = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const bytes = Buffer.from(wire.base64, "base64");
      assert(bytes.length > 0);
      chunks.push(bytes);
      offset += bytes.length;
    } while (offset < artifact.bytes);
    return JSON.parse(Buffer.concat(chunks).toString());
  };

  const { BoxGeometry } = await import("three");
  function cube(id, offset = 0, hidden = []) {
    const indexed = new BoxGeometry(2, 2, 2),
      mesh = indexed.toNonIndexed();
    const positions = Array.from(
      mesh.getAttribute("position").array,
      (v) => v + offset,
    );
    indexed.dispose();
    mesh.dispose();
    return {
      id,
      name: id,
      kind: "mesh",
      positions,
      visible: true,
      color: "#aaaaaa",
      opacity: 1,
      meshSelection: { hidden, saved: [] },
    };
  }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "ShrinkWrap parity",
    units: "mm",
    entities: [
      cube("panel"),
      cube("reference", 5),
      cube("isolated", 10, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ],
  };
  const bytes = Buffer.from(JSON.stringify(project));
  const upload = (
    await call("artifact_put", {
      name: "shrinkwrap.json",
      offset: 0,
      base64: bytes.toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "panel" });
  const geometry = async (id) =>
    artifactJson(
      (await call("object_get", { entityId: id, includeGeometry: true })).result
        .geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  const before = await geometry("panel"),
    reference = await geometry("reference"),
    cursor = await history();
  const options = {
    kind: "shrinkwrap",
    sampleInterval: 0.25,
    gapFill: 1,
    organicShape: true,
    extraThickness: 0.1,
    maxDeviation: 0.3,
    scope: "whole",
  };
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "ShrinkWrap", exact: true }).click();
  const controls = page.locator(".scan-tools-panel");
  await controls
    .getByRole("spinbutton", { name: "Sample interval (mm)", exact: true })
    .fill("0.25");
  await controls
    .getByRole("spinbutton", { name: "Gap fill (mm)", exact: true })
    .fill("1");
  await controls
    .getByRole("checkbox", { name: "Organic shape", exact: true })
    .check();
  await controls
    .getByRole("spinbutton", { name: "Add extra thickness (mm)", exact: true })
    .fill("0.1");
  await controls
    .getByRole("spinbutton", {
      name: "Maximum surface deviation (mm)",
      exact: true,
    })
    .fill("0.00000001");
  await controls
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  const precisionRefusal =
    "Requested ShrinkWrap precision is below Float32 coordinate precision; move the mesh nearer the origin.";
  const refusal = page.getByRole("alert").filter({
    hasText: precisionRefusal,
  });
  await refusal.waitFor({ timeout: 10000 });
  console.log("GUI precision refusal observed");
  assert((await refusal.innerText()).includes(precisionRefusal));
  assert.equal(
    await controls.getByRole("button", { name: "Accept", exact: true }).count(),
    0,
    "Rejected preview offered acceptance",
  );
  assert.deepEqual(
    (await geometry("panel")).positions,
    before.positions,
    "Rejected GUI preview changed source",
  );
  assert.equal(await history(), cursor, "Rejected GUI preview changed history");
  const rejectedMcp = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: "panel",
      operation: { ...options, maxDeviation: 1e-8 },
    }),
    "failed",
  );
  assert.equal(rejectedMcp.error.message, precisionRefusal);
  assert.deepEqual(
    (await geometry("panel")).positions,
    before.positions,
    "Rejected MCP preview changed source",
  );
  assert.equal(await history(), cursor, "Rejected MCP preview changed history");
  await controls
    .getByRole("spinbutton", {
      name: "Maximum surface deviation (mm)",
      exact: true,
    })
    .fill("0.3");
  await controls
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await controls
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 60000 });
  assert.deepEqual(
    (await geometry("panel")).positions,
    before.positions,
    "GUI preview changed source",
  );
  assert.equal(await history(), cursor);
  await controls
    .getByRole("button", { name: "Compare to source", exact: true })
    .click();
  await page.screenshot({
    path: fileURLToPath(new URL("gui-preview.png", out)),
  });
  await controls.getByRole("button", { name: "Accept", exact: true }).click();
  const gui = await geometry("panel");
  console.log("GUI whole preview accepted");
  assert.notDeepEqual(gui.positions, before.positions);
  assert.equal(await history(), cursor + 1);
  await mutate("history_undo", {});
  assert.deepEqual((await geometry("panel")).positions, before.positions);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry("panel")).positions, gui.positions);
  await mutate("history_undo", {});
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      operation: { kind: "scanTools", operation: options },
    }),
  );
  assert.deepEqual(
    (await geometry("panel")).positions,
    gui.positions,
    "GUI/MCP whole mismatch",
  );
  assert.equal(mcp.result.diagnostics.watertight, true);
  await mutate("history_undo", {});
  const previewJob = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: "panel",
      operation: options,
    }),
  );
  const previewId = previewJob.result.previewId;
  console.log("GUI/MCP whole equality verified");
  assert(previewId, JSON.stringify(previewJob));
  assert.deepEqual(
    (await geometry("panel")).positions,
    before.positions,
    "MCP preview changed source",
  );
  await job(
    await mutate("scan_preview", {
      action: "compare",
      entityId: "panel",
      previewId,
      deviation: 0.3,
    }),
  );
  await job(
    await mutate("scan_preview", {
      action: "cancel",
      entityId: "panel",
      previewId,
    }),
  );
  assert.deepEqual((await geometry("panel")).positions, before.positions);
  const preview2 = await job(
    await mutate("scan_preview", {
      action: "create",
      entityId: "panel",
      operation: options,
    }),
  );
  const createNew = await job(
    await mutate("scan_preview", {
      action: "accept",
      entityId: "panel",
      previewId: preview2.result.previewId,
      createNew: true,
    }),
  );
  assert.deepEqual(
    (await geometry("panel")).positions,
    before.positions,
    "Create-new changed source",
  );
  await mutate("history_undo", {});
  await mutate("selection_set", { entityId: "panel", triangles: [0, 1] });
  const localOptions = {
    ...options,
    gapFill: 0,
    organicShape: false,
    extraThickness: 0,
    scope: "selected",
  };
  await page.getByRole("button", { name: "ShrinkWrap", exact: true }).click();
  const localControls = page.locator(".scan-tools-panel");
  await localControls
    .getByRole("spinbutton", { name: "Gap fill (mm)", exact: true })
    .fill("0");
  await localControls
    .getByRole("checkbox", { name: "Organic shape", exact: true })
    .uncheck();
  await localControls
    .getByRole("spinbutton", { name: "Add extra thickness (mm)", exact: true })
    .fill("0");
  await localControls
    .getByRole("button", { name: "Scope", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Selected triangles", exact: true })
    .click();
  await localControls
    .getByRole("button", { name: "Preview", exact: true })
    .last()
    .click();
  await localControls
    .getByRole("button", { name: "Accept", exact: true })
    .waitFor({ timeout: 60000 });
  assert.deepEqual((await geometry("panel")).positions, before.positions);
  await localControls
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  const guiLocal = await geometry("panel");
  console.log("GUI local preview accepted");
  assert.deepEqual(
    guiLocal.positions.slice(0, 10 * 9),
    before.positions.slice(2 * 9),
    "Unselected triangles changed",
  );
  await mutate("history_undo", {});
  await mutate("selection_set", { entityId: "panel", triangles: [0, 1] });
  const localJob = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      operation: { kind: "scanTools", operation: localOptions },
    }),
  );
  assert.deepEqual(
    (await geometry("panel")).positions,
    guiLocal.positions,
    "GUI/MCP local mismatch",
  );
  const isolatedBefore = await geometry("isolated");
  const isolatedJob = await job(
    await mutate("mesh_process", {
      entityId: "isolated",
      operation: {
        kind: "scanTools",
        operation: { ...localOptions, scope: "isolated" },
      },
    }),
  );
  assert.deepEqual(
    (await geometry("isolated")).positions.slice(0, 10 * 9),
    isolatedBefore.positions.slice(2 * 9),
    "Hidden triangles changed",
  );
  assert.deepEqual(
    (await geometry("reference")).positions,
    reference.positions,
  );
  const finalSession = (await call("session_get")).result;
  assert.equal(
    finalSession.jobs.filter(
      (entry) =>
        entry.status === "failed" &&
        entry.command === "scan_preview" &&
        entry.error?.message === precisionRefusal,
    ).length,
    2,
    "Expected exactly the GUI and MCP precision refusals",
  );
  const unexpectedJobs = finalSession.jobs.filter(
    (entry) =>
      entry.status === "cancelled" ||
      (entry.status === "failed" &&
        (entry.command !== "scan_preview" ||
          entry.error?.message !== precisionRefusal)),
  );
  assert.deepEqual(
    unexpectedJobs,
    [],
    "Unexpected failed or cancelled GUI/MCP jobs",
  );
  assert.deepEqual(errors, []);
  ledger.result = {
    guiMcpPrecisionRefusalPreservesSourceAndHistory: true,
    guiMcpWholeEqual: true,
    guiMcpLocalEqual: true,
    guiPreviewPreservesSource: true,
    mcpPreviewLifecycle: true,
    createNewPreservesSource: true,
    unselectedAndHiddenPreserved: true,
    undoRedo: true,
    diagnostics: mcp.result.diagnostics,
    localDiagnostics: localJob.result.diagnostics,
    isolatedDiagnostics: isolatedJob.result.diagnostics,
    createNew: createNew.result,
    pageErrors: errors,
  };
  await page.screenshot({ path: fileURLToPath(new URL("result.png", out)) });
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  failed = error;
  // Preserve the actual application error and API job state before cleanup closes the surfaces.
  ledger.failureArtifacts = [];
  if (page && !page.isClosed()) {
    const body = await page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch((capture) => `Body capture failed: ${capture.message}`);
    await writeFile(new URL("failure-body.txt", out), body);
    ledger.failureArtifacts.push("failure-body.txt");
    await page
      .screenshot({
        path: fileURLToPath(new URL("failure.png", out)),
        timeout: 5000,
      })
      .then(() => ledger.failureArtifacts.push("failure.png"))
      .catch(() => {});
  }
  if (client) {
    let captureTimeout;
    try {
      const response = await Promise.race([
        client.callTool({ name: "session_get", arguments: {} }),
        new Promise(
          (_, reject) =>
            (captureTimeout = setTimeout(
              () => reject(Error("Failure-session capture timed out")),
              3000,
            )),
        ),
      ]);
      const wire =
        response.structuredContent ?? JSON.parse(response.content[0].text);
      await writeFile(
        new URL("failure-session.json", out),
        JSON.stringify(wire, null, 2),
      );
      ledger.failureArtifacts.push("failure-session.json");
    } catch (capture) {
      ledger.failureSessionError = capture.message;
    } finally {
      clearTimeout(captureTimeout);
    }
  }
  ledger.pageErrors = errors;
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
    new URL("shrinkwrap-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
