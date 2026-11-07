import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_UNROLL_OUTPUT
    ? new URL(process.env.SCANFORGE_UNROLL_OUTPUT)
    : new URL("../.resources/scan-unroll-browser/", import.meta.url);
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
    owner: "scan-unroll-browser",
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
        builtRoot,
      );
      if (!file.href.startsWith(builtRoot.href)) throw Error("Invalid path");
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
    new URL("scan-unroll-browser-ledger.json", out),
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
    window.__unrollRequests = [];
    window.__unrollStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__unrollStages.push(e.data.stage);
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
        if (this.processing) window.__unrollRequests.push(data.kind);
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

  const artifactBytes = async (artifact) => {
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
    return Buffer.concat(chunks);
  };
  const artifactJson = async (artifact) =>
    JSON.parse((await artifactBytes(artifact)).toString());

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
  const observed = JSON.parse(
    await readFile(
      new URL("./fixtures/unroll-observed-cylinder.json", import.meta.url),
      "utf8",
    ),
  );
  const sourceBits = Buffer.from(new Float32Array(observed.source).buffer);
  assert.equal(
    createHash("sha256").update(sourceBits).digest("hex"),
    "d4997b7678deb95c9540cd45414f86927063b5ea88ee5bebb479f25bacc73c2c",
  );
  const first = mesh("source", "Cylinder scan", observed.source);
  const base = first;
  let reference;
  const inputs = [first];
  const upload = (
    await call("artifact_put", {
      name: "unroll.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Unroll parity",
          units: "mm",
          entities: inputs,
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
  // Same cylindrical side used in the native seam-tangent discrimination run.
  const referenceBytes = await readFile(
    new URL("./fixtures/unroll-reference-frame90.step", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(referenceBytes).digest("hex"),
    "6abeecf9c9b322687d334199654aba14c7adeb4851ddfaf369cfa6c00871c52f",
  );
  const referenceUpload = (
    await call("artifact_put", {
      name: "reference-cylinder-frame90.step",
      offset: 0,
      base64: referenceBytes.toString("base64"),
    })
  ).result;
  const cylinder = await job(
    await mutate("project_import", {
      artifactId: referenceUpload.artifactId,
      unit: "mm",
    }),
  );
  const cylinderId = cylinder.result.entityId;
  await mutate("object_update", {
    entityId: cylinderId,
    patch: { name: "Cylinder reference" },
  });
  reference = mesh(
    cylinderId,
    "Cylinder reference",
    (await geometry(cylinderId)).positions,
  );
  inputs.push(reference);
  const unrelated = await mutate("sketch_manage", {
    action: "create",
    name: "Keep unrelated",
    sketch: {
      version: 1,
      points: [{ id: "keep", x: 7, y: 9 }],
      segments: [],
      constraints: [],
    },
  });
  const unrelatedId = unrelated.result.sketchId;
  await mutate("object_select", { entityId: first.id });
  const beforeHistory = await history();
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Unroll", exact: true }).click();
  const panel = page.getByRole("region", { name: "Unroll", exact: true });
  await panel.waitFor();
  console.log("PANEL", await panel.innerText());
  await page.screenshot({
    path: fileURLToPath(new URL("before-unroll.png", out)),
  });
  await panel.locator("button[aria-haspopup='listbox']").click();
  await page
    .getByRole("option", { name: "Cylinder reference", exact: true })
    .click();
  await panel.getByLabel("Instances", { exact: true }).fill("2");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  for (
    let i = 0;
    i < 150 && (await call("project_get")).result.objects.length !== 4;
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  const guiProject = (await call("project_get")).result;
  assert.equal(guiProject.objects.length, 4);
  const guiId = guiProject.objects.find(
    (o) => o.kind === "mesh" && !inputs.some((input) => input.id === o.id),
  ).id;
  const guiFrame = guiProject.objects.find(
    (row) => row.kind === "referenceFrame",
  );
  assert.equal(guiFrame.visible, false);
  assert.equal(guiFrame.rollMapping.radius, 2);
  assert.equal(guiFrame.rollMapping.meshEntityId, guiId);
  const guiSketchId = guiFrame.rollMapping.sketchId;
  const savedSketches = async () => (await call("sketch_get")).result;
  const guiSketch = (await savedSketches()).sketches.find(
    (row) => row.id === guiSketchId,
  );
  assert.equal(guiSketch.visible, true);
  assert.equal((await savedSketches()).activeSketchId, unrelatedId);
  assert.deepEqual(
    guiSketch.sketch.points.map((row) => row.x),
    [4 * Math.PI, 4 * Math.PI],
  );
  await page.getByRole("button", { name: "Hide Sketch", exact: true }).click();
  assert.equal(
    (await savedSketches()).sketches.find((row) => row.id === guiSketchId)
      .visible,
    false,
  );
  await mutate("sketch_manage", {
    action: "visibility",
    sketchId: guiSketchId,
    visible: true,
  });
  await mutate("sketch_set", {
    sketch: {
      version: 1,
      points: [{ id: "keep", x: 17, y: 29 }],
      segments: [],
      constraints: [],
    },
  });
  const guiGeometry = await geometry(guiId),
    gui = guiGeometry.positions;
  const expected = observed.cases.find((c) => c.instances === 2).positions;
  assert.equal(gui.length, expected.length);
  for (let i = 0; i < gui.length; i++) {
    if (i % 3 === 1) assert(Math.abs(gui[i] - expected[i]) < 1e-12);
    else assert.equal(gui[i], expected[i]);
  }
  for (const input of inputs)
    assert.deepEqual((await geometry(input.id)).positions, input.positions);
  assert.equal(await history(), beforeHistory + 1);
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 2);
  assert.deepEqual(
    (await savedSketches()).sketches.map((row) => row.id),
    [unrelatedId],
  );
  assert.equal((await savedSketches()).sketches[0].sketch.points[0].x, 17);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry(guiId)).positions, gui);
  assert.equal(
    (await savedSketches()).sketches.find((row) => row.id === guiSketchId)
      .visible,
    true,
  );
  await mutate("history_undo", {});
  const request = {
    entityId: first.id,
    operation: {
      kind: "scanTools",
      operation: {
        kind: "unroll",
        cylinderId: reference.id,
        instances: 2,
      },
    },
  };
  const revision = (await call("project_get")).revision,
    requestId = randomUUID();
  const receipt = await call("mesh_process", {
    ...request,
    expectedRevision: revision,
    requestId,
  });
  const replay = await job(receipt);
  assert.equal(replay.result.unroll.cylinderEntityId, reference.id);
  assert.equal(replay.result.unroll.referenceKind, "exact-cad");
  assert.equal(replay.result.unroll.radius, 2);
  assert.deepEqual(
    await call("mesh_process", {
      ...request,
      expectedRevision: revision,
      requestId,
    }),
    receipt,
  );
  const resultId = replay.result.entityIds[0];
  assert.deepEqual((await geometry(resultId)).positions, gui);
  assert.deepEqual(
    replay.result.unroll.coordinateFrame,
    guiFrame.coordinateFrame,
  );
  assert.equal(
    (await savedSketches()).sketches.find(
      (row) => row.id === replay.result.unroll.sketchId,
    ).visible,
    true,
  );
  assert.equal(await history(), beforeHistory + 1);
  for (const input of inputs)
    assert.deepEqual((await geometry(input.id)).positions, input.positions);
  await mutate("history_undo", {});
  await page.evaluate(() => {
    window.__pendingResult = null;
    window.__holdResult = true;
  });
  const cancelled = await mutate("mesh_process", request);
  await page.waitForFunction(() => !!window.__pendingResult);
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__pendingResult = null;
    window.__holdResult = false;
  });
  assert.equal((await call("project_get")).result.objects.length, 2);
  assert.deepEqual(
    (await savedSketches()).sketches.map((row) => row.id),
    [unrelatedId],
  );
  assert.equal(await history(), beforeHistory);
  const failed = await job(
    await mutate("mesh_process", {
      ...request,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "unroll",
          center: [0, 0, 0],
          axis: [0, 0, 1],
          radius: 1e40,
          instances: 2,
        },
      },
    }),
    "failed",
  );
  assert.match(JSON.stringify(failed.error), /Float32/);
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
  assert.deepEqual((await geometry(finalId)).positions, gui);
  assert.deepEqual(
    (await geometry(finalId)).indexedMesh,
    guiGeometry.indexedMesh,
  );
  // Exact CAD is retessellated on reopen; its display doubles can change at
  // machine precision. Authored scan buffers and accepted output stay exact.
  assert.deepEqual((await geometry(first.id)).positions, first.positions);
  const reopenedReference = (
    await call("object_get", { entityId: reference.id })
  ).result;
  assert.equal(reopenedReference.exactCad, true);
  assert.equal(reopenedReference.hasBrep, true);
  const finalFrameId = final.result.unroll.frameEntityId,
    finalSketchId = final.result.unroll.sketchId;
  assert.deepEqual(
    (await call("object_get", { entityId: finalFrameId })).result.rollMapping,
    final.result.unroll.mapping,
  );
  await mutate("history_seek", { index: beforeHistory });
  assert.equal((await call("project_get")).result.objects.length, 2);
  assert.deepEqual(
    (await savedSketches()).sketches.map((row) => row.id),
    [unrelatedId],
  );
  assert.equal((await savedSketches()).sketches[0].sketch.points[0].x, 17);
  await mutate("history_seek", { index: beforeHistory + 1 });
  assert.equal(
    (await savedSketches()).sketches.find((row) => row.id === finalSketchId)
      .visible,
    true,
  );
  assert.deepEqual((await geometry(finalId)).positions, gui);
  // Rebind the cylinder through the GUI after exact CAD restoration, then rerun.
  const restoredIds = new Set(
    (await call("project_get")).result.objects.map((o) => o.id),
  );
  await mutate("object_select", { entityId: first.id });
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Unroll", exact: true }).click();
  await panel.waitFor();
  await panel.locator("button[aria-haspopup='listbox']").click();
  await page
    .getByRole("option", { name: "Cylinder reference", exact: true })
    .click();
  await panel.getByLabel("Instances", { exact: true }).fill("2");
  await panel.getByLabel("Angular offset (degrees)", { exact: true }).fill("0");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  let restoredOutput;
  for (let i = 0; i < 150; i++) {
    restoredOutput = (await call("project_get")).result.objects.find(
      (o) => o.kind === "mesh" && !restoredIds.has(o.id),
    );
    if (restoredOutput) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(restoredOutput, "Unroll must execute after CAD reopen");
  const restoredPositions = (await geometry(restoredOutput.id)).positions;
  assert.equal(restoredPositions.length, gui.length);
  for (let i = 0; i < gui.length; i++) {
    if (i % 3 === 1) assert(Math.abs(restoredPositions[i] - gui[i]) < 1e-12);
    else assert.equal(restoredPositions[i], gui[i]);
  }
  await mutate("history_undo", {});

  // Compare the same zero-offset, one-turn auxiliary records captured natively.
  const nativeFrame = JSON.parse(
    await readFile(
      new URL("./fixtures/unroll-native-roll-frame.json", import.meta.url),
      "utf8",
    ),
  );
  const nativeControl = JSON.parse(
    await readFile(
      new URL(
        "../docs/evidence/m2-unroll-frame-control-20261026.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(nativeControl.settings, {
    offsetDegrees: 0,
    instances: 1,
    radius: 2,
    center: [0, 0, 0],
    axis: [0, 0, 1],
    importedSurfaceSeamTangent: [0, 1, 0],
  });
  assert.equal(
    nativeControl.files["source-cylinder.stl"],
    "99bd87ca47cc4d09da5cd59c4765f080cc7ab41f70503a8adc64308f4279575e",
  );
  assert.equal(
    nativeControl.files["reference-cylinder-frame90.step"],
    "e6665a64a82901930d593fbc74054da999d5ae88ff9fbe0485d08bb89fb164c7",
  );
  assert.equal(
    nativeControl.files["native-frame90-auxiliary-sketch.iges"],
    "27de9da740ba86571c283b1dea441280ce550edfb313efc7185917ce1999467b",
  );
  const matrix = Buffer.from(nativeFrame.matrixBytesHex, "hex");
  assert.equal(
    createHash("sha256").update(matrix).digest("hex"),
    nativeFrame.matrixBytesSha256,
  );
  assert.equal(
    nativeFrame.sourceSha256,
    nativeControl.files["native-frame90-unroll0.qsf"],
  );
  assert.deepEqual(nativeFrame.settings, {
    center: [0, 0, 0],
    axis: [0, 0, 1],
    radius: 2,
    offsetDegrees: 0,
    instances: 1,
  });
  const nativeCase = observed.cases.find(
    (c) => c.offsetDegrees === 0 && c.instances === 1,
  );
  assert.equal(
    nativeCase.exportSha256,
    nativeControl.files["native-frame90-unroll0.stl"],
  );
  const expectedMesh = nativeCase.positions;
  const compareNativeAuxiliary = (frame, sketch) => {
    const f = frame.coordinateFrame.frame;
    const columns = [f.u, f.v, f.normal, f.origin];
    let maxFrameDifference = 0,
      maxSketchDifference = 0;
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 4; column++)
        maxFrameDifference = Math.max(
          maxFrameDifference,
          Math.abs(
            columns[column][row] - matrix.readDoubleLE((row * 4 + column) * 8),
          ),
        );
    assert(maxFrameDifference <= 1e-15);
    assert.equal(frame.rollMapping.radius, 2);
    assert.equal(frame.rollMapping.offsetDegrees, 0);
    assert.equal(frame.rollMapping.instances, 1);
    assert.equal(frame.visible, false);
    assert.equal(sketch.visible, true);
    assert.deepEqual(sketch.sketch.frame, {
      origin: [0, 0, 0],
      u: [1, 0, 0],
      v: [0, 1, 0],
      normal: [0, 0, 1],
    });
    assert.equal(sketch.sketch.points.length, 2);
    assert.equal(sketch.sketch.segments.length, 1);
    assert.equal(sketch.sketch.segments[0].a, sketch.sketch.points[0].id);
    assert.equal(sketch.sketch.segments[0].b, sketch.sketch.points[1].id);
    for (const [index, endpoint] of [
      nativeControl.ownership.exportedSketchLine.start,
      nativeControl.ownership.exportedSketchLine.end,
    ].entries()) {
      maxSketchDifference = Math.max(
        maxSketchDifference,
        Math.abs(sketch.sketch.points[index].x - endpoint[0]),
        Math.abs(sketch.sketch.points[index].y - endpoint[1]),
      );
      assert.equal(endpoint[2], 0);
    }
    assert(maxSketchDifference <= 5e-10);
    return { maxFrameDifference, maxSketchDifference };
  };
  const beforeNativeIds = new Set(
    (await call("project_get")).result.objects.map((o) => o.id),
  );
  await mutate("object_select", { entityId: first.id });
  await page.getByRole("button", { name: "Unroll", exact: true }).click();
  await panel.waitFor();
  await panel.locator("button[aria-haspopup='listbox']").click();
  await page
    .getByRole("option", { name: "Cylinder reference", exact: true })
    .click();
  await panel.getByLabel("Instances", { exact: true }).fill("1");
  await panel.getByLabel("Angular offset (degrees)", { exact: true }).fill("0");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  let nativeGuiObjects;
  for (let i = 0; i < 150; i++) {
    nativeGuiObjects = (await call("project_get")).result.objects.filter(
      (o) => !beforeNativeIds.has(o.id),
    );
    if (nativeGuiObjects.length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const nativeGuiMesh = nativeGuiObjects.find((o) => o.kind === "mesh");
  const nativeGuiFrame = nativeGuiObjects.find(
    (o) => o.kind === "referenceFrame",
  );
  assert(nativeGuiMesh && nativeGuiFrame);
  const nativeGuiSketch = (await savedSketches()).sketches.find(
    (row) => row.id === nativeGuiFrame.rollMapping.sketchId,
  );
  const nativeGuiAux = compareNativeAuxiliary(nativeGuiFrame, nativeGuiSketch);
  const nativeGuiCoordinates = (await geometry(nativeGuiMesh.id)).positions;
  assert.equal(nativeGuiCoordinates.length, expectedMesh.length);
  for (let i = 0; i < expectedMesh.length; i++)
    assert(Math.abs(nativeGuiCoordinates[i] - expectedMesh[i]) <= 1e-12);
  await mutate("history_undo", {});
  const nativeMcp = await job(
    await mutate("mesh_process", {
      entityId: first.id,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "unroll",
          cylinderId: reference.id,
          offsetDegrees: 0,
          instances: 1,
        },
      },
    }),
  );
  const nativeMcpFrame = (
    await call("object_get", {
      entityId: nativeMcp.result.unroll.frameEntityId,
    })
  ).result;
  const nativeMcpSketch = (await savedSketches()).sketches.find(
    (row) => row.id === nativeMcp.result.unroll.sketchId,
  );
  const nativeMcpAux = compareNativeAuxiliary(nativeMcpFrame, nativeMcpSketch);
  assert.deepEqual(
    nativeMcpFrame.coordinateFrame,
    nativeGuiFrame.coordinateFrame,
  );
  assert.deepEqual(nativeMcpSketch.sketch, nativeGuiSketch.sketch);
  for (const [frame, meshId, sketchId] of [
    [nativeGuiFrame, nativeGuiMesh.id, nativeGuiSketch.id],
    [nativeMcpFrame, nativeMcp.result.entityIds[0], nativeMcpSketch.id],
  ]) {
    assert.equal(frame.rollMapping.sourceEntityId, first.id);
    assert.equal(frame.rollMapping.meshEntityId, meshId);
    assert.equal(frame.rollMapping.sketchId, sketchId);
  }
  assert.deepEqual(
    (await geometry(nativeMcp.result.entityIds[0])).positions,
    nativeGuiCoordinates,
  );
  await mutate("history_undo", {});

  for (const input of inputs)
    await mutate("object_update", {
      entityId: input.id,
      patch: { visible: false },
    });
  await mutate("object_select", { entityId: finalId });
  await mutate("viewport_control", { action: "fit", entityId: finalId });
  await mutate("viewport_control", {
    action: "camera",
    position: [12, 0.5, 35],
    target: [12, 0.5, 0],
    up: [0, 1, 0],
    zoom: 1,
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: fileURLToPath(new URL("unroll.png", out)) });
  // Imported exact bodies can retain valid cap tessellations with center vertices.
  const cappedCreated = await job(
    await mutate("cad_create", {
      name: "Capped seed",
      recipe: {
        kind: "primitive",
        input: {
          kind: "cylinder",
          center: [0, 0, 0],
          axis: [0, 0, 1],
          radius: 2,
          height: 1,
        },
      },
    }),
  );
  const cappedSeedId = cappedCreated.result.entityIds[0];
  const cappedFile = await artifactBytes(
    (await job(await call("project_export", { format: "project" }))).result,
  );
  assert.equal(cappedFile.subarray(0, 8).toString(), "SCANFRG2");
  const manifestLength = cappedFile.readUInt32LE(8);
  const manifest = JSON.parse(
    cappedFile.subarray(16, 16 + manifestLength).toString(),
  );
  const cappedRecord = Object.values(manifest.records).find(
    (row) => row.id === cappedSeedId,
  );
  assert(cappedRecord?.brep);
  const chunk = manifest.chunks[cappedRecord.brep.chunk];
  const raw = cappedFile.subarray(
    16 + manifestLength + chunk.offset,
    16 + manifestLength + chunk.offset + chunk.bytes,
  );
  const brep = (chunk.codec === "gzip" ? gunzipSync(raw) : raw).toString();
  const display = [...first.positions];
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      b = ((i + 1) * Math.PI) / 6;
    display.push(
      0,
      0,
      0,
      2 * Math.cos(b),
      2 * Math.sin(b),
      0,
      2 * Math.cos(a),
      2 * Math.sin(a),
      0,
    );
    display.push(
      0,
      0,
      1,
      2 * Math.cos(a),
      2 * Math.sin(a),
      1,
      2 * Math.cos(b),
      2 * Math.sin(b),
      1,
    );
  }
  const cappedUpload = (
    await call("artifact_put", {
      name: "capped-reference.json",
      offset: 0,
      base64: Buffer.from(
        JSON.stringify({
          format: "maliev-scanforge",
          version: 1,
          name: "Capped reference control",
          units: "mm",
          entities: [
            first,
            {
              ...mesh("capped-reference", "Imported capped cylinder", display),
              kind: "cad",
              brep,
            },
          ],
        }),
      ).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: cappedUpload.artifactId,
      replace: true,
    }),
  );
  const cappedBefore = await geometry("capped-reference");
  assert(
    cappedBefore.positions.some(
      (value, index) =>
        index % 3 === 0 &&
        value === 0 &&
        cappedBefore.positions[index + 1] === 0,
    ),
  );
  await mutate("object_select", { entityId: first.id });
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Unroll", exact: true }).click();
  await panel.waitFor();
  await panel.locator("button[aria-haspopup='listbox']").click();
  await page
    .getByRole("option", { name: "Imported capped cylinder", exact: true })
    .click();
  await panel.getByLabel("Instances", { exact: true }).fill("2");
  await panel.getByLabel("Angular offset (degrees)", { exact: true }).fill("0");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  let cappedOutput;
  for (let i = 0; i < 150; i++) {
    cappedOutput = (await call("project_get")).result.objects.find(
      (o) => o.kind === "mesh" && o.id !== first.id,
    );
    if (cappedOutput) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(cappedOutput, "GUI must accept the capped exact reference");
  const cappedGui = (await geometry(cappedOutput.id)).positions;
  await mutate("history_undo", {});
  const cappedMcp = await job(
    await mutate("mesh_process", {
      entityId: first.id,
      operation: {
        kind: "scanTools",
        operation: {
          kind: "unroll",
          cylinderId: "capped-reference",
          offsetDegrees: 0,
          instances: 2,
        },
      },
    }),
  );
  assert.deepEqual(
    (await geometry(cappedMcp.result.entityIds[0])).positions,
    cappedGui,
  );
  assert.deepEqual(await geometry("capped-reference"), cappedBefore);
  assert.deepEqual((await geometry(first.id)).positions, first.positions);
  await mutate("viewport_control", { action: "fit" });
  await page.screenshot({
    path: fileURLToPath(new URL("unroll-capped.png", out)),
  });
  assert.deepEqual(errors, []);
  ledger.result = {
    guiMcpEqual: true,
    observedExportEqual: true,
    oneTurnNativeFrameAndSketchGuiMcp: { gui: nativeGuiAux, mcp: nativeMcpAux },
    twoInstances: true,
    sourcePreserved: true,
    undoRedo: true,
    retryProtected: true,
    cancellationRollback: true,
    failureRollback: true,
    saveReopen: true,
    visibleSavedSketch: true,
    hiddenTangentRollFrame: true,
    auxiliaryUndoRedoAndSeek: true,
    unrelatedSketchEditsPreserved: true,
    guiMcpSketchVisibility: true,
    rerunAfterCadReopen: true,
    importedReferenceSeamTangent: "+Y",
    cappedExactReferenceGuiMcpEqual: true,
    baseEntityId: base.id,
    referenceEntityIds: [reference.id],
    outputCoordinates: gui,
    pageErrors: [...errors],
  };
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
    new URL("scan-unroll-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
