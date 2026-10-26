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
const out = join(tmpdir(), `scanforge-fine-${randomUUID()}`);
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
  const runs = [];
  for (const index of [0, 1]) {
    const entityId = ids[index],
      targetId = ids[2];
    const operation = {
      kind: "icp",
      targetRms: 0.5,
      overlapPercent: 85,
      maxDistance: 0.5,
      maxIterations: 200,
      sampleSize: 20000,
      targetSampleSize: 3,
      tolerance: 0.00001,
    };
    await mutate("object_select", { entityId });
    await mutate("command_run", { name: "ribbon:fineAlign" });
    await page
      .getByRole("button", { name: "Registration target", exact: true })
      .click();
    await page.getByRole("option", { name: "asc-3.asc", exact: true }).click();
    await page
      .getByLabel("Alignment search distance (mm)", { exact: true })
      .fill("0.5");
    const timelineBefore = (await call("history_get")).result;
    await page
      .getByRole("button", { name: "Fine align with dense ICP", exact: true })
      .click();
    const result = page.getByRole("status", {
      name: "Mesh operation result",
      exact: true,
    });
    const deadline = Date.now() + 180000;
    while (
      !(await result
        .getByRole("heading", { name: "Result", exact: true })
        .isVisible())
    ) {
      const app = (await call("application_inspect")).result;
      if (app.error) throw Error(`Original ASC ${index + 1}: ${app.error}`);
      assert(
        Date.now() < deadline,
        "Original fine result exceeded 180-second observation budget",
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const guiText = await result.innerText();
    const gui = await digest(entityId);
    await page.screenshot({
      path: join(out, `original-asc-${index + 1}-fine.png`),
    });
    await mutate("history_undo");
    assert.deepEqual(
      await digest(entityId),
      before[index],
      "Undo restores every original cloud buffer",
    );
    const afterUndo = (await call("history_get")).result;
    assert.equal(afterUndo.cursor, timelineBefore.cursor);
    const receipt = await mutate("mesh_process", {
      entityId,
      targetId,
      operation,
    });
    const mcp = await job(receipt);
    assert.equal(mcp.registration.evaluatedPoints, expectedCounts[index]);
    assert.equal(mcp.registration.targetPoints, expectedCounts[2]);
    assert.equal(mcp.registration.targetRmsBasis, "overlap");
    assert.equal(mcp.registration.sampleSize, 20000);
    assert.equal(mcp.registration.overlapPercent, 85);
    assert.deepEqual(
      await digest(entityId),
      gui,
      "GUI/MCP complete original-cloud output equality",
    );
    assert.deepEqual(
      await digest(targetId),
      before[2],
      "The fixed original is unchanged",
    );
    await mutate("history_undo");
    assert.deepEqual(await digest(entityId), before[index]);
    await mutate("history_redo");
    assert.deepEqual(await digest(entityId), gui);
    runs.push({
      entityId,
      targetId,
      guiText,
      registration: mcp.registration,
      before: before[index],
      after: gui,
    });
    stage("aligned", {
      name: inputs[index].name,
      registration: mcp.registration,
    });
  }
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    targetAccuracyReached: runs.every((r) => r.registration.targetReached),
    scope:
      "Original-three ASC import and two whole-cloud GUI/public-MCP Fine Align replays; not global/native/controller or reconstruction acceptance",
    inputs,
    runs,
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
