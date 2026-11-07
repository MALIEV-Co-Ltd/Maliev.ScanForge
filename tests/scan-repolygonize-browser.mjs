import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL("../.resources/scan-repolygonize-browser/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "scan-repolygonize-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
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
}, 600000);
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
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
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
  client = new Client({ name: "repolygonize-validation", version: "1" });
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
    new URL("scan-repolygonize-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__repolygonRequests = [];
    window.__repolygonStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__repolygonStages.push(e.data.stage);
            if (window.__holdResult && (e.data.result || e.data.stage)) {
              if (e.data.result) {
                e.stopImmediatePropagation();
                window.__pendingResult = () =>
                  this.dispatchEvent(
                    new MessageEvent("message", { data: e.data }),
                  );
              } else if (window.__sawProgress) e.stopImmediatePropagation();
              else window.__sawProgress = true;
            }
          });
      }
      postMessage(data, ...args) {
        if (this.processing) window.__repolygonRequests.push(data.kind);
        return super.postMessage(data, ...args);
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
  const mutate = async (name, args) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 2400; i++) {
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

  const geometry = async (entityId = "base") =>
    artifactJson(
      (await call("object_get", { entityId, includeGeometry: true })).result
        .geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  const mesh = (id, name, positions) => ({
    id,
    name,
    kind: "mesh",
    positions,
    visible: true,
    color: "#b4bec4",
    opacity: 1,
  });

  const fixture = JSON.parse(
    await readFile(
      new URL("tests/fixtures/repolygonize-observed-tilted-box.json", root),
      "utf8",
    ),
  );
  const vertices = fixture.vertices.flat(),
    triangles = fixture.faces.flat();
  const source = mesh(
    "source",
    "Tilted box",
    triangles.flatMap((i) => vertices.slice(i * 3, i * 3 + 3)),
  );
  source.indexedMesh = { vertices, triangles };
  const upload = (
    await call("artifact_put", {
      name: "repolygon.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Native reconstruction",
          units: "mm",
          entities: [source],
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
  await mutate("object_select", { entityId: source.id });
  const beforeHistory = await history();
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page
    .getByRole("button", { name: "Re-polygonize", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Re-polygonize",
    exact: true,
  });
  await panel.waitFor();
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction(() => window.__repolygonRequests.length > 0);
  let project;
  for (let i = 0; i < 150; i++) {
    project = (await call("project_get")).result;
    if (project.objects.length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(project.objects.length, 2);
  const guiId = project.objects.find((o) => o.id !== source.id).id;
  const guiGeometry = await geometry(guiId);
  assert.deepEqual(guiGeometry.positions, fixture.nativeOutput);
  assert(guiGeometry.indexedMesh);
  assert.equal(project.objects.find((o) => o.id === source.id).visible, false);
  assert.deepEqual((await geometry(source.id)).positions, source.positions);
  assert.equal(await history(), beforeHistory + 1);
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  assert.equal((await call("project_get")).result.objects[0].visible, true);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry(guiId)).positions, fixture.nativeOutput);
  await mutate("history_undo", {});
  const request = {
    entityId: source.id,
    operation: {
      kind: "scanTools",
      operation: { kind: "repolygonize", resolution: 0.5 },
    },
  };
  const revision = (await call("project_get")).revision,
    requestId = randomUUID();
  const receipt = await call("mesh_process", {
    ...request,
    expectedRevision: revision,
    requestId,
  });
  const result = await job(receipt);
  assert.deepEqual(result.result.reconstruction, {
    inputEntityIds: [source.id],
    method: "native",
  });
  assert.deepEqual(
    (await geometry(result.result.entityIds[0])).positions,
    fixture.nativeOutput,
  );
  assert.deepEqual(
    await call("mesh_process", {
      ...request,
      expectedRevision: revision,
      requestId,
    }),
    receipt,
  );
  await mutate("history_undo", {});
  await page.evaluate(() => {
    window.__holdResult = true;
    window.__pendingResult = null;
  });
  const cancelled = await mutate("mesh_process", request);
  await page.waitForFunction(() => !!window.__pendingResult);
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdResult = false;
    window.__pendingResult = null;
  });
  assert.equal(await history(), beforeHistory);
  assert.equal((await call("project_get")).result.objects.length, 1);
  const failure = await job(
    await mutate("mesh_process", {
      ...request,
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution: 1e-30 },
      },
    }),
    "failed",
  );
  assert.match(
    JSON.stringify(failure.error),
    /spacing|resolution|Float32|coordinate/i,
  );
  assert.equal(await history(), beforeHistory);
  const final = await job(await mutate("mesh_process", request));
  const finalId = final.result.entityIds[0];
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.result.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual((await geometry(finalId)).positions, fixture.nativeOutput);
  assert.deepEqual(
    (await geometry(finalId)).indexedMesh,
    guiGeometry.indexedMesh,
  );
  assert.deepEqual((await geometry(source.id)).positions, source.positions);
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === source.id)
      .visible,
    false,
  );
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects[0].visible, true);
  await mutate("history_redo", {});
  assert.equal(
    (await call("project_get")).result.objects.find((o) => o.id === source.id)
      .visible,
    false,
  );
  await mutate("object_select", { entityId: finalId });
  await mutate("viewport_control", { action: "fit", entityId: finalId });
  await page.screenshot({
    path: fileURLToPath(new URL("repolygonize.png", out)),
  });
  assert.deepEqual(errors, []);
  ledger.result = {
    guiMcpNativeOrderedCoordinatesEqual: true,
    facetCount: fixture.nativeOutput.length / 9,
    newOwner: true,
    hiddenUnchangedInputs: true,
    undoRedo: true,
    retryProtected: true,
    cancellationRollback: true,
    failureRollback: true,
    indexedSaveReopen: true,
    pageErrors: errors,
  };

  if (process.env.SCANFORGE_RECONSTRUCTION_INPUT_DIR) {
    const dir = process.env.SCANFORGE_RECONSTRUCTION_INPUT_DIR;
    await mutate("project_new", { discard: true });
    await page
      .locator('input[type=file][accept*=".stl"]')
      .setInputFiles([1, 2, 3].map((i) => `${dir}/scan-${i}.posed.ply`));
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .locator('.status-message[title^="Opened"]')
      .waitFor({ timeout: 180000 });
    const original = (await call("project_get")).result.objects;
    assert.equal(original.length, 3);
    assert.equal(
      original.reduce((n, o) => n + o.triangles, 0),
      6147452,
    );
    const digest = async (entityId) =>
      (
        await job(await call("object_geometry_digest", { entityId }))
      ).result.buffers.map(({ path, encoding, elements, sha256 }) => ({
        path,
        encoding,
        elements,
        sha256,
      }));
    const before = [];
    for (const o of original) before.push(await digest(o.id));
    await mutate("object_select", { entityId: original[2].id });
    await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
    await page
      .getByRole("button", { name: "Re-polygonize", exact: true })
      .click();
    await panel.waitFor();
    const h = await history();
    await panel.getByRole("button", { name: "Apply", exact: true }).click();
    let done;
    for (let i = 0; i < 2400; i++) {
      done = (await call("project_get")).result.objects;
      if (done.length === 4) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(done.length, 4);
    const outputId = done.find((o) => !original.some((s) => s.id === o.id)).id;
    const expected =
      "e3a54940e0d1f2be3b291bab672dd40cd09914339f24cd17671d01bea57a08a2";
    const coordinateHash = (g) =>
      createHash("sha256")
        .update(Buffer.from(new Float32Array(g.positions).buffer))
        .digest("hex");
    assert.equal(coordinateHash(await geometry(outputId)), expected);
    assert.equal(await history(), h + 1);
    for (let i = 0; i < 3; i++) {
      assert.equal(done.find((o) => o.id === original[i].id).visible, false);
      assert.deepEqual(await digest(original[i].id), before[i]);
    }
    await mutate("history_undo", {});
    assert((await call("project_get")).result.objects.every((o) => o.visible));
    const request = {
      entityId: original[2].id,
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution: 0.5 },
      },
    };
    const replay = await job(await mutate("mesh_process", request));
    assert.deepEqual(
      replay.result.reconstruction.inputEntityIds,
      original.map((o) => o.id),
    );
    assert.equal(
      coordinateHash(await geometry(replay.result.entityIds[0])),
      expected,
    );
    for (let i = 0; i < 3; i++)
      assert.deepEqual(await digest(original[i].id), before[i]);
    await mutate("object_select", { entityId: replay.result.entityIds[0] });
    await mutate("viewport_control", {
      action: "fit",
      entityId: replay.result.entityIds[0],
    });
    await page.screenshot({
      path: fileURLToPath(new URL("repolygonize-three-scans.png", out)),
    });
    assert.deepEqual(errors, []);
    ledger.result.originalThreeScans = {
      inputTriangles: 6147452,
      outputTriangles: 50895,
      orderedCoordinateSha256: expected,
      guiMcpNativeEqual: true,
      allSourceBuffersUnchanged: true,
      historyVisibilityRollback: true,
    };
  }
  console.log(JSON.stringify(ledger.result));
} catch (error) {
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("scan-repolygonize-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
