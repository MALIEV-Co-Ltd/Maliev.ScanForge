import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL(
    process.env.SCANFORGE_BRIDGE_OUTPUT ??
      (process.env.SCANFORGE_SEMI_TANGENT === "1"
        ? "../.resources/m2-partial-tangent-browser-20261027/"
        : "../.resources/bridge-response-browser/"),
    import.meta.url,
  );
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/`)
  : new URL("dist/", root);
const semiTangent = process.env.SCANFORGE_SEMI_TANGENT === "1";
const semiFlatFixture = JSON.parse(
  await readFile(
    new URL(
      semiTangent
        ? "fixtures/hole-observed-semi-tangent-curved.json"
        : "fixtures/hole-observed-semi-flat-square.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const nativeFlatFixture = JSON.parse(
  await readFile(
    new URL("fixtures/bridge-observed-flat-annulus.json", import.meta.url),
    "utf8",
  ),
);
function orientedFaces(positions) {
  const faces = [];
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map((offset) =>
      [0, 1, 2].map((axis) => positions[i + offset + axis]).join(","),
    );
    faces.push(
      [0, 1, 2]
        .map((offset) =>
          [...vertices.slice(offset), ...vertices.slice(0, offset)].join(";"),
        )
        .sort()[0],
    );
  }
  return faces.sort();
}
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "bridge-drag-browser",
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
    new URL("bridge-drag-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__bridgeRequests = [];
    window.__bridgeStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__bridgeStages.push(e.data.stage);
          });
      }
      postMessage(data, ...args) {
        if (this.processing) window.__bridgeRequests.push(data.kind);
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
  const mutate = async (name, args) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const session = (await call("session_get")).result;
      if (!session.busy && session.activeJobId === null)
        return call(name, {
          ...args,
          expectedRevision: (await call("project_get")).revision,
          requestId: randomUUID(),
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(`Workspace did not settle before ${name}`);
  };
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

  const artifactJson = async (artifact) => {
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
    const result = JSON.parse(Buffer.concat(chunks).toString());
    await call("artifact_delete", { artifactId: artifact.artifactId });
    return result;
  };
  const runEdit = async (operation, previewOnly) =>
    (
      await job(
        await mutate("mesh_process", {
          entityId: "rim",
          operation,
          ...(previewOnly ? { previewOnly: true } : {}),
        }),
      )
    ).result;
  const geometry = async () =>
    artifactJson(
      (await call("object_get", { entityId: "rim", includeGeometry: true }))
        .result.geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  const bridgeReady = async (mode) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const view = (await call("viewport_get")).result;
      if (view.bridge?.mode === mode) return view;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(`Bridge interaction did not become ready: ${mode}`);
  };
  const canvas = page.locator(".viewport canvas").first();
  const reports = [];
  const requestedCases = process.env.SCANFORGE_BRIDGE_CASES?.split(",");
  const cases = [
    { curved: false },
    { curved: true },
    { curved: false, separate: true },
    { curved: false, separate: true, fragmented: true },
    { curved: false, native: true },
  ].filter(
    ({ curved, separate, fragmented, native }) =>
      !requestedCases ||
      requestedCases.includes(
        native
          ? "native-flat"
          : fragmented
            ? "fragmented-open"
            : separate
              ? "independent-boundaries"
              : curved
                ? "tangent"
                : "flat",
      ),
  );
  const semiCase = requestedCases?.includes("native-semi-flat");
  const convergenceCase = process.env.SCANFORGE_HOLE_CONVERGENCE === "1";
  assert(
    cases.length > 0 || convergenceCase || semiCase,
    "No requested browser cases matched",
  );
  if (convergenceCase) {
    // This six-edge, planar rim previously failed to converge in curvature mode.
    const rim = [
      [0, 0],
      [2.5, 0],
      [2.5, 1],
      [1.5, 1],
      [0.5, 1],
      [0, 1],
    ];
    const inner = rim.map(([x, y]) => [x, y, 0]);
    const outer = rim.map(([x, y]) => [
      1.25 + (x - 1.25) * 2,
      0.5 + (y - 0.5) * 2,
      0,
    ]);
    const positions = [];
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      positions.push(
        ...outer[i],
        ...outer[j],
        ...inner[j],
        ...outer[i],
        ...inner[j],
        ...inner[i],
      );
    }
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Uneven hole convergence",
      units: "mm",
      entities: [
        {
          id: "rim",
          name: "Uneven rim",
          kind: "mesh",
          positions,
          visible: true,
          color: "#b4bec4",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "uneven-rim.json",
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
    await mutate("object_select", { entityId: "rim" });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    const before = await geometry(),
      beforeHistory = await history();
    const inventory = await artifactJson(
      (await runEdit({ kind: "scanEdit", action: "inventory" })).artifact,
    );
    const hole = inventory.inventory.boundaries.findIndex(
      (b) =>
        b.closed &&
        b.points.every((v, i) => i % 3 !== 0 || (v >= 0 && v <= 2.5)),
    );
    assert(hole >= 0);
    assert(hole >= 0);
    const result = await runEdit({
      kind: "scanEdit",
      action: "fillHoles",
      mode: "entire",
      indices: [hole],
      algorithm: "curvature",
    });
    assert.equal(result.diagnostics.filledHoles, 1);
    assert.equal(result.diagnostics.skippedHoles, 0);
    const expected = await geometry();
    assert.deepEqual(
      expected.positions.slice(0, before.positions.length),
      before.positions,
    );
    const after = await artifactJson(
      (await runEdit({ kind: "scanEdit", action: "inventory" })).artifact,
    );
    assert.equal(after.inventory.boundaries.length, 1);
    await mutate("history_undo", {});
    await page.getByRole("button", { name: "Edit holes", exact: true }).click();
    const controls = page.locator(".scan-topology-panel");
    await controls.locator(".app-select > button").nth(1).click();
    await page.getByRole("option", { name: "Curvature", exact: true }).click();
    await mutate("viewport_control", {
      action: "camera",
      position: [1.25, 0.5, 8],
      target: [1.25, 0.5, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    const box = await canvas.boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(
      (await call("viewport_get")).result.bridge.hovered.boundary,
      hole,
    );
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 80 && (await history()) === beforeHistory; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await history(), beforeHistory + 1);
    assert.deepEqual((await geometry()).positions, expected.positions);
    await page.screenshot({
      path: fileURLToPath(new URL("uneven-rim-filled.png", out)),
    });
    await mutate("history_undo", {});
    assert.deepEqual((await geometry()).positions, before.positions);
    await mutate("history_redo", {});
    assert.deepEqual((await geometry()).positions, expected.positions);
    reports.push({
      scenario: "uneven-rim-convergence",
      method: "curvature",
      filledHoles: 1,
      skippedHoles: 0,
      guiMcpEqual: true,
      sourceUnchanged: true,
      undoRedo: true,
    });
  }
  if (semiCase) {
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: semiTangent
        ? "Native Semi Tangent annulus"
        : "Native Semi Flat square",
      units: "mm",
      entities: [
        {
          id: "rim",
          name: semiTangent ? "Native curved annulus" : "Native square annulus",
          kind: "mesh",
          positions: semiFlatFixture.source,
          visible: true,
          color: "#b4bec4",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "semi-flat.json",
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
    await mutate("object_select", { entityId: "rim" });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    const original = await geometry(),
      beforeHistory = await history();
    assert.deepEqual(original.positions, semiFlatFixture.source);
    const inventory = await artifactJson(
      (await runEdit({ kind: "scanEdit", action: "inventory" })).artifact,
    );
    const hole = inventory.inventory.boundaries.findIndex(
      (b) =>
        b.closed && b.points.every((v, i) => i % 3 === 2 || Math.abs(v) <= 3),
    );
    if (!semiTangent) assert.equal(hole, semiFlatFixture.boundary);
    const points = inventory.inventory.boundaries[hole].points;
    const endpoint = (sign) => {
      for (let i = 0; i < points.length; i += 3)
        if (
          Math.abs(points[i] - sign * 2.12132025) < 0.00001 &&
          Math.abs(points[i + 1] - sign * 2.12132025) < 0.00001
        )
          return i / 3;
      throw Error("Missing native endpoint");
    };
    const operation = {
      kind: "scanEdit",
      action: "fillHoles",
      mode: "partial",
      algorithm: semiTangent ? "tangent" : "flat",
      indices: [hole],
      start: semiTangent ? endpoint(1) : semiFlatFixture.start,
      end: semiTangent ? endpoint(-1) : semiFlatFixture.end,
      tolerance: semiFlatFixture.tolerance,
    };
    const expectedResult = await runEdit(operation);
    const expectedGeometry = await geometry();
    const patch = {
      positions: expectedGeometry.positions.slice(original.positions.length),
    };
    assert.equal(patch.positions.length, semiTangent ? 900 : 9);
    await mutate("history_undo", {});
    assert.equal(await history(), beforeHistory);
    assert.deepEqual((await geometry()).positions, original.positions);
    const openSemi = async () => {
      await page
        .getByRole("button", { name: "Edit holes", exact: true })
        .click();
      const controls = page.locator(".scan-topology-panel");
      await controls.locator(".app-select > button").first().click();
      await page
        .getByRole("option", { name: "Semi hole", exact: true })
        .click();
      await controls.locator(".app-select > button").nth(1).click();
      await page
        .getByRole("option", {
          name: semiTangent ? "Tangent" : "Flat",
          exact: true,
        })
        .click();
      await controls.locator(".scan-topology-list button").nth(hole).click();
      await controls
        .getByRole("spinbutton", { name: "Start vertex", exact: true })
        .fill(String(operation.start));
      await controls
        .getByRole("spinbutton", { name: "End vertex", exact: true })
        .fill(String(operation.end));
      return controls;
    };
    let controls = await openSemi();
    await controls.getByRole("button", { name: "Back", exact: true }).click();
    assert.deepEqual((await geometry()).positions, original.positions);
    assert.equal(await history(), beforeHistory);
    controls = await openSemi();
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `native-semi-${semiTangent ? "tangent" : "flat"}-settings.png`,
          out,
        ),
      ),
    });
    await controls
      .getByRole("button", { name: "Fill selected hole", exact: true })
      .click();
    for (let i = 0; i < 120 && (await history()) === beforeHistory; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await history(), beforeHistory + 1);
    await mutate("viewport_control", { action: "fit", entityId: "rim" });
    const gui = await geometry();
    assert.deepEqual(
      orientedFaces(gui.positions),
      orientedFaces(semiFlatFixture.native),
    );
    assert.deepEqual(
      gui.positions.slice(0, original.positions.length),
      original.positions,
    );
    assert.deepEqual(
      gui.positions.slice(original.positions.length),
      patch.positions,
    );
    await mutate("viewport_control", { action: "fit", entityId: "rim" });
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `native-semi-${semiTangent ? "tangent" : "flat"}-filled.png`,
          out,
        ),
      ),
    });
    await page.keyboard.press("Control+z");
    assert.deepEqual((await geometry()).positions, original.positions);
    await mutate("history_redo", {});
    assert.deepEqual((await geometry()).positions, gui.positions);
    await mutate("history_undo", {});
    await runEdit(operation);
    assert.deepEqual((await geometry()).positions, gui.positions);
    assert.equal(await history(), beforeHistory + 1);
    await controls.getByRole("button", { name: "Back", exact: true }).click();
    const saved = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: saved.result.artifactId,
        replace: true,
      }),
    );
    assert.deepEqual((await geometry()).positions, gui.positions);
    reports.push({
      scenario: semiTangent ? "native-semi-tangent" : "native-semi-flat",
      sourceTriangles: original.positions.length / 9,
      outputTriangles: gui.positions.length / 9,
      patchTriangles: patch.positions.length / 9,
      method: expectedResult.diagnostics.method,
      guiMcpEqual: true,
      nativeOrientedGeometryEqual: true,
      retainedSourceCornersExact: true,
      mcpCommitUndoRestoresSourceAndHistory: true,
      guiBackBeforeApplyPreservesSourceAndHistory: true,
      undoRedo: true,
      saveReopen: true,
    });
  }
  for (const { curved, separate, fragmented, native } of cases) {
    const scenario = native
      ? "native-flat"
      : fragmented
        ? "fragmented-open"
        : separate
          ? "independent-boundaries"
          : curved
            ? "tangent"
            : "flat";
    const positions = [];
    const point = (i, r) => {
      const a = (i * Math.PI) / 16,
        x = r * Math.cos(a),
        y = r * Math.sin(a);
      return separate
        ? [x * 0.2 - 10, y * 0.2, 0]
        : [x, y, curved ? 0.025 * (x * x + y * y) : 0];
    };
    for (let i = 0; i < 32; i++) {
      const a = point(i, 4),
        b = point(i, 5),
        c = point(i + 1, 5),
        d = point(i + 1, 4);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    if (separate) {
      const squares = [0, 3].flatMap((x) => [
        x,
        0,
        0,
        x + 1,
        0,
        0,
        x + 1,
        1,
        0,
        x,
        0,
        0,
        x + 1,
        1,
        0,
        x,
        1,
        0,
      ]);
      if (fragmented)
        squares.push(
          0,
          0,
          0,
          1,
          0,
          0,
          0.5,
          -1,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0.5,
          -2,
          0,
        );
      for (let i = 0; i < squares.length; i += 3)
        positions.push(
          squares[i] * 2 - 4,
          squares[i + 1] * 2 - 1,
          squares[i + 2],
        );
      if (fragmented) {
        // Large enough to exercise the real asynchronous display BVH before hover.
        for (let y = 0; y < 100; y++)
          for (let x = 0; x < 60; x++) {
            const a = [100 + x, 100 + y, 0],
              b = [101 + x, 100 + y, 0],
              c = [101 + x, 101 + y, 0],
              d = [100 + x, 101 + y, 0];
            positions.push(...a, ...b, ...c, ...a, ...c, ...d);
          }
      }
    }
    if (native)
      positions.splice(0, positions.length, ...nativeFlatFixture.source);
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Bridge validation",
      units: "mm",
      entities: [
        {
          id: "rim",
          name: "Bridge rim",
          kind: "mesh",
          positions,
          visible: true,
          color: "#b4bec4",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "bridge.json",
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
    await mutate("object_select", { entityId: "rim" });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    const inventory = await artifactJson(
      (
        await runEdit({
          kind: "scanEdit",
          action: "inventory",
          tolerance: 0.001,
        })
      ).artifact,
    );
    const hole = inventory.inventory.boundaries.findIndex(
      (b) => b.closed && Math.hypot(b.points[0], b.points[1]) < 4.5,
    );
    assert(hole >= 0);
    const boundary = inventory.inventory.boundaries[hole];
    const findEdge = (x) => {
      for (const [boundary, path] of inventory.inventory.boundaries.entries()) {
        const n = path.points.length / 3,
          count = n - (path.closed ? 0 : 1);
        for (let edge = 0; edge < count; edge++)
          if (
            Math.abs(path.points[edge * 3] - x) < 1e-5 &&
            Math.abs(path.points[((edge + 1) % n) * 3] - x) < 1e-5
          )
            return { boundary, edge };
      }
      throw Error(`Missing facing edge ${x}`);
    };
    const source = separate
      ? findEdge(-2)
      : { boundary: hole, edge: native ? nativeFlatFixture.start : 0 };
    const destination = separate
      ? findEdge(2)
      : { boundary: hole, edge: native ? nativeFlatFixture.end : 16 };
    const operation = {
      kind: "scanEdit",
      action: "fillHoles",
      mode: "bridge",
      indices: [source.boundary],
      ...(separate ? { endBoundary: destination.boundary } : {}),
      start: source.edge,
      end: destination.edge,
      algorithm: native ? "flat" : "automatic",
      tolerance: 0.001,
    };
    const beforeHistory = await history(),
      original = await geometry();
    const preview = await runEdit(operation, true);
    const patch = await artifactJson(preview.artifact);
    assert.equal(preview.diagnostics.method, curved ? "tangent" : "flat");
    assert.equal(await history(), beforeHistory);
    assert.deepEqual((await geometry()).positions, original.positions);

    await page.getByRole("button", { name: "Edit holes", exact: true }).click();
    console.log("Bridge model ready", { scenario, source, destination });
    // The panel is a labelled section; use its CSS scope where browsers expose no region role.
    const controls = page.locator(".scan-topology-panel");
    // Leave the default, unrelated hole selected. Bridge must ignore that selection.
    await controls.locator(".app-select > button").first().click();
    await page.getByRole("option", { name: "Bridge", exact: true }).click();
    if (native) {
      await controls.locator(".app-select > button").nth(1).click();
      await page.getByRole("option", { name: "Flat", exact: true }).click();
    }
    assert.equal(await controls.locator(".scan-topology-list").count(), 0);
    assert.equal(
      await controls.getByRole("spinbutton", { name: "Start vertex" }).count(),
      0,
    );
    await mutate("viewport_control", {
      action: "projection",
      projection: "perspective",
    });
    await mutate("viewport_control", {
      action: "camera",
      position: [0, 0, 22],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    const beforeView = (await call("viewport_get")).result;
    console.log("Bridge mode and camera ready");
    const box = await canvas.boundingBox();
    assert(box);
    const screen = ({ boundary: boundaryIndex, edge }) => {
      const boundary = inventory.inventory.boundaries[boundaryIndex];
      const count = boundary.points.length / 3,
        j = (edge + 1) % count;
      const p = [0, 1, 2].map(
        (k) => (boundary.points[edge * 3 + k] + boundary.points[j * 3 + k]) / 2,
      );
      const unit =
        box.height / (2 * (22 - p[2]) * Math.tan((21 * Math.PI) / 180));
      return {
        x: box.x + box.width / 2 + p[0] * unit,
        y: box.y + box.height / 2 - p[1] * unit,
      };
    };
    const a = screen(source),
      b = screen(destination);
    if (scenario === "flat" || scenario === "tangent") {
      await controls.locator(".app-select > button").first().click();
      await page
        .getByRole("option", { name: "Entire hole", exact: true })
        .click();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const holeView = (await call("viewport_get")).result;
      assert.equal(holeView.bridge.mode, "holes");
      assert.equal(holeView.bridge.hovered.boundary, hole);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert(
        (
          await controls
            .locator('.scan-topology-list button[aria-pressed="true"]')
            .innerText()
        ).startsWith("Hole " + (hole + 1)),
      );
      if (scenario === "flat") {
        const beforeFill = await geometry(),
          beforeFillHistory = await history();
        const mcpFill = await runEdit({
          kind: "scanEdit",
          action: "fillHoles",
          mode: "entire",
          indices: [hole],
          algorithm: "automatic",
        });
        assert.equal(mcpFill.diagnostics.filledHoles, 1);
        const expectedFill = await geometry();
        await mutate("history_undo", {});
        assert.deepEqual((await geometry()).positions, beforeFill.positions);
        await page.waitForFunction(() =>
          document.querySelector('.scan-topology-panel[aria-busy="false"]'),
        );
        await page.mouse.dblclick(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        for (
          let attempt = 0;
          attempt < 80 && (await history()) === beforeFillHistory;
          attempt++
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          await history(),
          beforeFillHistory + 1,
          "hole double-click must create exactly one fill history step",
        );
        assert.deepEqual(
          (await geometry()).positions,
          expectedFill.positions,
          "GUI double-click and MCP fill must produce identical geometry",
        );
        await page.screenshot({
          path: fileURLToPath(new URL("double-click-hole-filled.png", out)),
        });
        await mutate("history_undo", {});
        assert.deepEqual((await geometry()).positions, beforeFill.positions);
        await mutate("history_redo", {});
        assert.deepEqual((await geometry()).positions, expectedFill.positions);
        await mutate("history_undo", {});
        console.log(
          "PASS: highlighted hole double-click matches MCP, with one history step and Undo/Redo",
        );
      }
      if (scenario === "flat") {
        await bridgeReady("holes");
        const unit = box.height / (2 * 22 * Math.tan((21 * Math.PI) / 180));
        await page.mouse.move(
          box.x + box.width / 2 + 4.5 * unit,
          box.y + box.height / 2,
        );
        assert.equal(
          (await call("viewport_get")).result.bridge.hovered,
          null,
          "solid surface is not a hole",
        );
      }
      await controls.locator(".app-select > button").first().click();
      await page.getByRole("option", { name: "Bridge", exact: true }).click();
    }

    await bridgeReady("bridge");
    await page.mouse.move(a.x, a.y);
    await page.waitForFunction(
      () =>
        document.querySelector(".viewport canvas")?.style.cursor ===
        "crosshair",
    );
    assert.deepEqual(
      (await call("viewport_get")).result.bridge.hovered,
      source,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`${scenario}-hover.png`, out)),
    });
    const requestsBeforeDrag = await page.evaluate(
      () => window.__bridgeRequests.length,
    );
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
    assert(
      Number(await canvas.getAttribute("data-bridge-preview")) > 0,
      "empty-space preview is immediate",
    );
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".viewport canvas")?.dataset.bridgePreview,
        ) > 0,
    );
    assert(
      (await controls.getByRole("status").innerText()).includes("provisional"),
    );
    assert.equal(
      await page.evaluate(() => window.__bridgeRequests.length),
      requestsBeforeDrag,
      "dragging must not create geometry requests",
    );
    assert.equal(await history(), beforeHistory);
    const dragView = (await call("viewport_get")).result;
    assert.deepEqual(dragView.position, beforeView.position);
    assert.deepEqual(dragView.target, beforeView.target);
    assert.deepEqual(dragView.bridge.dragStart, source);
    assert.deepEqual(dragView.bridge.hovered, destination);
    await page.screenshot({
      path: fileURLToPath(new URL(`${scenario}-preview.png`, out)),
    });
    // Esc cancels preview and capture, without creating history.
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await history(), beforeHistory);
    assert.equal(await canvas.getAttribute("data-bridge-preview"), "0");
    // Release away from the rim also cancels.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.up();
    assert.equal(await history(), beforeHistory);
    // Release validates the same mesh as MCP, in one Undo step, using retained topology.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".viewport canvas")?.dataset.bridgePreview,
        ) > 0,
    );
    const stageCount = await page.evaluate(() => window.__bridgeStages.length);
    await page.mouse.up();
    for (
      let attempt = 0;
      attempt < 80 && (await history()) === beforeHistory;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await history(), beforeHistory + 1);
    await controls.getByRole("button", { name: "Back", exact: true }).waitFor();
    assert(
      !(
        await page.evaluate(
          (start) => window.__bridgeStages.slice(start),
          stageCount,
        )
      ).some(
        (stage) =>
          stage === "Welding vertices" || stage === "Building topology",
      ),
      "bridge commit and inventory must reuse topology",
    );
    const gui = await geometry();
    if (native)
      assert.deepEqual(
        orientedFaces(gui.positions),
        orientedFaces(nativeFlatFixture.native),
      );
    assert.deepEqual(
      gui.positions.slice(original.positions.length),
      patch.positions,
    );
    await page.keyboard.press("Control+z");
    assert.deepEqual((await geometry()).positions, original.positions);
    await mutate("history_redo", {});
    assert.deepEqual((await geometry()).positions, gui.positions);
    await mutate("history_undo", {});
    await runEdit(operation);
    assert.deepEqual((await geometry()).positions, gui.positions);
    assert.equal(await history(), beforeHistory + 1);
    await page.screenshot({
      path: fileURLToPath(new URL(`${scenario}-bridge.png`, out)),
    });
    reports.push({
      method: preview.diagnostics.method,
      scenario,
      hover: true,
      cameraUnchanged: true,
      triangles: patch.positions.length / 9,
      guiMcpEqual: true,
      undoRedo: true,
      cancel: true,
    });
    await controls.getByRole("button", { name: "Back", exact: true }).click();
    if (native) {
      const saved = await job(
        await call("project_export", { format: "project" }),
      );
      await job(
        await mutate("project_import", {
          artifactId: saved.result.artifactId,
          replace: true,
        }),
      );
      assert.deepEqual((await geometry()).positions, gui.positions);
      reports.at(-1).nativeOrientedGeometryEqual = true;
      reports.at(-1).saveReopen = true;
    }
  }
  assert.deepEqual(errors, []);
  ledger.result = { reports, pageErrors: errors };
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
    new URL("bridge-drag-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
