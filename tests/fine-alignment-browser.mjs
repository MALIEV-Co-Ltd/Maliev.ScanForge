import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
let transport, client, browserServer, browser;
const timeout = setTimeout(() => void browserServer?.close(), 180000);
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
  const points = Array.from({ length: 400 }, (_, i) => [
    i % 20,
    Math.floor(i / 20),
    0,
  ]).flat();
  const cloud = (id, positions) => ({
    id,
    name: id + ".asc",
    kind: "pointcloud",
    positions,
    visible: true,
    color: id === "moving" ? "#80ff80" : "#eeeeee",
    opacity: 1,
  });
  const load = async (noisy = false, precision = false, partial = false) => {
    const moving = points.map((v, i) =>
      i % 3 === 2 ? (noisy ? (Math.floor(i / 3) % 2 ? 1 : -1) : 0.1) : v,
    );
    const actualMoving = precision
      ? points.map((v) => v + 1e6)
      : partial
        ? [...moving, ...points.map((v, i) => (i % 3 === 2 ? 100.1 : v))]
        : moving;
    const actualTarget = precision
      ? points.map(
          (v, i) =>
            v +
            1e6 +
            (i % 3 === 2 &&
            ((Math.floor(i / 3) % 20) + Math.floor(i / 60)) % 4 === 0
              ? 0.0625
              : 0),
        )
      : points;
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Fine alignment parity",
      units: "mm",
      entities: [cloud("moving", actualMoving), cloud("fixed", actualTarget)],
    };
    const upload = (
      await call("artifact_put", {
        name: "fine.json",
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
    await mutate("object_select", { entityId: "moving" });
  };
  const geometry = async () => {
    const object = (
      await call("object_get", { entityId: "moving", includeGeometry: true })
    ).result;
    const part = (
      await call("artifact_read", {
        artifactId: object.geometry.artifactId,
        offset: 0,
      })
    ).result;
    assert(part.eof);
    return JSON.parse(Buffer.from(part.base64, "base64").toString()).positions;
  };
  const openFine = async (overlap = 50, samples = 73) => {
    await mutate("command_run", { name: "ribbon:fineAlign" });
    await page
      .getByRole("button", { name: "Registration target", exact: true })
      .click();
    await page.getByRole("option", { name: "fixed.asc", exact: true }).click();
    await page
      .getByLabel("Target overlap RMS (mm)", { exact: true })
      .fill("0.02");
    await page
      .getByLabel("Expected overlap (%)", { exact: true })
      .fill(String(overlap));
    const slider = page.getByRole("slider", {
      name: "Fitting sample count",
      exact: true,
    });
    await slider.press("Home");
    for (let value = 3; value < samples; value++)
      await slider.press("ArrowRight");
    assert.equal(await slider.inputValue(), String(samples));
    await slider.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, "fitting-sample-slider.png") });
  };
  await load(false, false, true);
  await openFine();
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  const result = page.getByRole("status", {
    name: "Mesh operation result",
    exact: true,
  });
  await result.getByText(/Target accuracy reached/).waitFor();
  const guiResult = await result.innerText();
  assert.match(guiResult, /Target\s+0\.02 mm/);
  const guiGeometry = await geometry();
  await result
    .getByRole("heading", { name: "Result", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "target-reached.png") });
  await mutate("history_undo");
  const operation = {
    kind: "icp",
    targetRms: 0.02,
    sampleSize: 73,
    targetSampleSize: 3,
    maxDistance: 10,
    maxIterations: 200,
    tolerance: 0.00001,
    overlapPercent: 50,
  };
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation,
    }),
  );
  assert.equal(mcp.registration.terminationReason, "targetReached");
  assert.equal(mcp.registration.evaluatedPoints, 800);
  assert.equal(mcp.registration.targetPoints, 400);
  assert(mcp.registration.overlapRms < 0.000001);
  assert(mcp.registration.wholeCloudRms > 50);
  assert.equal(mcp.registration.overlapPercent, 50);
  assert.equal(mcp.registration.sampleSize, 73);
  assert.equal(mcp.registration.fittingSamples, 73);
  assert.equal(mcp.registration.overlapPoints, 400);
  assert.equal(mcp.registration.targetRmsBasis, "overlap");
  assert.deepEqual(await geometry(), guiGeometry);
  await mutate("history_undo");
  await mutate("history_redo");
  assert.deepEqual(await geometry(), guiGeometry);
  await load(true);
  await openFine(100, 400);
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  await result
    .getByText(/Stopped improving; target accuracy not reached/)
    .waitFor();
  await result
    .getByRole("heading", { name: "Result", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "stopped-improving.png") });
  await mutate("history_undo");
  const plateau = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 100, sampleSize: 400 },
    }),
  );
  assert.equal(plateau.registration.terminationReason, "stoppedImproving");
  assert.equal(plateau.registration.targetReached, false);
  assert(plateau.registration.rms > 0.9);
  await load(false, false, true);
  await openFine(80, 73);
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  await result
    .getByRole("alert")
    .getByText(/Insufficient overlap within the search distance/)
    .waitFor();
  await result
    .getByRole("heading", { name: "Result", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "insufficient-overlap.png") });
  await mutate("history_undo");
  const insufficient = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 80 },
    }),
  );
  assert.equal(insufficient.registration.overlapSatisfied, false);
  assert.equal(insufficient.registration.targetReached, false);
  assert.equal(insufficient.registration.overlapPoints, 400);
  assert.equal(insufficient.registration.requiredOverlapPoints, 640);
  await load(false, true);
  const precisionRuns = [];
  for (let run = 0; run < 2; run++) {
    const measured = await job(
      await mutate("mesh_process", {
        entityId: "moving",
        targetId: "fixed",
        operation: {
          ...operation,
          targetRms: 0.03,
          overlapPercent: 100,
          sampleSize: 400,
        },
      }),
    );
    const stored = await geometry();
    const fixed = points.map(
      (v, i) =>
        v +
        1e6 +
        (i % 3 === 2 &&
        ((Math.floor(i / 3) % 20) + Math.floor(i / 60)) % 4 === 0
          ? 0.0625
          : 0),
    );
    let sum = 0;
    for (let i = 0; i < stored.length; i += 3) {
      let d = Infinity;
      for (let j = 0; j < fixed.length; j += 3)
        d = Math.min(
          d,
          (stored[i] - fixed[j]) ** 2 +
            (stored[i + 1] - fixed[j + 1]) ** 2 +
            (stored[i + 2] - fixed[j + 2]) ** 2,
        );
      sum += d;
    }
    const actualRms = Math.sqrt(sum / 400);
    assert(Math.abs(measured.registration.rms - actualRms) < 1e-12);
    assert.equal(measured.registration.targetReached, actualRms <= 0.03);
    precisionRuns.push({ actualRms, registration: measured.registration });
  }
  const meshVertices = points.slice();
  const triangles = [];
  for (let y = 0; y < 19; y++)
    for (let x = 0; x < 19; x++) {
      const a = x + y * 20;
      triangles.push(a, a + 1, a + 20, a + 1, a + 21, a + 20);
    }
  const meshPositions = triangles.flatMap((id) =>
    meshVertices.slice(id * 3, id * 3 + 3),
  );
  const meshProject = {
    format: "maliev-scanforge",
    version: 1,
    name: "Indexed target parity",
    units: "mm",
    entities: [
      {
        ...cloud(
          "moving",
          meshPositions.map((v, i) => v + (i % 3 === 2 ? 0.1 : 0)),
        ),
        kind: "mesh",
      },
      {
        ...cloud("fixed", meshPositions),
        kind: "mesh",
        indexedMesh: {
          vertices: [...meshVertices, 0, 0, 0.1],
          triangles,
        },
      },
    ],
  };
  const meshUpload = (
    await call("artifact_put", {
      name: "indexed-target.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(meshProject)).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: meshUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "moving" });
  await openFine(100, 73);
  await page
    .getByRole("button", { name: "Fine align with dense ICP", exact: true })
    .click();
  await result.getByText(/Target accuracy reached/).waitFor();
  const guiMesh = await geometry();
  await page.screenshot({ path: join(out, "indexed-mesh-target.png") });
  await mutate("history_undo");
  const meshRun = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 100 },
    }),
  );
  assert.equal(
    meshRun.registration.targetPoints,
    400,
    "Complete referenced target points, no unused ghost vertex or repeated corners",
  );
  assert.equal(meshRun.registration.evaluatedPoints, triangles.length);
  assert(meshRun.registration.distanceTests > 0);
  assert.deepEqual(await geometry(), guiMesh);
  await mutate("history_undo");
  await mutate("history_redo");
  assert.deepEqual(await geometry(), guiMesh);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    origin,
    browser: "Browser plugin not available; isolated Playwright Chrome",
    guiResult,
    mcp: mcp.registration,
    plateau: plateau.registration,
    insufficient: insufficient.registration,
    precisionRuns,
    indexedMesh: meshRun.registration,
    errors,
    checks: [
      "GUI target editing",
      "real worker",
      "full target despite targetSampleSize:3",
      "all-source RMS",
      "GUI/MCP identical geometry",
      "target and plateau status",
      "Undo/Redo",
    ],
  };
  await writeFile(
    join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, out }));
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
}
