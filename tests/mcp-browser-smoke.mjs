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
  owner: "scanforge-mcp-browser-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/mcp-integration/", root);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport;
let failed;
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
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
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
  const empty = await call("project_get");
  assert.equal(empty.result.objects.length, 0);
  const created = await job(
    await mutate("cad_create", {
      name: "MCP validation box",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [20, 10, 5] },
      },
    }),
  );
  assert.equal(created.entityIds.length, 1);
  await page.getByText("MCP validation box", { exact: true }).first().waitFor();
  const snapshot = await call("project_get");
  assert.equal(snapshot.result.objects.length, 1);
  assert(snapshot.result.objects[0].exactCad);
  await mutate("object_select", { entityId: created.entityIds[0] });
  const referenceRevision = (await call("project_get")).revision;
  const references = await job(
    await call("alignment_references", { entityId: created.entityIds[0] }),
  );
  assert.equal(references.total, 6);
  assert.equal(references.units, "mm");
  assert(
    references.references.every((reference) => reference.kind === "plane"),
  );
  assert.equal((await call("project_get")).revision, referenceRevision);
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  await page
    .getByRole("button", { name: "Read alignment references", exact: true })
    .click();
  await page.getByText("6 references · mm", { exact: true }).waitFor();
  const referenceSelector = page.getByLabel("Alignment reference", {
    exact: true,
  });
  for (const reference of references.references) {
    await referenceSelector.selectOption(reference.id);
    const displayed = page.locator("dl[data-reference-id]");
    assert.deepEqual(
      JSON.parse(await displayed.getAttribute("data-reference-point")),
      reference.point,
    );
    assert.deepEqual(
      JSON.parse(await displayed.getAttribute("data-reference-direction")),
      reference.direction,
    );
  }
  assert.equal((await call("project_get")).revision, referenceRevision);
  // UI undo and MCP redo exercise the same command/history boundary.
  const companion = await job(
    await mutate("cad_create", {
      name: "CAD alignment companion",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [20, 30, 40], size: [2, 4, 6] },
      },
    }),
  );
  const companionReferences = await job(
    await call("alignment_references", { entityId: companion.entityIds[0] }),
  );
  await mutate("object_select", { entityId: created.entityIds[0] });
  const groupRevision = (await call("project_get")).revision;
  const exactConstraints = [{ kind: "point", point: [1, 2, 3], axis: 0 }];
  const exactPreview = await job(
    await mutate("alignment_preview", {
      entityIds: created.entityIds,
      constraints: exactConstraints,
    }),
  );
  assert.equal(exactPreview.targets[0].execution.backend, "OpenCascade");
  assert.equal((await call("project_get")).revision, groupRevision);
  await mutate("preview_discard", { target: "datum" });
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  for (const [axis, value] of [
    ["X", "1"],
    ["Y", "2"],
    ["Z", "3"],
  ])
    await page
      .getByLabel(`Reference 1 point (mm) ${axis}`, { exact: true })
      .fill(value);
  await page
    .getByRole("checkbox", {
      name: "Move CAD alignment companion",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByText("Alignment preview ready · model unchanged", { exact: true })
    .waitFor();
  assert.equal((await call("project_get")).revision, groupRevision);
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .waitFor();
  const placedReferences = await job(
    await call("alignment_references", { entityId: created.entityIds[0] }),
  );
  placedReferences.references.forEach((reference, i) =>
    reference.point.forEach((value, axis) =>
      assert.ok(
        Math.abs(
          value - (references.references[i].point[axis] - [1, 2, 3][axis]),
        ) < 1e-10,
      ),
    ),
  );
  const placedCompanion = await job(
    await call("alignment_references", { entityId: companion.entityIds[0] }),
  );
  placedCompanion.references.forEach((reference, i) =>
    reference.point.forEach((value, axis) =>
      assert.ok(
        Math.abs(
          value -
            (companionReferences.references[i].point[axis] - [1, 2, 3][axis]),
        ) < 1e-10,
      ),
    ),
  );
  await mutate("history_undo", {});
  const originalCompanion = await job(
    await call("alignment_references", { entityId: companion.entityIds[0] }),
  );
  assert.deepEqual(
    originalCompanion.references,
    companionReferences.references,
  );
  assert.deepEqual(
    (
      await job(
        await call("alignment_references", { entityId: created.entityIds[0] }),
      )
    ).references,
    references.references,
  );
  await mutate("history_redo", {});
  assert.deepEqual(
    (
      await job(
        await call("alignment_references", {
          entityId: companion.entityIds[0],
        }),
      )
    ).references,
    placedCompanion.references,
  );
  assert.deepEqual(
    (
      await job(
        await call("alignment_references", { entityId: created.entityIds[0] }),
      )
    ).references,
    placedReferences.references,
  );
  await mutate("history_undo", {});
  await page.getByRole("tab", { name: "Edit / View", exact: true }).click();
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal((await call("project_get")).result.objects.length, 0);
  await mutate("history_redo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  const exported = await job(await call("project_export", { format: "step" }));
  const content = await call("artifact_read", {
    artifactId: exported.artifactId,
  });
  assert(
    Buffer.from(content.result.base64, "base64")
      .toString()
      .includes("ISO-10303-21"),
  );
  const saved = await job(await call("project_export", { format: "project" }));
  assert(saved.bytes > 0);
  assert(await page.evaluate(() => crossOriginIsolated));
  const artifactBytes = async (artifactId) => {
    const parts = [];
    let offset = 0;
    for (;;) {
      const { result } = await call("artifact_read", { artifactId, offset });
      const part = Buffer.from(result.base64, "base64");
      parts.push(part);
      offset += part.length;
      if (result.eof) return Buffer.concat(parts);
      assert(part.length > 0);
    }
  };
  const exactSavedBytes = await artifactBytes(saved.artifactId);
  const savedGeometry = (bytes) => {
    const manifest = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(8)));
    // Compare every saved state and byte digest, independently of compression.
    return {
      current: manifest.current,
      history: manifest.history,
      future: manifest.future,
      records: manifest.records,
      chunks: manifest.chunks.map(({ rawBytes, sha256 }) => ({
        rawBytes,
        sha256,
      })),
    };
  };
  const exactSavedGeometry = savedGeometry(exactSavedBytes);
  assert(exactSavedGeometry.records.some((record) => record.brep));
  assert(exactSavedGeometry.history.length && exactSavedGeometry.future.length);
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles({
      name: "exact-persistence.scanforge",
      mimeType: "application/x-scanforge",
      buffer: exactSavedBytes,
    });
  await page.getByText(/^Opened.*1\/1 files$/).waitFor();
  const verifySavedGeometry = async () => {
    const artifact = await job(
      await call("project_export", { format: "project" }),
    );
    assert.deepEqual(
      savedGeometry(await artifactBytes(artifact.artifactId)),
      exactSavedGeometry,
    );
    await call("artifact_delete", { artifactId: artifact.artifactId });
  };
  await verifySavedGeometry();
  // GUI open already preserves saved buffers; public MCP restore must match it.
  const exactUpload = await call("artifact_put", {
    name: "exact-persistence.scanforge",
    offset: 0,
    base64: exactSavedBytes.toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: exactUpload.result.artifactId,
      replace: true,
    }),
  );
  await verifySavedGeometry();
  await call("artifact_delete", { artifactId: exactUpload.result.artifactId });
  const copied = await mutate("mesh_copy", { entityId: created.entityIds[0] });
  const meshId = copied.result.entityId;
  const transformed = await mutate("mesh_transform", {
    entityId: meshId,
    translation: [1, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert(transformed.ok);
  await mutate("object_select", { entityId: meshId });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const sourceAnalysis = await job(
    await call("mesh_analyze", { entityId: meshId }),
  );
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  await page.getByLabel("Reference 1 point (mm) X", { exact: true }).fill("1");
  await page
    .getByLabel("Frame translation (mm) X", { exact: true })
    .fill("1.25");
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByText("Alignment preview ready · model unchanged", { exact: true })
    .waitFor();
  assert.equal((await call("application_inspect")).result.previews.datum, true);
  await page.screenshot({
    path: fileURLToPath(
      new URL("coordinate-alignment-preview.png", artifactDir),
    ),
  });
  const previewAnalysis = await job(
    await call("mesh_analyze", { entityId: meshId }),
  );
  assert.deepEqual(previewAnalysis.stats, sourceAnalysis.stats);
  await page
    .getByRole("button", { name: "Cancel alignment", exact: true })
    .click();
  assert.equal(
    (await call("application_inspect")).result.previews.datum,
    false,
  );
  const constraints = [{ kind: "point", point: [1, 0, 0], axis: 0 }];
  const nativePreview = await job(
    await mutate("alignment_preview", {
      entityIds: [meshId],
      constraints,
      translation: [1.25, 0, 0],
    }),
  );
  assert.deepEqual(nativePreview.targets[0].bounds.min, [-11.25, -5, -2.5]);
  assert.deepEqual(nativePreview.cadMatrix, nativePreview.matrix);
  await mutate("preview_discard", { target: "datum" });
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  await page
    .getByText("Alignment preview ready · model unchanged", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .waitFor();
  const alignedAnalysis = await job(
    await call("mesh_analyze", { entityId: meshId }),
  );
  assert.deepEqual(
    alignedAnalysis.stats.min,
    nativePreview.targets[0].bounds.min,
  );
  assert.deepEqual(
    alignedAnalysis.stats.max,
    nativePreview.targets[0].bounds.max,
  );
  await mutate("history_undo", {});
  const restoredAnalysis = await job(
    await call("mesh_analyze", { entityId: meshId }),
  );
  assert.deepEqual(restoredAnalysis.stats, sourceAnalysis.stats);
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Reference 1 object", { exact: true })
    .selectOption(created.entityIds[0]);
  assert.equal(
    await page
      .getByRole("button", { name: "Preview alignment", exact: true })
      .isDisabled(),
    true,
  );
  const face = references.references.find(
    (reference) => reference.kind === "plane",
  );
  await page
    .getByLabel("Reference 1 feature", { exact: true })
    .selectOption(face.id);
  // Original resolver 0x140541770 uses plane radio order Z/X/Y and
  // selects radio zero for every newly chosen primary plane.
  const nativeOptions = JSON.parse(
    await readFile(
      new URL("tests/fixtures/alignment-reference-options-native.json", root),
      "utf8",
    ),
  );
  const primaryPlanes = nativeOptions.cases.filter(
    (sample) => sample.stage === 0 && sample.kind === "plane",
  );
  assert(primaryPlanes.length > 0);
  assert(primaryPlanes.every((sample) => sample.selectionCode === 0));
  const defaultAxis = [2, 0, 1][primaryPlanes[0].selectionCode];
  assert.equal(
    Number(
      await page
        .getByLabel("Reference 1 target axis", { exact: true })
        .inputValue(),
    ),
    defaultAxis,
  );
  for (const axis of [defaultAxis, 0]) {
    if (axis !== defaultAxis) {
      await page
        .getByRole("button", {
          name: "Align object to origin / references",
          exact: true,
        })
        .click();
      await page
        .getByLabel("Reference 1 target axis", { exact: true })
        .selectOption(String(axis));
    }
    const boundPreview = await job(
      await mutate("alignment_preview", {
        entityIds: [meshId],
        constraints: [
          {
            kind: "reference",
            entityId: created.entityIds[0],
            referenceId: face.id,
            axis,
          },
        ],
        translation: [1.25, 0, 0],
      }),
    );
    await mutate("preview_discard", { target: "datum" });
    await page
      .getByRole("button", { name: "Preview alignment", exact: true })
      .click();
    await page
      .getByText("Alignment preview ready · model unchanged", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Apply alignment", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Align object to origin / references",
        exact: true,
      })
      .waitFor();
    const boundAnalysis = await job(
      await call("mesh_analyze", { entityId: meshId }),
    );
    assert.deepEqual(
      boundAnalysis.stats.min,
      boundPreview.targets[0].bounds.min,
    );
    assert.deepEqual(
      boundAnalysis.stats.max,
      boundPreview.targets[0].bounds.max,
    );
    await mutate("history_undo", {});
    assert.deepEqual(
      (await job(await call("mesh_analyze", { entityId: meshId }))).stats,
      sourceAnalysis.stats,
    );
  }
  await mutate("object_update", {
    entityId: meshId,
    patch: { visible: false },
  });
  await mutate("viewport_control", {
    action: "fit",
    entityId: created.entityIds[0],
  });
  await page
    .getByRole("button", {
      name: "Align object to origin / references",
      exact: true,
    })
    .click();
  const viewportHit = (
    await call("viewport_pick", { x: 0.5, y: 0.5, maxHits: 1 })
  ).result.hits[0];
  assert.equal(viewportHit.entityId, created.entityIds[0]);
  const pickedReference = await job(
    await call("alignment_references", {
      entityId: viewportHit.entityId,
      triangleIndex: viewportHit.triangleIndex,
    }),
  );
  await page
    .getByRole("button", { name: "Pick reference face on canvas", exact: true })
    .click();
  const canvas = await page.locator(".viewport canvas").first().boundingBox();
  assert(canvas);
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.waitForFunction(
    (referenceId) =>
      document.querySelector('[aria-label="Reference 1 feature"]')?.value ===
      referenceId,
    pickedReference.references[0].id,
  );
  assert.equal((await call("project_get")).result.selectedId, meshId);
  for (let axis = 0; axis < 3; axis++)
    assert.equal(
      Number(
        await page
          .getByLabel(`Reference 1 point (mm) ${["X", "Y", "Z"][axis]}`, {
            exact: true,
          })
          .inputValue(),
      ),
      pickedReference.references[0].point[axis],
    );
  await page
    .getByRole("button", { name: "Cancel alignment", exact: true })
    .click();
  await mutate("object_update", { entityId: meshId, patch: { visible: true } });
  const repair = await job(
    await mutate("mesh_process", {
      entityId: meshId,
      operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
      createNew: true,
    }),
  );
  assert(repair.entityIds.length === 1);
  const analyzed = await job(await call("mesh_analyze", { entityId: meshId }));
  assert(analyzed.stats?.triangles > 0 || analyzed.topology?.triangles > 0);
  // Interval-produced browser backup is available through the same MCP/GUI operations.
  await page.waitForTimeout(31000);
  const backups = await call("backup_list", { includeThumbnails: true });
  assert.equal(backups.result.intervalMs, 30000);
  assert.equal(backups.result.backups.length, 1);
  const backup = backups.result.backups[0];
  assert.equal(backup.projectId, (await call("project_get")).result.projectId);
  assert(backup.thumbnail?.bytes > 100);
  const preview = await call("artifact_read", {
    artifactId: backup.thumbnail.artifactId,
  });
  assert(Buffer.from(preview.result.base64, "base64").length > 100);
  const beforeRecovery = await call("project_get");
  await job(
    await mutate("backup_restore", { backupId: backup.id, replace: true }),
  );
  const recovered = await call("project_get");
  assert.equal(recovered.result.projectId, backup.projectId);
  assert.equal(recovered.result.undo, beforeRecovery.result.undo);
  assert.equal(
    recovered.result.objects.length,
    beforeRecovery.result.objects.length,
  );
  await page.getByRole("tab", { name: "Main", exact: true }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Project backups" });
  assert.equal(
    await recovery.getByRole("button", { name: "Delete", exact: true }).count(),
    0,
  );
  await recovery.getByRole("button", { name: /^Delete backup / }).click();
  assert.equal((await call("backup_list")).result.backups.length, 1);
  assert.equal(await recovery.getByRole("radio").first().isChecked(), false);
  await recovery
    .getByRole("button", { name: /^Confirm delete backup / })
    .press("Escape");
  assert.equal(await recovery.isVisible(), true);
  await recovery.getByRole("button", { name: /^Delete backup / }).click();
  await recovery.getByRole("radio").first().focus();
  assert.equal(
    await recovery
      .getByRole("button", { name: /^Confirm delete backup / })
      .count(),
    0,
  );
  await recovery.getByRole("button", { name: /^Delete backup / }).click();
  await recovery.screenshot({
    path: fileURLToPath(new URL("row-delete-confirmation.png", artifactDir)),
  });
  await recovery
    .getByRole("button", { name: /^Confirm delete backup / })
    .click();
  await recovery.getByText("No backups yet", { exact: true }).waitFor();
  assert.equal((await call("backup_list")).result.backups.length, 0);
  assert.equal(
    (await call("project_get")).result.objects.length,
    recovered.result.objects.length,
  );
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  // Frozen v2 wire fixture: independent producer, compact normals including -0.
  const typedPositions = Buffer.from(
    new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]).buffer,
  );
  const typedNormals = Buffer.from(
    new Float32Array([-0, 0, 2, -0, 0, 2, -0, 0, 2]).buffer,
  );
  const payloads = [typedPositions, typedNormals];
  const typedManifest = Buffer.from(
    JSON.stringify({
      format: "scanforge-binary",
      version: 2,
      units: "mm",
      name: "Typed normals",
      current: [0],
      history: [],
      future: [],
      records: [
        {
          id: "typed-mesh",
          name: "Typed scanner normals",
          kind: "mesh",
          visible: true,
          color: "#aaaaaa",
          opacity: 1,
          positions: { chunk: 0, type: "f32" },
          normals: { chunk: 1, type: "f32" },
        },
      ],
      chunks: payloads.map((data, index) => ({
        offset: index * 36,
        bytes: data.length,
        rawBytes: data.length,
        codec: "raw",
        sha256: createHash("sha256").update(data).digest("hex"),
      })),
    }),
  );
  const typedHeader = Buffer.alloc(16);
  typedHeader.write("SCANFRG2");
  typedHeader.writeUInt32LE(typedManifest.length, 8);
  typedHeader.writeUInt32LE(72, 12);
  const typedFile = Buffer.concat([typedHeader, typedManifest, ...payloads]);
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles({
      name: "typed-normals.scanforge",
      mimeType: "application/x-scanforge",
      buffer: typedFile,
    });
  await page
    .getByRole("button", { name: "Typed scanner normals", exact: true })
    .waitFor();
  const typedGui = (await call("project_get")).result.objects;
  assert.equal(typedGui.length, 1);
  assert.equal(typedGui[0].triangles, 1);
  async function exportedTypedNormals() {
    const artifact = await job(
        await call("project_export", { format: "project" }),
      ),
      wire = await call("artifact_read", { artifactId: artifact.artifactId });
    const bytes = Buffer.from(wire.result.base64, "base64"),
      length = bytes.readUInt32LE(8),
      manifest = JSON.parse(bytes.subarray(16, 16 + length).toString()),
      ref = manifest.records[manifest.current[0]].normals,
      chunk = manifest.chunks[ref.chunk];
    assert.equal(ref.type, "f32");
    const stored = bytes.subarray(
        16 + length + chunk.offset,
        16 + length + chunk.offset + chunk.bytes,
      ),
      raw = chunk.codec === "gzip" ? gunzipSync(stored) : stored;
    assert(
      raw.equals(typedNormals),
      "Normal bytes changed at GUI/MCP project boundaries",
    );
    return raw;
  }
  const guiNormalBytes = await exportedTypedNormals();
  const typedUpload = await call("artifact_put", {
    name: "typed-normals.scanforge",
    offset: 0,
    base64: typedFile.toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: typedUpload.result.artifactId,
      replace: true,
    }),
  );
  const typedMcp = (await call("project_get")).result.objects;
  assert.deepEqual(
    typedMcp.map(({ id, name, kind, triangles }) => ({
      id,
      name,
      kind,
      triangles,
    })),
    typedGui.map(({ id, name, kind, triangles }) => ({
      id,
      name,
      kind,
      triangles,
    })),
  );
  assert((await exportedTypedNormals()).equals(guiNormalBytes));
  await page
    .getByRole("button", { name: "Typed scanner normals", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  await page.getByText("Disconnected", { exact: true }).waitFor();
  const disconnected = await client.callTool({
    name: "project_get",
    arguments: {},
  });
  assert(disconnected.isError);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "official SDK stdio initialize/tools/resources",
    "browser pairing and persisted connection after Settings closes",
    "exact CAD creation rendered in UI",
    "MCP and GUI exact alignment references with identical coordinates and unchanged history",
    "explicit multi-object CAD alignment through GUI/shared MCP Preview and atomic Apply/Undo/Redo",
    "native coordinate preview/cancel, primary-plane Z default and explicit X, GUI/MCP Apply and Undo restore identical scan geometry",
    "UI undo and MCP redo",
    "STEP content and project export artifacts",
    "cross-origin-isolated GUI/public-MCP exact BREP reopen preserves all saved current/Undo/Redo buffer hashes",
    "mesh copy/transform/winding worker/topology",
    "interval backup thumbnail artifact, MCP recovery identity/history, GUI deletion reflected in MCP",
    "GUI and MCP import the independent v2 typed-normal fixture and export identical Float32 bytes including signed zero",
    "disconnect rejects calls",
  ];
  await page.screenshot({
    path: fileURLToPath(new URL("browser-validation.png", artifactDir)),
  });
  console.log(`PASS: ${ledger.steps.join("; ")}`);
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
