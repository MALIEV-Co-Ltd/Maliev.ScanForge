import assert from "node:assert/strict";
import http from "node:http";
import { freemem } from "node:os";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Browser plugin unavailable; disposable real Chrome, actual workers and public MCP.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5191";
const out = new URL(
  "../docs/evidence/cloudcompare-20261029/browser/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
assert(
  (await (await fetch(`${origin}/src/point-cloud-poisson.ts`)).text()).includes(
    "meshPointCloudPoisson",
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
  startedAt: new Date().toISOString(),
  passed: false,
  checks: [],
  scope:
    "Actual browser worker/WASM, public MCP and GUI; isolated scene. Worker observers do not alter native results or delay execution.",
};
const deadline = setTimeout(() => void browserServer?.close(), 600000);
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
  client = new Client({ name: "poisson-browser-acceptance", version: "1" });
  await client.connect(transport);
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const workers = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => {
    if (!worker.url().includes("processing-worker")) return;
    const record = {
      id: workers.length + 1,
      url: worker.url(),
      opened: new Date().toISOString(),
      closed: null,
    };
    workers.push(record);
    worker.on("close", () => (record.closed = new Date().toISOString()));
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__poissonProbe = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes("processing-worker")) return;
        const record = {
          id: window.__poissonProbe.length + 1,
          kinds: [],
          stages: [],
          terminated: false,
          result: false,
          error: null,
        };
        window.__poissonProbe.push(record);
        this.addEventListener("message", ({ data }) => {
          if (data.stage) record.stages.push(data.stage);
          if (data.result) record.result = true;
          if (data.error) record.error = data.error;
        });
        const send = this.postMessage.bind(this);
        this.postMessage = (data, ...args) => {
          record.kinds.push(data.kind);
          return send(data, ...args);
        };
        const stop = this.terminate.bind(this);
        this.terminate = () => {
          record.terminated = true;
          return stop();
        };
      }
    };
  });
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
  const raw = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return response.structuredContent ?? JSON.parse(response.content[0].text);
  };
  const call = async (name, args = {}) => {
    const result = await raw(name, args);
    assert(result.ok, JSON.stringify(result));
    return result;
  };
  const mutate = async (name, args = {}) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt) => {
    for (let i = 0; i < 3000; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (state.status !== "running") return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Poisson browser test job exceeded five-minute bound");
  };
  const succeeded = async (receipt) => {
    const state = await job(receipt);
    assert.equal(state.status, "succeeded", JSON.stringify(state));
    return state.result;
  };
  const load = async (positions, normals, name = "sphere.asc") => {
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Poisson acceptance",
      units: "mm",
      entities: [
        {
          id: "cloud",
          name,
          kind: "pointcloud",
          positions,
          ...(normals ? { normals } : {}),
          visible: true,
          color: "#80ff80",
          opacity: 1,
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(project));
    let artifactId;
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      const result = (
        await call("artifact_put", {
          name: "poisson-input.json",
          offset,
          base64: bytes
            .subarray(offset, offset + 512 * 1024)
            .toString("base64"),
          ...(artifactId ? { artifactId } : {}),
        })
      ).result;
      artifactId = result.artifactId;
    }
    await succeeded(
      await mutate("project_import", { artifactId, replace: true }),
    );
    await call("artifact_delete", { artifactId });
    await mutate("object_select", { entityId: "cloud" });
    await mutate("viewport_control", { action: "fit" });
  };
  const geometry = async (entityId) => {
    const entity = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (
        await call("artifact_read", {
          artifactId: entity.geometry.artifactId,
          offset,
        })
      ).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) break;
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    await call("artifact_delete", { artifactId: entity.geometry.artifactId });
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const compact = (geometry) => ({
    positions: geometry.positions,
    vertices: geometry.indexedMesh.vertices,
    triangles: geometry.indexedMesh.triangles,
  });
  const fingerprint = (geometry) =>
    createHash("sha256").update(JSON.stringify(geometry)).digest("hex");
  const awaitClose = async () => {
    for (let i = 0; i < 150; i++) {
      const probes = await page.evaluate(() => window.__poissonProbe);
      for (const probe of probes)
        if (workers[probe.id - 1])
          Object.assign(workers[probe.id - 1], {
            requestKinds: probe.kinds,
            terminateObserved: probe.terminated,
          });
      const poisson = probes.filter((probe) =>
        probe.kinds.includes("pointCloudPoisson"),
      );
      if (
        poisson.every(
          (probe) => probe.terminated && workers[probe.id - 1]?.closed,
        )
      ) {
        (evidence.workerClosureChecks ??= []).push({
          poissonIds: poisson.map((probe) => probe.id),
          allPoissonClosed: true,
          otherLiveWorkers: probes
            .filter(
              (probe) =>
                !probe.kinds.includes("pointCloudPoisson") &&
                !workers[probe.id - 1]?.closed,
            )
            .map((probe) => ({ id: probe.id, kinds: probe.kinds })),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    evidence.workers = workers;
    evidence.probes = await page.evaluate(() => window.__poissonProbe);
    throw Error(
      "A Poisson processing worker stayed alive after its job terminated",
    );
  };
  const sphere = (count) => {
    const positions = [],
      normals = [];
    for (let i = 0; i < count; i++) {
      const z = 1 - (2 * (i + 0.5)) / count,
        radius = Math.sqrt(1 - z * z),
        angle = i * Math.PI * (3 - Math.sqrt(5));
      const n = [radius * Math.cos(angle), radius * Math.sin(angle), z];
      positions.push(...n.map((v) => Math.fround(v * 10)));
      normals.push(...n.map(Math.fround));
    }
    return { positions, normals };
  };
  const fixture = sphere(1200);
  if (process.env.SCANFORGE_POISSON_COMPLETION !== "1") {
    await load(fixture.positions, fixture.normals);
    await mutate("object_update", {
      entityId: "cloud",
      patch: { visible: false },
    });
    const hiddenBefore = await call("project_get");
    const hiddenWorkers = await page.evaluate(
      () => window.__poissonProbe.length,
    );
    const hidden = await job(
      await mutate("mesh_process", {
        entityId: "cloud",
        operation: { kind: "pointCloudPoisson" },
      }),
    );
    assert.equal(hidden.status, "failed");
    assert.match(hidden.error.message, /Show the point cloud/);
    assert.equal((await call("project_get")).revision, hiddenBefore.revision);
    assert.equal(
      (await call("project_get")).result.undo,
      hiddenBefore.result.undo,
    );
    assert.equal(
      await page.evaluate(() => window.__poissonProbe.length),
      hiddenWorkers,
    );
    evidence.hiddenObjectAdmission = {
      status: hidden.status,
      noWorkerCreated: true,
      revision: hiddenBefore.revision,
    };
    evidence.checks.push(
      "A hidden whole cloud is refused through public MCP before worker construction without history/revision mutation",
    );
    await load(fixture.positions, fixture.normals);
    const source = await geometry("cloud"),
      before = await call("project_get");
    await mutate("command_run", { name: "ribbon:editScan" });
    await page.getByText("Reconstruct a 3D surface", { exact: true }).click();
    await page
      .getByLabel("Poisson reconstruction depth", { exact: true })
      .fill("8");
    await page
      .getByRole("button", { name: "Create Poisson mesh", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL("poisson-gui-controls.png", out)),
    });
    await page
      .getByRole("button", { name: "Create Poisson mesh", exact: true })
      .click();
    let after;
    for (let i = 0; i < 600; i++) {
      after = await call("project_get");
      if (after.result.objects.length === 2) break;
      if (i === 599)
        throw Error(
          `GUI Poisson mesh did not publish: ${await page.locator("body").innerText()}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(after.result.undo, before.result.undo + 1);
    const guiId = after.result.objects.find(
        (object) => object.id !== "cloud",
      ).id,
      gui = await geometry(guiId);
    await page.waitForFunction(() =>
      document.body.innerText.includes(
        "general 3D Poisson triangles; source cloud preserved",
      ),
    );
    assert.deepEqual(await geometry("cloud"), source);
    await awaitClose();
    await mutate("viewport_control", { action: "fit" });
    await page.screenshot({
      path: fileURLToPath(new URL("poisson-gui-sphere.png", out)),
    });
    await mutate("history_undo");
    assert.equal((await call("project_get")).result.objects.length, 1);
    await mutate("history_redo");
    assert.deepEqual(compact(await geometry(guiId)), compact(gui));
    await mutate("history_undo");
    const operation = {
      kind: "pointCloudPoisson",
      normalMode: "provided",
      depth: 8,
    };
    const mcp = await succeeded(
      await mutate("mesh_process", { entityId: "cloud", operation }),
    );
    assert.deepEqual(compact(await geometry(mcp.entityIds[0])), compact(gui));
    assert.deepEqual(await geometry("cloud"), source);
    await awaitClose();
    evidence.guiMcp = {
      diagnostics: mcp.diagnostics,
      geometrySha256: fingerprint(compact(gui)),
    };
    await writeFile(
      new URL("sphere-public-mcp-geometry.json", out),
      JSON.stringify(gui) + "\n",
    );
    evidence.checks.push(
      "Actual GUI/public-MCP Poisson geometry identical, source preserved, one history step and exact Undo/Redo",
      "Successful GUI reconstruction retains truthful success status and worker closes",
    );
    // Failure cases must leave both revision and history unchanged.
    await mutate("history_undo");
    for (const invalid of [
      { ...operation, densityThreshold: 32 },
      { ...operation, normalMode: "estimate-viewpoint" },
    ]) {
      const previous = await call("project_get");
      const failure = await job(
        await mutate("mesh_process", { entityId: "cloud", operation: invalid }),
      );
      assert.equal(failure.status, "failed");
      const current = await call("project_get");
      assert.equal(current.revision, previous.revision);
      assert.equal(current.result.undo, previous.result.undo);
      await awaitClose();
    }
    await load(fixture.positions, undefined);
    const missingBefore = await call("project_get");
    const missing = await job(
      await mutate("mesh_process", { entityId: "cloud", operation }),
    );
    assert.equal(missing.status, "failed");
    const missingAfter = await call("project_get");
    assert.equal(missingAfter.revision, missingBefore.revision);
    assert.equal(missingAfter.result.undo, missingBefore.result.undo);
    const estimated = await succeeded(
      await mutate("mesh_process", {
        entityId: "cloud",
        operation: { ...operation, normalMode: "estimate-outward" },
      }),
    );
    assert.equal(estimated.diagnostics.sourcePoints, 1200);
    await awaitClose();
    evidence.checks.push(
      "Missing normals and invalid viewpoint fail without publication; explicit outward estimation succeeds",
      "Density trimming entire surface fails without revision/history mutation",
    );
    const larger = sphere(30000);
    await load(larger.positions, larger.normals);
    evidence.cancellations = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await call("project_get"),
        original = fingerprint(await geometry("cloud"));
      const args = {
        entityId: "cloud",
        operation: { ...operation, depth: 10 },
        expectedRevision: previous.revision,
        requestId: randomUUID(),
      };
      const countBefore = workers.length,
        receipt = await call("mesh_process", args);
      await page.waitForFunction((previousWorkerId) => {
        const probe = window.__poissonProbe
          .filter((probe) => probe.kinds.includes("pointCloudPoisson"))
          .at(-1);
        return (
          probe?.id > previousWorkerId &&
          probe.stages.includes("Solving general 3D screened Poisson surface")
        );
      }, countBefore);
      const activeProbe = await page.evaluate(() =>
        window.__poissonProbe
          .filter((probe) => probe.kinds.includes("pointCloudPoisson"))
          .at(-1),
      );
      assert.equal(
        activeProbe.result,
        false,
        "Cancellation must precede native mesh result",
      );
      await call("job_cancel", { jobId: receipt.result.jobId });
      const cancelled = await job(receipt);
      assert.equal(cancelled.status, "cancelled", JSON.stringify(cancelled));
      await awaitClose();
      const current = await call("project_get");
      assert.equal(current.revision, previous.revision);
      assert.equal(current.result.undo, previous.result.undo);
      assert.equal(current.result.objects.length, 1);
      assert.equal(fingerprint(await geometry("cloud")), original);
      assert.equal(
        (await call("mesh_process", args)).result.jobId,
        receipt.result.jobId,
      );
      assert.equal(workers.length, countBefore + 1);
      evidence.cancellations.push({
        attempt,
        workerId: activeProbe.id,
        stagesBeforeCancel: activeProbe.stages,
        resultBeforeCancel: activeProbe.result,
        terminalStatus: cancelled.status,
        revision: current.revision,
        workerClosed: workers
          .filter((worker) =>
            worker.requestKinds?.includes("pointCloudPoisson"),
          )
          .at(-1).closed,
        during: "Solving general 3D screened Poisson surface",
      });
    }
    await load(fixture.positions, fixture.normals);
    await succeeded(
      await mutate("mesh_process", { entityId: "cloud", operation }),
    );
    await awaitClose();
    evidence.checks.push(
      "Three cancellations during actual native solve preserve source/revision/history; retry receipts launch no worker; fresh successor succeeds",
    );
    await load(new Array(500001 * 3).fill(0), new Array(500001 * 3).fill(1));
    const capacityBefore = await call("project_get"),
      workerCount = workers.length;
    const capacity = await job(
      await mutate("mesh_process", { entityId: "cloud", operation }),
    );
    assert.equal(capacity.status, "failed");
    assert.match(capacity.error.message, /500,000/);
    assert.equal(workers.length, workerCount);
    assert.equal((await call("project_get")).revision, capacityBefore.revision);
    evidence.checks.push(
      "500001-point Poisson input rejected before worker construction",
    );
    await load(fixture.positions, fixture.normals);
    await succeeded(
      await mutate("mesh_process", { entityId: "cloud", operation }),
    );
    await awaitClose();
    evidence.checks.push(
      "Clean Poisson successor succeeds after over-capacity rejection",
    );
    evidence.probes = await page.evaluate(() => window.__poissonProbe);
    for (const probe of evidence.probes)
      Object.assign(workers[probe.id - 1], {
        requestKinds: probe.kinds,
        terminateObserved: probe.terminated,
      });
  }
  if (process.env.SCANFORGE_POISSON_REAL !== "0") {
    const sourcePath = "C:/repo/alignment-example-files/ply-1.ply",
      sourceBytes = await readFile(sourcePath);
    const originalMesh = new PLYLoader().parse(
      sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      ),
    );
    const originalPositions = Array.from(
        originalMesh.attributes.position.array,
      ),
      originalNormals = Array.from(originalMesh.attributes.normal.array);
    assert.equal(originalPositions.length / 3, 140113);
    await load(originalPositions, originalNormals, "ply-1.ply");
    const sourceGeometry = await geometry("cloud"),
      sourceFingerprint = fingerprint(sourceGeometry),
      realBefore = await call("project_get");
    assert.deepEqual(sourceGeometry.positions, originalPositions);
    const realOperation = {
      kind: "pointCloudPoisson",
      normalMode: "estimate-provided",
      normalNeighbors: 24,
      depth: 9,
      pointWeight: 2,
      samplesPerNode: 1.5,
      densityThreshold: 7,
    };
    const started = Date.now();
    const realResult = await succeeded(
      await mutate("mesh_process", {
        entityId: "cloud",
        operation: realOperation,
      }),
    );
    await awaitClose();
    assert.equal(realResult.diagnostics.normalOrientationAnchors, 140111);
    assert.equal(realResult.diagnostics.normalInvalidOrientationAnchors, 2);
    const realAfter = await call("project_get");
    assert.equal(realAfter.result.undo, realBefore.result.undo + 1);
    assert.equal(realAfter.result.objects.length, 2);
    const realMeshId = realResult.entityIds[0],
      realGeometry = await geometry(realMeshId),
      indexed = realGeometry.indexedMesh;
    assert(indexed?.vertices.length > 0 && indexed.triangles.length > 0);
    assert.equal(fingerprint(await geometry("cloud")), sourceFingerprint);
    const header = Buffer.from(
      `ply\nformat binary_little_endian 1.0\nelement vertex ${indexed.vertices.length / 3}\nproperty float x\nproperty float y\nproperty float z\nelement face ${indexed.triangles.length / 3}\nproperty list uchar uint vertex_indices\nend_header\n`,
    );
    const payload = Buffer.alloc(
      indexed.vertices.length * 4 + (indexed.triangles.length / 3) * 13,
    );
    let offset = 0;
    for (const v of indexed.vertices) {
      payload.writeFloatLE(v, offset);
      offset += 4;
    }
    for (let i = 0; i < indexed.triangles.length; i += 3) {
      payload[offset++] = 3;
      for (let a = 0; a < 3; a++) {
        payload.writeUInt32LE(indexed.triangles[i + a], offset);
        offset += 4;
      }
    }
    const meshPath = fileURLToPath(new URL("ply-1-public-mcp-mesh.ply", out)),
      qualityPath = fileURLToPath(
        new URL("ply-1-public-mcp-quality.json", out),
      ),
      settingsPath = fileURLToPath(
        new URL("ply-1-public-mcp-settings.json", out),
      );
    await writeFile(meshPath, Buffer.concat([header, payload]));
    await writeFile(settingsPath, JSON.stringify(realOperation, null, 2));
    const referenceBytes = await readFile(
      new URL(
        "../docs/evidence/cloudcompare-20261029/poisson/ply-1-depth9-density7-native-normalized-mesh.ply",
        import.meta.url,
      ),
    );
    const reference = new PLYLoader().parse(
      referenceBytes.buffer.slice(
        referenceBytes.byteOffset,
        referenceBytes.byteOffset + referenceBytes.byteLength,
      ),
    );
    const exactCoordinates =
      reference.attributes.position.array.length === indexed.vertices.length &&
      reference.attributes.position.array.every(
        (v, i) => v === indexed.vertices[i],
      );
    const exactTopology =
      reference.index.array.length === indexed.triangles.length &&
      reference.index.array.every((v, i) => v === indexed.triangles[i]);
    const quality = spawnSync(
      process.execPath,
      [
        "scripts/verify-poisson-quality.mjs",
        "--source",
        sourcePath,
        "--mesh",
        meshPath,
        "--report",
        qualityPath,
        "--settings",
        settingsPath,
        "--acceptance",
        "docs/evidence/cloudcompare-20261029/normals/ply-1-quality-acceptance.json",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    await writeFile(
      new URL("ply-1-public-mcp-quality.log", out),
      `${quality.stdout}\n${quality.stderr}`,
    );
    assert.equal(
      quality.status,
      0,
      `Full public MCP mesh quality failed: ${quality.stderr}`,
    );
    const qualityReceipt = JSON.parse(await readFile(qualityPath, "utf8"));
    assert.equal(
      qualityReceipt.acceptance?.passed,
      true,
      "Independent full-scan gates must actually be evaluated and pass",
    );
    await mutate("history_undo");
    assert.equal((await call("project_get")).result.objects.length, 1);
    assert.equal(fingerprint(await geometry("cloud")), sourceFingerprint);
    await mutate("history_redo");
    assert.equal(
      fingerprint(compact(await geometry(realMeshId))),
      fingerprint(compact(realGeometry)),
    );
    assert.equal(fingerprint(await geometry("cloud")), sourceFingerprint);
    await mutate("object_update", {
      entityId: "cloud",
      patch: { visible: false },
    });
    await mutate("viewport_control", { action: "fit" });
    await page.screenshot({
      path: fileURLToPath(new URL("ply-1-public-mcp-result.png", out)),
    });
    evidence.realScan = {
      sourcePath,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      sourcePoints: 140113,
      sourceGeometrySha256: sourceFingerprint,
      operation: realOperation,
      diagnostics: realResult.diagnostics,
      elapsedIncludingExportAndQualityMs: Date.now() - started,
      vertices: indexed.vertices.length / 3,
      triangles: indexed.triangles.length / 3,
      exactCoordinatesVsNode: exactCoordinates,
      exactTopologyVsNode: exactTopology,
      quality:
        qualityReceipt.acceptance ??
        qualityReceipt.qualityGate ??
        qualityReceipt.accepted ??
        "See separate unchanged-gate quality receipt",
      meshPath,
      qualityPath,
    };
    evidence.checks.push(
      "Full140113-point owner PLY1 reconstructed through public MCP with explicit estimate-provided normals; original source preserved; one new mesh/history and exact Undo/Redo; independent exported-mesh quality gates passed",
    );
    evidence.probes = await page.evaluate(() => window.__poissonProbe);
    for (const probe of evidence.probes)
      Object.assign(workers[probe.id - 1], {
        requestKinds: probe.kinds,
        terminateObserved: probe.terminated,
      });
  }
  if (process.env.SCANFORGE_POISSON_CAPACITY === "1") {
    const freeBefore = freemem();
    assert(
      freeBefore >= 1.5 * 1024 ** 3,
      "Capacity solve requires at least1.5GiBfreeRAM",
    );
    const capacityFixture = sphere(500000);
    await load(
      capacityFixture.positions,
      capacityFixture.normals,
      "sphere-500000.asc",
    );
    const sourceHash = fingerprint(await geometry("cloud")),
      beforeCapacity = await call("project_get"),
      started = Date.now();
    const capacityResult = await succeeded(
      await mutate("mesh_process", {
        entityId: "cloud",
        operation: {
          kind: "pointCloudPoisson",
          normalMode: "provided",
          depth: 8,
        },
      }),
    );
    await awaitClose();
    const afterCapacity = await call("project_get");
    assert.equal(afterCapacity.result.objects.length, 2);
    assert.equal(afterCapacity.result.undo, beforeCapacity.result.undo + 1);
    assert.equal(capacityResult.diagnostics.sourcePoints, 500000);
    assert(capacityResult.diagnostics.triangles > 0);
    assert.equal(fingerprint(await geometry("cloud")), sourceHash);
    evidence.completedCapacity = {
      points: 500000,
      depth: 8,
      elapsedIncludingSourceChecksMs: Date.now() - started,
      freePhysicalBytesBefore: freeBefore,
      diagnostics: capacityResult.diagnostics,
      sourceGeometrySha256: sourceHash,
      sourcePreserved: true,
      oneHistoryStep: true,
      workerClosed: true,
    };
    evidence.checks.push(
      "Completed500000-point depth8publicMCPPoissonsolve preservesfullsource,addsonehistoryentryandclosesworker",
    );
    evidence.probes = await page.evaluate(() => window.__poissonProbe);
    for (const probe of evidence.probes)
      Object.assign(workers[probe.id - 1], {
        requestKinds: probe.kinds,
        terminateObserved: probe.terminated,
      });
  }
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  evidence.workers = workers;
  evidence.passed = true;
} catch (error) {
  evidence.error = error.stack ?? error.message;
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
  throw error;
} finally {
  clearTimeout(deadline);
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
