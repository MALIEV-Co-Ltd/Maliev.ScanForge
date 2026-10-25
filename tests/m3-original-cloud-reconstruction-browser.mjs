import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, open } from "node:fs/promises";
import { tmpdir, freemem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Uses an existing dev server and a disposable browser/workspace and MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const out = join(
  tmpdir(),
  `scanforge-original-cloud-reconstruction-${randomUUID()}`,
);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser, page;
const timeout = setTimeout(() => void browserServer?.close(), 600000);
try {
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
  page = await browser.newPage({
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
    for (let i = 0; i < 6000; i++) {
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
  const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
  assert(
    directory,
    "Set SCANFORGE_ALIGNMENT_EXAMPLES to the original scan folder.",
  );
  assert(
    freemem() >= 5120 * 1048576,
    "Original-three cloud replay requires 5120 MiB free; preserve admission.",
  );
  const expectedCounts = [140113, 1375494, 1865848];
  const inputs = [];
  const ids = [];
  const stage = (name, details = {}) =>
    console.log(JSON.stringify({ stage: name, ...details }));
  for (let scan = 1; scan <= 3; scan++) {
    const name = `asc-${scan}.asc`;
    const source = await open(join(directory, name), "r");
    const hash = createHash("sha256");
    let upload,
      bytes = 0;
    try {
      const chunk = Buffer.alloc(1048576);
      for (;;) {
        const { bytesRead } = await source.read(chunk, 0, chunk.length, bytes);
        if (!bytesRead) break;
        const part = chunk.subarray(0, bytesRead);
        hash.update(part);
        upload = (
          await call("artifact_put", {
            name,
            offset: bytes,
            ...(upload ? { artifactId: upload.artifactId } : {}),
            base64: part.toString("base64"),
          })
        ).result;
        bytes += bytesRead;
      }
    } finally {
      await source.close();
    }
    assert(upload);
    const imported = await job(
      await mutate("project_import", {
        artifactId: upload.artifactId,
        unit: "mm",
        placeAtOrigin: false,
        ascAttributes: "xyz-normal",
      }),
    );
    ids.push(imported.entityId);
    inputs.push({
      name,
      bytes,
      sha256: hash.digest("hex"),
      entityId: imported.entityId,
    });
    await call("artifact_delete", { artifactId: upload.artifactId });
    const object = (await call("object_get", { entityId: imported.entityId }))
      .result;
    assert.equal(object.kind, "pointcloud");
    stage("imported", { name, entityId: imported.entityId, object });
  }
  const digest = async (entityId) => {
    const result = await job(
      await call("object_geometry_digest", { entityId }),
    );
    return result.buffers.map(({ path, encoding, elements, sha256 }) => ({
      path,
      encoding,
      elements,
      sha256,
    }));
  };
  const before = [];
  for (const id of ids) before.push(await digest(id));
  const resolution = Number(
    process.env.SCANFORGE_RECONSTRUCTION_RESOLUTION ?? 1,
  );
  await mutate("object_select", { entityId: ids[0] });
  await mutate("command_run", { name: "ribbon:repolygonize" });
  const panel = page.getByRole("region", {
    name: "Re-polygonize",
    exact: true,
  });
  await panel
    .getByLabel("Point resolution (mm)", { exact: true })
    .fill(String(resolution));
  for (const name of ["asc-2.asc", "asc-3.asc"])
    await panel.getByRole("checkbox", { name, exact: true }).check();
  stage("gui-reconstructing", { resolution });
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  const deadline = Date.now() + 300000;
  while (
    !(await panel.getByText(/Verified watertight voxel surface/).isVisible())
  ) {
    const app = (await call("application_inspect")).result;
    if (app.error) throw Error(app.error);
    assert(
      Date.now() < deadline,
      "Original cloud reconstruction exceeded 300-second observation budget",
    );
    await new Promise((r) => setTimeout(r, 300));
  }
  const gui = await digest(ids[0]);
  const geometryInfo = (
    await call("object_get", { entityId: ids[0], includeGeometry: true })
  ).result.geometry;
  const parts = [];
  let offset = 0;
  for (;;) {
    const part = (
      await call("artifact_read", {
        artifactId: geometryInfo.artifactId,
        offset,
      })
    ).result;
    const bytes = Buffer.from(part.base64, "base64");
    parts.push(bytes);
    offset += bytes.length;
    if (part.eof) break;
  }
  await writeFile(join(out, "output-geometry.json"), Buffer.concat(parts));
  await call("artifact_delete", { artifactId: geometryInfo.artifactId });
  const guiText = await panel.innerText();
  assert.equal(
    (await call("object_get", { entityId: ids[0] })).result.kind,
    "mesh",
  );
  await page.screenshot({
    path: join(out, "original-cloud-reconstruction.png"),
  });
  await mutate("history_undo");
  assert.deepEqual(await digest(ids[0]), before[0]);
  assert.equal(
    (await call("object_get", { entityId: ids[0] })).result.kind,
    "pointcloud",
  );
  stage("mcp-reconstructing");
  const result = await job(
    await mutate("mesh_process", {
      entityId: ids[0],
      targetIds: ids.slice(1),
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution },
      },
    }),
  );
  assert.deepEqual(
    await digest(ids[0]),
    gui,
    "Full original-three cloud GUI/public MCP output equality",
  );
  const points = expectedCounts.reduce((a, b) => a + b, 0);
  assert.equal(result.diagnostics.inputPoints, points);
  assert.equal(result.diagnostics.processedPoints, points);
  assert.equal(result.diagnostics.representedPoints, points);
  assert.equal(result.diagnostics.watertight, true);
  for (let i = 1; i < 3; i++) assert.deepEqual(await digest(ids[i]), before[i]);
  await mutate("history_undo");
  assert.deepEqual(await digest(ids[0]), before[0]);
  await mutate("history_redo");
  assert.deepEqual(await digest(ids[0]), gui);
  const history = (await call("history_get")).result;
  await mutate("history_seek", { index: history.cursor - 1 });
  assert.deepEqual(await digest(ids[0]), before[0]);
  await mutate("history_seek", { index: history.cursor });
  assert.deepEqual(await digest(ids[0]), gui);
  stage("project-roundtrip");
  const exported = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: exported.artifactId });
  assert.deepEqual(await digest(ids[0]), gui);
  for (let i = 1; i < 3; i++) assert.deepEqual(await digest(ids[i]), before[i]);
  await mutate("history_undo");
  assert.deepEqual(await digest(ids[0]), before[0]);
  await mutate("history_redo");
  assert.deepEqual(await digest(ids[0]), gui);
  stage("backup-wait");
  await new Promise((r) => setTimeout(r, 35000));
  const backups = (await call("backup_list")).result.backups;
  assert.equal(backups.length, 1);
  await job(
    await mutate("backup_restore", { backupId: backups[0].id, replace: true }),
  );
  assert.deepEqual(await digest(ids[0]), gui);
  await mutate("history_undo");
  assert.deepEqual(await digest(ids[0]), before[0]);
  await mutate("history_redo");
  assert.deepEqual(await digest(ids[0]), gui);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    scope:
      "Full original-three ASC import and unmodified-placement XYZ reconstruction through production GUI/public stdio MCP; timeline/project export-reopen/browser backup restore verified; not aligned combination quality, native reconstruction equivalence, self-intersection or full M3 lifecycle acceptance",
    inputs,
    pointCounts: expectedCounts,
    resolution,
    guiText,
    result,
    before,
    after: gui,
    errors,
  };
  await writeFile(
    join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, out }));
} catch (error) {
  const diagnostic = {
    passed: false,
    error: String(error.stack ?? error),
    out,
  };
  if (page) {
    diagnostic.body = await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable");
    await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  }
  await writeFile(
    join(out, "failure.json"),
    JSON.stringify(diagnostic, null, 2),
  );
  console.error(JSON.stringify(diagnostic));
  throw error;
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
}
