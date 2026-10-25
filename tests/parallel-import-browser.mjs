import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const plyFixture = process.env.SCANFORGE_IMPORT_FIXTURE === "ply";
const sharedImport = process.env.SCANFORGE_SHARED_IMPORT === "1";
const automaticBackup = process.env.SCANFORGE_AUTO_BACKUP === "1";
assert(
  !automaticBackup || (sharedImport && plyFixture),
  "Automatic backup mode requires shared PLY imports",
);
assert(
  !sharedImport || plyFixture,
  "Shared import mode requires the PLY fixture",
);
const extension = plyFixture ? "ply" : "stl";
const root = new URL("../", import.meta.url),
  out = new URL(
    automaticBackup
      ? "../.resources/parallel-import-ply-shared-backup-browser/"
      : sharedImport
        ? "../.resources/parallel-import-ply-shared-browser/"
        : plyFixture
          ? "../.resources/parallel-import-ply-browser/"
          : "../.resources/parallel-import-browser/",
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
    owner: "parallel-import-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
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
        ...(sharedImport
          ? {
              "Cross-Origin-Opener-Policy": "same-origin",
              "Cross-Origin-Embedder-Policy": "require-corp",
            }
          : {}),
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
  client = new Client({ name: "bridge-drag-validation", version: "1" });
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
    new URL("parallel-import-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(
    ({ automaticBackup }) => {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 8 });
      Object.defineProperty(navigator, "deviceMemory", { value: 8 });
      window.__pendingImports = [];
      window.__importWorkers = 0;
      window.__activeImports = 0;
      window.__importResultStorage = [];
      window.__holdPicking = false;
      window.__pendingPicking = [];
      window.__heldPickingReplies = 0;
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options);
          this.importing = String(url).includes("import-worker");
          this.released = false;
          this.picking =
            automaticBackup && String(url).includes("viewport-picking-worker");
          if (this.picking) {
            this.addEventListener("message", (event) => {
              if (!window.__holdPicking || this.deliveringPicking) return;
              event.stopImmediatePropagation();
              if (++window.__heldPickingReplies > 16)
                throw Error("Picking reply hold exceeded bounded capacity");
              window.__pendingPicking.push(() => {
                if (this.pickingStopped) return;
                this.deliveringPicking = true;
                try {
                  this.dispatchEvent(
                    new MessageEvent("message", { data: event.data }),
                  );
                } finally {
                  this.deliveringPicking = false;
                }
              });
            });
          }
          if (this.importing) {
            window.__importWorkers++;
            window.__activeImports++;
            this.addEventListener("message", (event) => {
              if (event.data.positions && !this.released) {
                const shared = (array) =>
                  typeof SharedArrayBuffer !== "undefined" &&
                  array?.buffer instanceof SharedArrayBuffer;
                window.__importResultStorage.push({
                  positionsShared: shared(event.data.positions),
                  meshNormalsShared: shared(event.data.meshNormals),
                  positionBytes: event.data.positions.byteLength,
                  normalBytes: event.data.meshNormals?.byteLength ?? 0,
                });
                event.stopImmediatePropagation();
                window.__pendingImports.push(() => {
                  this.released = true;
                  this.dispatchEvent(
                    new MessageEvent("message", { data: event.data }),
                  );
                });
              }
            });
          }
        }
        terminate() {
          if (this.picking) this.pickingStopped = true;
          if (this.importing && !this.stopped) {
            this.stopped = true;
            window.__activeImports--;
          }
          return super.terminate();
        }
      };
    },
    { automaticBackup },
  );
  await page.goto(origin);
  if (plyFixture)
    assert.equal(await page.evaluate(() => crossOriginIsolated), sharedImport);
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

  const packedPly = () => {
    const header = Buffer.from(
      "ply\nformat binary_little_endian 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
    );
    const data = Buffer.alloc(header.length + 4 * 24 + 13);
    header.copy(data);
    // Authored face bounds already have centered XY and base Z=0 for GUI/MCP placement parity.
    const vertices = [
      [-5, -5, 0, -0, 0.25, 2],
      [5, -5, 0, 0, -3, 1],
      [0, 5, 0, 4, 0, -0],
      [9, 9, 9, 1, 1, 1],
    ];
    vertices.forEach((row, vertex) =>
      row.forEach((value, component) =>
        data.writeFloatLE(value, header.length + vertex * 24 + component * 4),
      ),
    );
    const face = header.length + 4 * 24;
    data.writeUInt8(3, face);
    [2, 0, 1].forEach((id, corner) =>
      data.writeInt32LE(id, face + 1 + corner * 4),
    );
    return data;
  };
  const source = plyFixture
    ? packedPly()
    : Buffer.from(
        "solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test",
      );
  const input = page.locator('input[type=file][accept*=".stl"]');
  await input.setInputFiles(
    ["first", "second", "third"].map((stem) => ({
      name: `${stem}.${extension}`,
      mimeType: "application/octet-stream",
      buffer: source,
    })),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.mouse.move(900, 450);
  await page.waitForFunction(() => window.__pendingImports.length === 2);
  assert.equal(await page.evaluate(() => window.__importWorkers), 2);
  const label = page.locator(".pointer-job-status");
  await label.waitFor({ state: "visible" });
  assert.equal(await label.getByRole("progressbar").count(), 2);
  assert.match(await label.innerText(), new RegExp(`first\\.${extension}`));
  assert.match(await label.innerText(), new RegExp(`second\\.${extension}`));
  assert.match(await label.innerText(), /1 queued/);
  await page.screenshot({
    path: fileURLToPath(new URL("parallel-import.png", out)),
  });
  await page.evaluate(() =>
    window.__pendingImports.splice(0).forEach((release) => release()),
  );
  await page.waitForFunction(() => window.__pendingImports.length === 1);
  await page.evaluate(() =>
    window.__pendingImports.splice(0).forEach((release) => release()),
  );
  await label.waitFor({ state: "detached" });
  let project = (await call("project_get")).result;
  assert.equal(project.objects.length, 3);
  assert.equal(project.undo, 3);
  assert.equal(await page.evaluate(() => window.__activeImports), 0);

  const uploads = [];
  for (const stem of ["agent-first", "agent-second", "agent-third"])
    uploads.push(
      (
        await call("artifact_put", {
          name: `${stem}.${extension}`,
          offset: 0,
          base64: source.toString("base64"),
        })
      ).result.artifactId,
    );
  const receipt = await mutate("project_import_batch", {
    artifactIds: uploads,
  });
  await page.waitForFunction(() => window.__pendingImports.length === 2);
  const state = (await call("job_get", { jobId: receipt.result.jobId })).result;
  assert.equal(state.progressDetails.kind, "importBatch");
  assert.equal(
    state.progressDetails.files.filter((file) => file.status === "importing")
      .length,
    2,
  );
  assert.equal(
    state.progressDetails.files.filter((file) => file.status === "queued")
      .length,
    1,
  );
  await call("job_cancel", { jobId: receipt.result.jobId });
  await job(receipt, "cancelled");
  assert.equal(await page.evaluate(() => window.__activeImports), 0);
  assert.equal((await call("project_get")).result.objects.length, 3);
  await label.waitFor({ state: "detached" });
  let plyParity;
  if (plyFixture) {
    // Drain held deliveries from the already cancelled workers before the fresh import.
    await page.evaluate(() =>
      window.__pendingImports.splice(0).forEach((release) => release()),
    );
    assert.equal(await page.evaluate(() => window.__pendingImports.length), 0);
    const geometry = async (entityId) => {
      const object = (
        await call("object_get", { entityId, includeGeometry: true })
      ).result;
      const artifact = (
        await call("artifact_read", { artifactId: object.geometry.artifactId })
      ).result;
      assert.equal(artifact.eof, true);
      return {
        geometry: JSON.parse(
          Buffer.from(artifact.base64, "base64").toString("utf8"),
        ),
        source: object.scanSource,
        triangles: object.triangles,
        indexedTopology: object.indexedTopology,
      };
    };
    project = (await call("project_get")).result;
    const guiFirst = project.objects.find(
      (object) => object.name === "first.ply",
    );
    assert(guiFirst);
    const guiGeometry = await geometry(guiFirst.id);
    const undoBefore = project.undo;
    const completed = await mutate("project_import", {
      artifactId: uploads[0],
      unit: "mm",
    });
    await page.waitForFunction(() => window.__pendingImports.length === 1);
    await page.evaluate(() =>
      window.__pendingImports.splice(0).forEach((release) => release()),
    );
    const imported = await job(completed);
    const entityId = imported.result.entityId;
    const agentGeometry = await geometry(entityId);
    assert.deepEqual(agentGeometry, guiGeometry);
    assert.deepEqual(agentGeometry.geometry.indexedMesh.triangles, [2, 0, 1]);
    assert.deepEqual(
      agentGeometry.geometry.normals,
      [4, 0, 0, 0, 0.25, 2, 0, -3, 1],
    );
    project = (await call("project_get")).result;
    assert.equal(project.objects.length, 4);
    assert.equal(project.undo, undoBefore + 1);
    assert.equal(await page.evaluate(() => window.__activeImports), 0);
    await mutate("history_undo", {});
    assert.equal((await call("project_get")).result.objects.length, 3);
    await mutate("history_redo", {});
    assert.equal((await call("project_get")).result.objects.length, 4);
    assert.deepEqual(await geometry(entityId), guiGeometry);
    plyParity = {
      completedMcpImport: true,
      geometryMatchesGui: true,
      importUndoSteps: 1,
      undoRedo: true,
    };
    const storage = await page.evaluate(() => window.__importResultStorage);
    assert.equal(
      storage.length,
      6,
      "Three GUI, two cancelled and one completed MCP import result",
    );
    for (const result of storage) {
      assert.equal(result.positionsShared, sharedImport);
      assert.equal(result.meshNormalsShared, sharedImport);
      assert.equal(result.positionBytes, 36);
      assert.equal(result.normalBytes, 36);
    }
    plyParity.sharedReadonlyBuffers = sharedImport;
    plyParity.importStorage = storage;
    if (sharedImport) {
      const allGeometry = async () => {
        const current = (await call("project_get")).result;
        return Promise.all(
          current.objects
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(async (object) => ({
              name: object.name,
              ...(await geometry(object.id)),
            })),
        );
      };
      const before = await allGeometry();
      assert.equal(before.length, 4);
      const exported = await job(
        await call("project_export", { format: "project" }),
      );
      assert.deepEqual(
        await allGeometry(),
        before,
        "Project export preserves every authored buffer",
      );
      await job(
        await mutate("project_import", {
          artifactId: exported.result.artifactId,
          replace: true,
        }),
      );
      assert.deepEqual(
        await allGeometry(),
        before,
        "Project import restores every object geometry and source count",
      );
      assert.equal(await page.evaluate(() => window.__activeImports), 0);
      plyParity.projectExportPreservesGeometry = true;
      plyParity.projectRoundTripObjects = 4;
      if (automaticBackup) {
        const backups = async () =>
          (await call("backup_list", { includeThumbnails: false })).result
            .backups;
        assert.deepEqual(
          await backups(),
          [],
          "Fresh profile must not already contain an automatic backup",
        );
        assert(
          await page.evaluate(() => performance.now() < 25_000),
          "Establish the held import before the first 30-second backup interval",
        );
        const originalNames = new Set(before.map((object) => object.name));
        const metadata = async () => {
          const objects = (await call("project_get")).result.objects;
          return Promise.all(
            objects
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(async (object) => {
                const { meshPreparation: _preparation, ...stable } = (
                  await call("object_get", { entityId: object.id })
                ).result;
                return stable;
              }),
          );
        };
        const originalMetadata = await metadata();
        const triangleCount = 10_000,
          vertexCount = triangleCount * 3;
        const header = Buffer.from(
          `ply\nformat binary_little_endian 1.0\nelement vertex ${vertexCount}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face ${triangleCount}\nproperty list uchar int vertex_indices\nend_header\n`,
        );
        const large = Buffer.alloc(
          header.length + vertexCount * 24 + triangleCount * 13,
        );
        header.copy(large);
        for (let triangle = 0; triangle < triangleCount; triangle++) {
          const x = (triangle % 100) * 3,
            y = Math.floor(triangle / 100) * 3;
          [
            [x, y, 0, -0, 0.25, 2],
            [x + 1, y, 0, 0, -3, 1],
            [x, y + 1, 0, 4, 0, -0],
          ].forEach((row, corner) => {
            row.forEach((value, component) =>
              large.writeFloatLE(
                value,
                header.length + (triangle * 3 + corner) * 24 + component * 4,
              ),
            );
          });
          const face = header.length + vertexCount * 24 + triangle * 13;
          large.writeUInt8(3, face);
          for (let corner = 0; corner < 3; corner++)
            large.writeInt32LE(triangle * 3 + corner, face + 1 + corner * 4);
        }
        const uploaded = await call("artifact_put", {
          name: "backup-picking.ply",
          offset: 0,
          base64: large.toString("base64"),
        });
        await page.evaluate(() => {
          window.__holdPicking = true;
        });
        const heldSince = Date.now();
        const largeImport = await mutate("project_import", {
          artifactId: uploaded.result.artifactId,
          unit: "mm",
        });
        await page.waitForFunction(() => window.__pendingImports.length === 1);
        await page.evaluate(() =>
          window.__pendingImports.splice(0).forEach((release) => release()),
        );
        const largeResult = await job(largeImport);
        await page.waitForFunction(() => window.__pendingPicking.length > 0);
        assert(
          await page.evaluate(() => performance.now() < 29_000),
          "The actual picking reply must be held before the first backup interval",
        );
        assert.equal((await call("project_get")).result.objects.length, 5);
        const fiveMetadata = await metadata();
        const largeMetadata = fiveMetadata.find(
          (object) => object.id === largeResult.result.entityId,
        );
        assert.equal(largeMetadata.triangles, triangleCount);
        assert.deepEqual(largeMetadata.indexedTopology, {
          vertices: vertexCount,
          triangles: triangleCount,
        });
        assert(
          largeMetadata.scanSource,
          "Source counts must remain discoverable",
        );
        assert.equal(largeMetadata.scanSource.bytes, large.length);
        assert.equal(largeMetadata.scanSource.triangles, triangleCount);
        assert.equal(
          largeMetadata.scanSource.displayedTriangles,
          triangleCount,
        );
        await page.waitForTimeout(
          Math.max(0, 35_000 - (Date.now() - heldSince)),
        );
        assert(
          await page.evaluate(
            () => window.__holdPicking && window.__pendingPicking.length > 0,
          ),
        );
        assert.deepEqual(
          await backups(),
          [],
          "Automatic backup must defer across the first interval while picking owns preparation",
        );
        const releasedPickingReplies = await page.evaluate(() => {
          window.__holdPicking = false;
          const pending = window.__pendingPicking.splice(0);
          pending.forEach((release) => release());
          return pending.length;
        });
        assert(releasedPickingReplies >= 1 && releasedPickingReplies <= 16);
        let saved;
        const backupDeadline = Date.now() + 40_000;
        while (Date.now() < backupDeadline) {
          const entries = await backups();
          saved = entries.find((entry) => entry.snapshot === "latest");
          if (saved) break;
          await page.waitForTimeout(250);
        }
        assert(
          saved,
          "Automatic backup must retry at the next interval after picking completes",
        );
        await mutate("history_undo", {});
        assert.equal(
          (await call("project_get")).result.objects.length,
          4,
          "Undo removes the large import before recovery",
        );
        await job(
          await mutate("backup_restore", { backupId: saved.id, replace: true }),
        );
        assert.equal((await call("project_get")).result.objects.length, 5);
        assert.deepEqual(
          await metadata(),
          fiveMetadata,
          "Backup restore preserves all five object metadata and source/indexed counts",
        );
        const restoredOriginals = [];
        for (const object of (await call("project_get")).result.objects
          .filter((object) => originalNames.has(object.name))
          .sort((a, b) => a.name.localeCompare(b.name))) {
          restoredOriginals.push({
            name: object.name,
            ...(await geometry(object.id)),
          });
        }
        assert.deepEqual(
          restoredOriginals,
          before,
          "Backup restore preserves exact geometry of the original four objects",
        );
        assert.deepEqual(
          (await metadata()).filter((object) => originalNames.has(object.name)),
          originalMetadata,
        );
        plyParity.automaticBackup = {
          deferredDuringPicking: true,
          releasedPickingReplies,
          restoredObjects: 5,
          originalGeometryExact: true,
          largeGeometryCheck:
            "source and indexed counts plus metadata; no full buffer comparison",
        };
      }
    }
  }
  assert.deepEqual(errors, []);
  ledger.result = {
    guiParallelWorkers: 2,
    guiObjects: 3,
    undoSteps: 3,
    pointerBars: 2,
    mcpPerFileProgress: true,
    cancellationPreservesObjects: true,
    activeImportWorkersAfterCleanup: 0,
    pageErrors: errors,
    ...(plyParity ? { fixture: "ply", plyParity } : {}),
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  failed = error;
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
    new URL("parallel-import-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
