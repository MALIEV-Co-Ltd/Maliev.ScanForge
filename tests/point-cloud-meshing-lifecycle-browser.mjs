import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { freemem } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5190";
const root = new URL(
  "../docs/evidence/cloudcompare-20261028/",
  import.meta.url,
);
const out = new URL("meshing-continuation/", root);
await mkdir(out, { recursive: true });
assert(
  freemem() > 1536 * 1024 * 1024,
  "Existing 1536MiB browser admission guard",
);
assert(
  (await (await fetch(`${origin}/src/point-cloud-meshing.ts`)).text()).includes(
    "projected-delaunay-2.5d",
  ),
  "Stale development checkout",
);
const token = randomBytes(32).toString("hex"),
  reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let client, transport, browserServer, browser, page;
const evidence = {
  origin,
  browser:
    "Browser plugin unavailable; disposable Playwright Chrome and real public MCP",
  startedAt: new Date().toISOString(),
  passed: false,
  checks: [],
  resourceScope:
    "Worker constructor/terminate/message observer plus actual Playwright Worker close events; real native Worker implementation and unmodified processing results. JS heap snapshots are not aggregate process RSS or a process-memory-cap certificate.",
};
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
  client = new Client({
    name: "projected-meshing-lifecycle-real-scan",
    version: "1",
  });
  await client.connect(transport);
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const workerTargets = [];
  page.on("worker", (worker) => {
    if (!worker.url().includes("processing-worker")) return;
    const target = {
      url: worker.url(),
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    workerTargets.push(target);
    worker.on("close", () => {
      target.closedAt = new Date().toISOString();
    });
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__meshWorkerProbe = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes("processing-worker")) return;
        const record = {
          url: String(url),
          started: performance.now(),
          terminated: null,
          stages: [],
          result: false,
          error: null,
        };
        window.__meshWorkerProbe.push(record);
        this.addEventListener("message", (event) => {
          if (event.data.stage)
            record.stages.push({
              fraction: event.data.progress,
              stage: event.data.stage,
            });
          if (event.data.result) record.result = true;
          if (event.data.error) record.error = event.data.error;
        });
        const terminate = this.terminate.bind(this);
        this.terminate = () => {
          record.terminated = performance.now();
          return terminate();
        };
      }
    };
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  assert.match(await page.title(), /ScanForge/i);
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
    for (let i = 0; i < 1800; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Operation exceeded bounded browser lease");
  };
  const succeeded = async (receipt) => {
    const state = await job(receipt);
    assert.equal(state.status, "succeeded", JSON.stringify(state));
    return state.result;
  };
  const artifact = async (artifactId) => {
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (await call("artifact_read", { artifactId, offset })).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) break;
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    return Buffer.concat(chunks);
  };
  const geometry = async (entityId) => {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    const data = await artifact(object.geometry.artifactId);
    await call("artifact_delete", { artifactId: object.geometry.artifactId });
    return JSON.parse(data.toString());
  };
  const sha = (values) =>
    createHash("sha256")
      .update(Buffer.from(Float32Array.from(values).buffer))
      .digest("hex");
  const probe = async () => ({
    ...(await page.evaluate(() => ({
      records: window.__meshWorkerProbe,
      active: window.__meshWorkerProbe.filter(
        (record) => record.terminated === null,
      ).length,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    }))),
    workerTargets: structuredClone(workerTargets),
    activeWorkerTargets: workerTargets.filter((target) => !target.closedAt)
      .length,
  });
  const awaitWorkerClose = async () => {
    for (let i = 0; i < 150; i++) {
      if (workerTargets.every((target) => target.closedAt)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error("Processing worker target remained open after terminal job");
  };
  const resetProbe = async () => {
    await awaitWorkerClose();
    await page.evaluate(() => {
      if (window.__meshWorkerProbe.some((record) => record.terminated === null))
        throw Error("Worker still active before reset");
      window.__meshWorkerProbe = [];
    });
    workerTargets.length = 0;
  };
  const load = async (project) => {
    const bytes = Buffer.from(JSON.stringify(project));
    let artifactId;
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      const upload = (
        await call("artifact_put", {
          name: "meshing-gate.json",
          offset,
          base64: bytes
            .subarray(offset, offset + 512 * 1024)
            .toString("base64"),
          ...(artifactId ? { artifactId } : {}),
        })
      ).result;
      artifactId = upload.artifactId;
    }
    await succeeded(
      await mutate("project_import", { artifactId, replace: true }),
    );
    await call("artifact_delete", { artifactId });
    await mutate("object_select", { entityId: "cloud" });
  };
  const project = (positions) => ({
    format: "maliev-scanforge",
    version: 1,
    name: "Meshing lifecycle",
    units: "mm",
    entities: [
      {
        id: "cloud",
        name: "bounded-surface.asc",
        kind: "pointcloud",
        positions,
        visible: true,
        color: "#80ff80",
        opacity: 1,
      },
    ],
  });
  const large = Array.from({ length: 500000 }, (_, i) => {
    const x = (i % 1000) * 0.02 + 0.001 * Math.sin(i * 0.43),
      y = Math.floor(i / 1000) * 0.02 + 0.001 * Math.cos(i * 0.27);
    return [Math.fround(x), Math.fround(y), Math.fround(0.0002 * x * x)];
  }).flat();
  const sourceSha = sha(large);
  await load(project(large));
  await resetProbe();
  const before = await call("project_get");
  evidence.cancellations = [];
  for (let run = 0; run < 3; run++) {
    const args = {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 0.1 },
      expectedRevision: before.revision,
      requestId: randomUUID(),
    };
    const receipt = await call("mesh_process", args);
    await page.waitForFunction(
      () =>
        window.__meshWorkerProbe.some(
          (record) =>
            record.terminated === null &&
            record.stages.some(
              (step) => step.stage === "Triangulating projected surface",
            ),
        ),
      null,
      { timeout: 30000 },
    );
    const observed = await call("job_get", { jobId: receipt.result.jobId });
    assert.equal(observed.result.status, "running");
    await call("job_cancel", { jobId: receipt.result.jobId });
    const terminal = await job(receipt);
    assert.equal(terminal.status, "cancelled", JSON.stringify(terminal));
    const after = await call("project_get");
    assert.equal(after.revision, before.revision);
    assert.equal(after.result.undo, before.result.undo);
    assert.equal(after.result.objects.length, 1);
    await awaitWorkerClose();
    const afterProbe = await probe();
    assert.equal(afterProbe.active, 0);
    assert.equal(afterProbe.activeWorkerTargets, 0);
    assert.equal(afterProbe.workerTargets.length, run + 1);
    assert.equal(afterProbe.records.length, run + 1);
    assert(!afterProbe.records.at(-1).result);
    const retry = await call("mesh_process", args);
    assert.equal(retry.result.jobId, receipt.result.jobId);
    assert.equal((await job(retry)).status, "cancelled");
    assert.equal((await probe()).records.length, run + 1);
    evidence.cancellations.push({
      run: run + 1,
      observedStage: observed.result.stage,
      terminalStatus: terminal.status,
      unchangedRevision: after.revision,
      undo: after.result.undo,
      probe: afterProbe,
      retryRetainedSameJob: true,
    });
  }
  assert.equal(sha((await geometry("cloud")).positions), sourceSha);
  evidence.checks.push(
    "Three cancellations observed inside a real triangulating processing worker",
    "No cancelled mesh/history/revision or source-coordinate change",
    "Exact request retries return cancelled receipt without launching another worker",
  );
  const maxResult = await succeeded(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 0.1 },
    }),
  );
  await awaitWorkerClose();
  assert.equal(maxResult.diagnostics.sourcePoints, 500000);
  assert(maxResult.diagnostics.triangles > 900000);
  assert.equal((await probe()).active, 0);
  const maxState = await call("project_get");
  assert.equal(maxState.result.objects.length, 2);
  assert.equal(maxState.result.undo, before.result.undo + 1);
  await mutate("history_undo");
  assert.equal((await call("project_get")).result.objects.length, 1);
  assert.equal(sha((await geometry("cloud")).positions), sourceSha);
  evidence.maximumAccepted = {
    diagnostics: maxResult.diagnostics,
    probe: await probe(),
    sourcePositionsSha256: sourceSha,
  };
  evidence.checks.push(
    "500000-point successor succeeds after cancellation, worker terminates, Undo restores source",
  );
  await load(project([...large, 25, 25, 0]));
  await resetProbe();
  const capBefore = await call("project_get");
  const capFailure = await job(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xy" },
    }),
  );
  assert.equal(capFailure.status, "failed");
  assert.match(capFailure.error.message, /500,000/);
  const capAfter = await call("project_get");
  assert.equal(capAfter.revision, capBefore.revision);
  assert.equal(capAfter.result.undo, capBefore.result.undo);
  assert.equal(capAfter.result.objects.length, 1);
  assert.equal((await probe()).records.length, 0);
  evidence.overLimit = {
    points: 500001,
    error: capFailure.error,
    probe: await probe(),
    unchangedRevision: capAfter.revision,
    undo: capAfter.result.undo,
  };
  evidence.checks.push(
    "500001 points rejected before worker construction without mutation",
  );
  const realProject = JSON.parse(
      await readFile(
        new URL(
          "fixtures/projected-meshing-real/owner-surface-project.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    manifest = JSON.parse(
      await readFile(
        new URL(
          "fixtures/projected-meshing-real/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  await load(realProject);
  await resetProbe();
  await mutate("viewport_control", { action: "fit" });
  const realBefore = await call("project_get"),
    realSource = await geometry("cloud");
  assert.equal(sha(realSource.positions), manifest.positionsFloat32Sha256);
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.getByText("Mesh a projected surface", { exact: true }).click();
  await page
    .getByRole("button", { name: "Meshing projection plane", exact: true })
    .click();
  await page
    .getByRole("option", { name: "XZ (height Y)", exact: true })
    .click();
  await page
    .getByLabel("Maximum mesh edge (mm)", { exact: true })
    .fill(String(manifest.maxEdgeLengthMm));
  await page
    .getByRole("button", { name: "Create projected mesh", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: fileURLToPath(new URL("real-surface-gui-controls.png", out)),
  });
  await page
    .getByRole("button", { name: "Create projected mesh", exact: true })
    .click();
  for (let i = 0; i < 300; i++) {
    if ((await call("project_get")).result.objects.length === 2) break;
    if (i === 299) throw Error(await page.locator("body").innerText());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const realAfter = (await call("project_get")).result;
  assert.equal(realAfter.undo, realBefore.result.undo + 1);
  const guiId = realAfter.objects.find((object) => object.id !== "cloud").id,
    gui = await geometry(guiId);
  assert.deepEqual(await geometry("cloud"), realSource);
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    `Created ${gui.positions.length / 9} projected triangles; source cloud preserved.`,
    { timeout: 5000 },
  );
  evidence.checks.push(
    "Successful GUI mesh reports success after selecting its new output, not cancellation",
  );
  await page.screenshot({
    path: fileURLToPath(new URL("real-surface-gui-mesh.png", out)),
  });
  await mutate("history_undo");
  assert.equal((await call("project_get")).result.objects.length, 1);
  await mutate("history_redo");
  const meshGeometry = (geometry) => ({
    positions: geometry.positions,
    vertices: geometry.indexedMesh.vertices,
    triangles: geometry.indexedMesh.triangles,
  });
  assert.deepEqual(meshGeometry(await geometry(guiId)), meshGeometry(gui));
  await mutate("history_undo");
  const realMcp = await succeeded(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: {
        kind: "pointCloudMesh",
        plane: manifest.projectionPlane,
        maxEdgeLength: manifest.maxEdgeLengthMm,
      },
    }),
  );
  assert.deepEqual(
    meshGeometry(await geometry(realMcp.entityIds[0])),
    meshGeometry(gui),
  );
  assert.deepEqual(await geometry("cloud"), realSource);
  assert.equal((await probe()).active, 0);
  await awaitWorkerClose();
  assert.equal((await probe()).activeWorkerTargets, 0);
  await writeFile(
    new URL("real-surface-mesh-geometry.json", out),
    JSON.stringify(gui) + "\n",
  );
  await writeFile(
    new URL("real-surface-cloud-geometry.json", out),
    JSON.stringify(realSource) + "\n",
  );
  evidence.realSurface = {
    manifest: "../real-surface/manifest.json",
    diagnostics: realMcp.diagnostics,
    sourcePositionsSha256: sha(realSource.positions),
    probe: await probe(),
  };
  evidence.checks.push(
    "Real ASC deterministic surface patch GUI/public-MCP coordinate+topology parity",
    "Real source positions/normals preserved, single history step and exact Undo/Redo",
  );
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  evidence.passed = true;
} catch (error) {
  evidence.error = error.message;
  if (page)
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
      .catch(() => {});
  throw error;
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    new URL("evidence.json", out),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
}
