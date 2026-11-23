import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL("../.resources/point-edit/", import.meta.url);
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
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 180000);
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
    new URL("point-edit-browser-ledger.json", out),
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

  const positions = Array.from({ length: 400 }, (_, i) => [
    i % 20,
    Math.floor(i / 20),
    0,
  ]).flat();
  const cloud = {
    id: "cloud",
    name: "scan.asc",
    kind: "pointcloud",
    positions,
    normals: Array.from({ length: 400 }, () => [0, 0, 1]).flat(),
    pointColors: Array.from({ length: 400 }, () => [255, 255, 255, 255]).flat(),
    visible: true,
    color: "#b4bec4",
    opacity: 1,
  };
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Point edit validation",
    units: "mm",
    entities: [cloud],
  };
  const upload = (
    await call("artifact_put", {
      name: "points.json",
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
  await mutate("object_select", { entityId: "cloud" });
  await mutate("command_run", { name: "ribbon:objectColor" });
  await page.getByLabel("Point size (px)", { exact: true }).fill("3");
  await page.getByLabel("Point colors", { exact: true }).selectOption("solid");
  await page.getByLabel("Object color", { exact: true }).fill("#aaff00");
  const displayState = (await call("object_get", { entityId: "cloud" })).result;
  assert.equal(displayState.pointSize, 3);
  assert.equal(displayState.pointColorMode, "solid");
  assert.equal(displayState.color, "#aaff00");
  await mutate("viewport_set", { view: "fit" });
  await page.screenshot({
    path: fileURLToPath(new URL("point-display-green.png", out)),
  });
  await mutate("object_update", {
    entityId: "cloud",
    patch: { pointSize: 1.5, pointColorMode: "source" },
  });
  assert.equal(
    await page.getByLabel("Point size (px)", { exact: true }).inputValue(),
    "1.5",
  );
  assert.equal(
    await page.getByLabel("Point colors", { exact: true }).inputValue(),
    "source",
  );
  await mutate("object_update", {
    entityId: "cloud",
    patch: { pointColorMode: "solid" },
  });
  const geometry = async (id) => {
    const object = (
      await call("object_get", { entityId: id, includeGeometry: true })
    ).result;
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (
        await call("artifact_read", {
          artifactId: object.geometry.artifactId,
          offset,
        })
      ).result;
      const bytes = Buffer.from(part.base64, "base64");
      chunks.push(bytes);
      if (part.eof) break;
      assert(bytes.length > 0);
      offset += bytes.length;
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  await page.getByRole("button", { name: "Edit scan", exact: true }).click();
  assert(
    (await page.locator(".status-details").innerText()).includes("Points: 400"),
  );
  await page
    .getByRole("button", { name: "Select all points", exact: true })
    .click();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      (await call("selection_get", { entityId: "cloud" })).result.count === 400
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await call("selection_get", { entityId: "cloud" })).result.count,
    400,
  );
  await page
    .getByRole("button", { name: "Select by drawing a rectangle", exact: true })
    .click();
  await page.getByRole("button", { name: "Deselect all", exact: true }).click();
  await mutate("viewport_set", { view: "fit" });
  await mutate("viewport_set", { view: "top" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const canvas =
    (await page
      .locator(".viewport canvas")
      .first()
      .boundingBox()
      .catch(() => null)) ??
    (await page.locator("canvas").first().boundingBox());
  assert(canvas);
  await page.mouse.move(
    canvas.x + canvas.width * 0.4,
    canvas.y + canvas.height * 0.25,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width * 0.65,
    canvas.y + canvas.height * 0.7,
    { steps: 8 },
  );
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const painted = (await call("selection_get", { entityId: "cloud" })).result
    .count;
  if (!painted)
    await page.screenshot({
      path: fileURLToPath(new URL("selection-debug.png", out)),
    });
  assert(
    painted > 0 && painted < 400,
    `Rectangle selected ${painted}; ${JSON.stringify(canvas)}; ${JSON.stringify(errors)}`,
  );
  await mutate("selection_set", { entityId: "cloud", points: [0, 1, 2] });
  await page.getByText("More selection actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete selected points", exact: true })
    .click();
  let edited = await geometry("cloud");
  assert.equal(edited.positions.length / 3, 397);
  assert.equal(edited.normals.length, 397 * 3);
  assert(
    (await page.locator(".status-details").innerText()).includes("Points: 397"),
  );
  await page.getByLabel("Apply to selection only", { exact: true }).uncheck();
  await page
    .getByRole("spinbutton", { name: "Target points", exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Reduce point count", exact: true })
    .click();
  for (let i = 0; i < 100; i++) {
    edited = await geometry("cloud");
    if (edited.positions.length / 3 === 100) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(edited.positions.length / 3, 100);
  assert.equal(edited.normals.length, 300);
  await mutate("selection_set", { entityId: "cloud", points: [0] });
  await job(
    await mutate("mesh_process", {
      entityId: "cloud",
      operation: {
        kind: "pointCloudEdit",
        action: "smooth",
        iterations: 3,
        neighborRadius: 5,
        deviation: 0.05,
      },
      selectionOnly: true,
    }),
  );
  const smoothed = await geometry("cloud");
  assert.deepEqual(smoothed.positions.slice(3), edited.positions.slice(3));
  await page.screenshot({
    path: fileURLToPath(new URL("point-edit-browser.png", out)),
  });
  assert.deepEqual(errors, []);
  const mesh = {
    ...cloud,
    id: "mesh",
    kind: "mesh",
    normals: undefined,
    pointColors: undefined,
    positions: [
      0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 30, 0, 0, 40,
      0, 0, 30, 10, 0,
    ],
  };
  const meshUpload = (
    await call("artifact_put", {
      name: "connected.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({ ...project, entities: [mesh] }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: meshUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("selection_set", { entityId: "mesh", triangles: [0] });
  await page.getByRole("button", { name: "Edit scan", exact: true }).click();
  await page
    .getByRole("button", { name: "Select connected objects", exact: true })
    .click();
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await call("selection_get", { entityId: "mesh" })).result.count === 2)
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await call("selection_get", { entityId: "mesh" })).result.count,
    2,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("connected-mesh-browser.png", out)),
  });
  const dense = {
    id: "dense",
    name: "dense.asc",
    kind: "pointcloud",
    visible: true,
    color: "#aaff00",
    opacity: 1,
    positions: Array.from({ length: 10000 }, (_, i) => [
      i % 100,
      Math.floor(i / 100),
      0,
    ]).flat(),
  };
  const denseUpload = (
    await call("artifact_put", {
      name: "dense.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({ ...project, entities: [dense] }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: denseUpload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "dense" });
  await mutate("command_run", { name: "ribbon:objectColor" });
  assert.equal(
    await page.getByLabel("Auto density", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByLabel("Display density", { exact: true }).inputValue(),
    "100",
  );
  await page.getByLabel("Display density", { exact: true }).fill("10");
  assert.equal(
    (await call("object_get", { entityId: "dense" })).result.pointDensity,
    10,
  );
  const pose = (z) =>
    mutate("viewport_control", {
      action: "camera",
      projection: "perspective",
      position: [49.5, 49.5, z],
      target: [49.5, 49.5, 0],
      up: [0, 1, 0],
    });
  await pose(1000);
  const diagnostics = async () =>
    (await call("viewport_get")).result.pointCloudDisplay.find(
      (e) => e.entityId === "dense",
    );
  const farDensity = await diagnostics();
  assert(farDensity.sampleFraction < 0.5, JSON.stringify(farDensity));
  const pixelCount = async (name) => {
    const screenshot = await page
      .locator(".viewport canvas")
      .first()
      .screenshot({ path: fileURLToPath(new URL(name, out)) });
    return page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (
          rgba[i + 1] > 100 &&
          rgba[i + 1] > rgba[i] * 1.3 &&
          rgba[i + 1] > rgba[i + 2] * 1.3
        )
          green++;
      bitmap.close();
      return green;
    }, screenshot.toString("base64"));
  };
  const autoPixels = await pixelCount("point-density-auto.png");
  await page.getByLabel("Auto density", { exact: true }).uncheck();
  assert.equal(
    (await call("object_get", { entityId: "dense" })).result.pointAutoDensity,
    false,
  );
  assert.equal(
    await page.getByLabel("Display density", { exact: true }).isDisabled(),
    true,
  );
  assert.equal((await diagnostics()).sampleFraction, 1);
  const fullPixels = await pixelCount("point-density-full.png");
  assert(
    autoPixels > 0 && autoPixels < fullPixels * 0.8,
    JSON.stringify({ autoPixels, fullPixels }),
  );
  await mutate("object_update", {
    entityId: "dense",
    patch: { pointAutoDensity: true, pointDensity: 100 },
  });
  assert.equal(
    await page.getByLabel("Auto density", { exact: true }).isChecked(),
    true,
  );
  const mediumDensity = await diagnostics();
  assert.equal(mediumDensity.samplingMethod, "stable-sample");
  assert.equal(mediumDensity.cellSizePx, null);
  assert.equal(mediumDensity.maxScreenOffsetPx, 0);
  await pose(150);
  const nearDensity = await diagnostics();
  assert(nearDensity.sampleFraction > mediumDensity.sampleFraction);
  await pose(1000);
  assert.equal(
    (await diagnostics()).sampleFraction,
    mediumDensity.sampleFraction,
  );
  assert.deepEqual((await geometry("dense")).positions, dense.positions);
  const offOrigin = positions.map(
    (value, i) => value + [2000, 1000, -300][i % 3],
  );
  const legacyCloud = {
    ...cloud,
    id: "legacy",
    color: "#ffffff",
    positions: offOrigin,
  };
  const legacyProject = { ...project, entities: [legacyCloud] };
  await page.evaluate(async (legacy) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("scanforge-project-backups", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("backups", "readwrite");
        transaction.objectStore("backups").put({
          id: "off-origin-recovery",
          name: "Legacy cloud",
          savedAt: Date.now(),
          file: new Blob([JSON.stringify(legacy)], {
            type: "application/json",
          }),
        });
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }, legacyProject);
  await mutate("viewport_control", {
    action: "camera",
    position: [100, -100, 100],
    target: [0, 0, 0],
    up: [0, 0, 1],
  });
  await job(
    await mutate("backup_restore", {
      backupId: "off-origin-recovery",
      replace: true,
    }),
  );
  const restoredDisplay = (await call("object_get", { entityId: "legacy" }))
    .result;
  assert.equal(restoredDisplay.color, "#aaff00");
  assert.equal(restoredDisplay.pointColorMode, "solid");
  const assertFramed = async () => {
    const view = (await call("viewport_get")).result;
    const center = view.bounds.min.map(
      (value, i) => (value + view.bounds.max[i]) / 2,
    );
    for (let i = 0; i < 3; i++)
      assert(
        Math.abs(view.target[i] - center[i]) < 0.01,
        JSON.stringify({ target: view.target, center }),
      );
    return { target: view.target, bounds: view.bounds };
  };
  const recoveredCamera = await assertFramed();
  assert((await pixelCount("point-backup-off-origin.png")) > 100);
  await mutate("project_new", { discard: true });
  const input = page.locator('input[type=file][accept*=".stl"]');
  await input.setInputFiles({
    name: "off-origin.asc",
    mimeType: "text/plain",
    buffer: Buffer.from(
      Array.from(
        { length: 400 },
        (_, i) =>
          `${offOrigin[i * 3]} ${offOrigin[i * 3 + 1]} ${offOrigin[i * 3 + 2]} 255 255 255`,
      ).join("\n"),
    ),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator('.status-message[title^="Opened · 1/1 files"]').waitFor();
  const importedProject = (await call("project_get")).result;
  const importedId = importedProject.objects[0].id;
  const importedDisplay = (await call("object_get", { entityId: importedId }))
    .result;
  assert.equal(importedDisplay.color, "#aaff00");
  assert.equal(importedDisplay.pointColorMode, "solid");
  const importedCamera = await assertFramed();
  assert((await pixelCount("point-import-off-origin.png")) > 100);
  const rawUpload = (
    await call("artifact_put", {
      name: "mcp-off-origin.asc",
      offset: 0,
      base64: Buffer.from(
        Array.from(
          { length: 400 },
          (_, i) =>
            `${offOrigin[i * 3]} ${offOrigin[i * 3 + 1]} ${offOrigin[i * 3 + 2]} 255 255 255`,
        ).join("\n"),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: rawUpload.artifactId,
      replace: true,
      unit: "mm",
      ascAttributes: "xyz-rgb",
      placeAtOrigin: false,
    }),
  );
  const mcpImportedId = (await call("project_get")).result.objects[0].id;
  const mcpImportedDisplay = (
    await call("object_get", { entityId: mcpImportedId })
  ).result;
  assert.equal(mcpImportedDisplay.color, importedDisplay.color);
  assert.equal(
    mcpImportedDisplay.pointColorMode,
    importedDisplay.pointColorMode,
  );
  const mcpImportedCamera = await assertFramed();
  assert.deepEqual(mcpImportedCamera, importedCamera);
  let realImport;
  if (process.env.SCANFORGE_POINT_IMPORT_FILE) {
    await mutate("project_new", { discard: true });
    await input.setInputFiles(process.env.SCANFORGE_POINT_IMPORT_FILE);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .locator('.status-message[title^="Opened · 1/1 files"]')
      .waitFor({ timeout: 90000 });
    const realProject = (await call("project_get")).result;
    const realObject = (
      await call("object_get", { entityId: realProject.objects[0].id })
    ).result;
    assert.equal(realObject.color, "#aaff00");
    assert.equal(realObject.pointColorMode, "solid");
    realImport = {
      points: realObject.points,
      camera: await assertFramed(),
      greenPixels: await pixelCount("point-real-asc-import.png"),
    };
    assert(realImport.greenPixels > 100);
    await mutate("viewport_set", { view: "bottom" });
    const bottomView = (await call("viewport_get")).result;
    realImport.adaptiveBottom = {
      display: bottomView.pointCloudDisplay[0],
      greenPixels: await pixelCount("point-real-adaptive-bottom.png"),
    };
    assert(realImport.adaptiveBottom.greenPixels > 100);
  }
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    connectedMeshSelection: true,
    rectangleSelection: painted,
    deletedPoints: 3,
    reducedPoints: 100,
    selectionOnlyMcpSmoothing: true,
    normalsPreserved: true,
    pointDisplayGuiMcpParity: true,
    adaptiveDisplay: {
      autoPixels,
      fullPixels,
      farDensity,
      nearDensity,
      sourcePoints: 10000,
    },
    importRecovery: {
      recoveredCamera,
      importedCamera,
      mcpImportedCamera,
      realImport,
    },
    errors,
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("point-edit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
