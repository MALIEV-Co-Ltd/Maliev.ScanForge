import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Fresh owned processes per original avoid making harness retention part of import.
if (!process.env.SCANFORGE_M1_FILES) {
  const names = [
    "scan-1.stl",
    "scan-2.stl",
    "scan-3.stl",
    "ply-1.ply",
    "ply-2.ply",
    "ply-3.ply",
    "asc-1.asc",
    "asc-2.asc",
    "asc-3.asc",
  ];
  const results = [];
  for (const name of names) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, SCANFORGE_M1_FILES: name },
        stdio: "inherit",
        timeout: 180000,
      },
    );
    assert.equal(
      child.status,
      0,
      `${name}: ${child.error?.message ?? "original acceptance failed"}`,
    );
    const result = JSON.parse(
      await readFile(
        new URL(
          `../.resources/m1-original-import/${name}/original-import-results.json`,
          import.meta.url,
        ),
      ),
    );
    results.push(...result.results);
  }
  await writeFile(
    new URL(
      "../.resources/m1-original-import/original-import-results.json",
      import.meta.url,
    ),
    JSON.stringify({ passed: true, results }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, originals: results.length }));
  process.exit(0);
}
const root = new URL("../", import.meta.url),
  out = new URL(
    `../.resources/m1-original-import/${process.env.SCANFORGE_M1_FILES.split(",").length === 1 ? process.env.SCANFORGE_M1_FILES + "/" : ""}`,
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
    owner: "point-cloud-edit-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 900000);
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
  client = new Client({ name: "point-cloud-edit-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({ kind: "browser", pid: browserServer.process().pid });
  await writeFile(
    new URL("original-import-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /shader|WebGLProgram/i.test(message.text())
    )
      errors.push(message.text());
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

  const { createHash } = await import("node:crypto");
  const { openAsBlob } = await import("node:fs");
  const { join } = await import("node:path");
  const {
    readScan,
    digestEntityGeometry,
    meshGeometryNormals,
    readAscPointCloud,
  } = await import("../.resources/m1-import-core.mjs");
  const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
  // The originals contain scanner normals, not RGB; choose the shared interpretation.
  await mutate("settings_set", {
    patch: { importAscAttributes: "xyz-normal" },
  });
  assert(
    folder,
    "Set SCANFORGE_ALIGNMENT_EXAMPLES to the original scanner files",
  );
  const native = JSON.parse(
    await readFile(
      new URL("fixtures/stl-owner-topology-native.json", import.meta.url),
    ),
  ).sources;
  const normalize = (digest) =>
    digest.buffers.map(({ path, encoding, elements, sha256 }) => ({
      path,
      encoding,
      elements,
      sha256,
    }));
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const digest = async (entityId) =>
    (await job(await call("object_geometry_digest", { entityId }))).result;
  const results = [];
  await mutate("project_new", { discard: true });
  await page.locator('input[type=file][accept*=".stl"]').setInputFiles({
    name: "malformed.stl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid scanner file"),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator(".error-banner").waitFor();
  assert.equal((await call("project_get")).result.objects.length, 0);
  await mutate("ui_set", { dismissError: true });
  const malformed = (
    await call("artifact_put", {
      name: "malformed.stl",
      offset: 0,
      base64: Buffer.from("invalid scanner file").toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", { artifactId: malformed.artifactId }),
    "failed",
  );
  assert.equal((await call("project_get")).result.objects.length, 0);
  await call("artifact_delete", { artifactId: malformed.artifactId });
  ledger.malformedGuiMcpRecovery = true;
  for (const extension of ["stl", "ply", "asc"])
    for (const scan of [1, 2, 3]) {
      const name =
        extension === "stl"
          ? `scan-${scan}.stl`
          : `${extension}-${scan}.${extension}`;
      if (
        process.env.SCANFORGE_M1_FILES &&
        !process.env.SCANFORGE_M1_FILES.split(",").includes(name)
      )
        continue;
      const filePath = join(folder, name);
      const blob = await openAsBlob(filePath);
      const bytes = Buffer.from(await blob.arrayBuffer());
      const sourceSha256 = hash(bytes);
      let indexedMesh, normals;
      const positions =
        extension === "asc"
          ? await readAscPointCloud(blob, { attributes: "xyz-normal" }).then(
              (cloud) => {
                normals = cloud.normals;
                return cloud.positions;
              },
            )
          : await readScan(blob, extension, {
              onIndexedMesh: (mesh) => {
                indexedMesh = mesh;
              },
              onMeshNormals: (value) => {
                normals = value;
              },
              onPointCloud: (value) => {
                normals = value.normals;
              },
            });
      if (extension !== "asc") assert(indexedMesh);
      if (extension === "stl") {
        const oracle = native.find((row) => row.file === name);
        assert.equal(sourceSha256, oracle.sourceSha256);
        assert.equal(hash(indexedMesh.vertices), oracle.verticesSha256);
        assert.equal(hash(indexedMesh.triangles), oracle.trianglesSha256);
        assert.equal(indexedMesh.vertices.length / 3, oracle.vertexCount);
        assert.equal(indexedMesh.triangles.length / 3, oracle.triangleCount);
      } else if (extension === "ply") {
        // Independent binary-file oracle, without the application PLY parser.
        const headerEnd = bytes.indexOf("\n", bytes.indexOf("end_header")) + 1;
        const header = bytes.subarray(0, headerEnd).toString();
        assert(header.includes("format binary_little_endian 1.0"));
        const vertices = Number(/element vertex (\d+)/.exec(header)[1]);
        const faces = Number(/element face (\d+)/.exec(header)[1]);
        assert.equal(indexedMesh.vertices.length, vertices * 3);
        assert.equal(indexedMesh.normals.length, vertices * 3);
        for (let vertex = 0; vertex < vertices; vertex++)
          for (let axis = 0; axis < 3; axis++) {
            assert(
              Object.is(
                indexedMesh.vertices[vertex * 3 + axis],
                bytes.readFloatLE(headerEnd + vertex * 24 + axis * 4),
              ),
            );
            assert(
              Object.is(
                indexedMesh.normals[vertex * 3 + axis],
                bytes.readFloatLE(headerEnd + vertex * 24 + 12 + axis * 4),
              ),
            );
          }
        let offset = headerEnd + vertices * 24;
        for (let face = 0; face < faces; face++) {
          assert.equal(bytes[offset++], 3);
          for (let corner = 0; corner < 3; corner++, offset += 4)
            assert.equal(
              indexedMesh.triangles[face * 3 + corner],
              bytes.readUInt32LE(offset),
            );
        }
        assert.equal(offset, bytes.length);
      } else {
        // ASC text is rounded; compare every sample with its original binary PLY.
        const ply = await readFile(join(folder, `ply-${scan}.ply`));
        const offset = ply.indexOf("\n", ply.indexOf("end_header")) + 1;
        const count = Number(
          /element vertex (\d+)/.exec(ply.subarray(0, offset).toString())[1],
        );
        assert.equal(positions.length, count * 3);
        assert.equal(normals.length, count * 3);
        for (let point = 0; point < count; point++)
          for (let axis = 0; axis < 3; axis++) {
            assert(
              Math.abs(
                positions[point * 3 + axis] -
                  ply.readFloatLE(offset + point * 24 + axis * 4),
              ) <= 0.0006,
            );
            assert(
              Math.abs(
                normals[point * 3 + axis] -
                  ply.readFloatLE(offset + point * 24 + 12 + axis * 4),
              ) <= 0.0000006,
            );
          }
      }
      // Computed geometry normals are distinct from the file-authored carrier.
      if (indexedMesh)
        indexedMesh.geometryNormals = meshGeometryNormals(indexedMesh);
      const expected = normalize(
        await digestEntityGeometry({
          id: "expected",
          name,
          kind: extension === "asc" ? "pointcloud" : "mesh",
          positions,
          normals,
          indexedMesh,
          visible: true,
          color: "#ffffff",
          opacity: 1,
        }),
      );
      await mutate("project_new", { discard: true });
      if (bytes.length > 50 * 1048576) {
        await page
          .locator('input[type=file][accept*=".stl"]')
          .setInputFiles(filePath);
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await page
          .getByRole("button", { name: "Cancel import", exact: true })
          .click();
        await page
          .locator('.status-message[title^="Import cancelled"]')
          .waitFor({ timeout: 120000 });
        assert.equal((await call("project_get")).result.objects.length, 0);
      }
      await page
        .locator('input[type=file][accept*=".stl"]')
        .setInputFiles(filePath);
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page
        .locator('.status-message[title^="Opened · 1/1 files"]')
        .waitFor({ timeout: 120000 });
      let project = (await call("project_get")).result;
      assert.equal(project.objects.length, 1);
      const guiId = project.objects[0].id;
      const guiDigest = normalize(await digest(guiId));
      assert.deepEqual(guiDigest, expected, `${name}: GUI source buffers`);
      await mutate("history_undo", {});
      assert.equal((await call("project_get")).result.objects.length, 0);
      await mutate("history_redo", {});
      assert.deepEqual(normalize(await digest(guiId)), expected);
      await mutate("project_new", { discard: true });
      let upload;
      for (let offset = 0; offset < bytes.length; offset += 1048576) {
        upload = (
          await call("artifact_put", {
            name,
            offset,
            ...(upload ? { artifactId: upload.artifactId } : {}),
            base64: bytes.subarray(offset, offset + 1048576).toString("base64"),
          })
        ).result;
      }
      const cancelled = await mutate("project_import", {
        artifactId: upload.artifactId,
        unit: "mm",
        placeAtOrigin: false,
      });
      await call("job_cancel", { jobId: cancelled.result.jobId });
      await job(cancelled, "cancelled");
      assert.equal((await call("project_get")).result.objects.length, 0);
      const imported = await job(
        await mutate("project_import", {
          artifactId: upload.artifactId,
          unit: "mm",
          placeAtOrigin: false,
        }),
      );
      const mcpId = imported.result.entityId;
      assert.deepEqual(
        normalize(await digest(mcpId)),
        expected,
        `${name}: MCP source buffers`,
      );
      await call("artifact_delete", { artifactId: upload.artifactId });
      await mutate("history_undo", {});
      assert.equal((await call("project_get")).result.objects.length, 0);
      await mutate("history_redo", {});
      assert.deepEqual(normalize(await digest(mcpId)), expected);
      // Both paths edit the exact original source slots, then restore all carriers.
      await mutate("object_select", { entityId: mcpId });
      await page
        .getByRole("button", { name: "Edit scan", exact: true })
        .click();
      await mutate("selection_set", {
        entityId: mcpId,
        [extension === "asc" ? "points" : "triangles"]: [0],
      });
      await page.getByText("More selection actions", { exact: true }).click();
      await page
        .getByRole("button", {
          name:
            extension === "asc"
              ? "Delete selected points"
              : "Delete selected triangles",
          exact: true,
        })
        .click();
      const guiEdited = normalize(await digest(mcpId));
      assert.notDeepEqual(guiEdited, expected);
      await mutate("history_undo", {});
      assert.deepEqual(normalize(await digest(mcpId)), expected);
      await mutate("selection_set", {
        entityId: mcpId,
        [extension === "asc" ? "points" : "triangles"]: [0],
      });
      await mutate("selection_edit", { entityId: mcpId, operation: "delete" });
      assert.deepEqual(normalize(await digest(mcpId)), guiEdited);
      await mutate("history_undo", {});
      assert.deepEqual(normalize(await digest(mcpId)), expected);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(
        hash(Buffer.from(await (await openAsBlob(filePath)).arrayBuffer())),
        sourceSha256,
      );
      results.push({
        name,
        sourceSha256,
        bytes: bytes.length,
        buffers: expected,
        guiMcpEqual: true,
        undoRedoEqual: true,
        originalSlotDeleteGuiMcpEqual: true,
        mcpInFlightCancelRecovery: true,
        guiInFlightCancelRecovery: bytes.length > 50 * 1048576,
        oracle:
          extension === "stl"
            ? "retained native topology"
            : extension === "ply"
              ? "independent complete binary PLY source"
              : "every sample against corresponding original PLY with recorded ASC text tolerances",
      });
      console.log(JSON.stringify({ passed: name, buffers: expected.length }));
      await writeFile(
        new URL("original-import-results.json", out),
        JSON.stringify({ results, errors }, null, 2),
      );
    }
  assert.deepEqual(errors, []);
  ledger.result = { passed: true, results, errors };
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("original-import-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
