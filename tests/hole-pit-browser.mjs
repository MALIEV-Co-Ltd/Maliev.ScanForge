import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
import { holeSeamMetrics } from "./hole-seam-metrics.mjs";
// Optional extracted single-hole component: positions, rim, center and radius.
const fixturePath = process.env.SCANFORGE_HOLE_FIXTURE;
const root = new URL("../", import.meta.url),
  out = new URL(
    process.env.SCANFORGE_HOLE_OUTPUT ??
      (fixturePath
        ? "../.resources/hole22-browser/"
        : "../.resources/hole-pit-browser/"),
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
    owner: "hole-pit-browser",
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
    new URL("hole-pit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
    return JSON.parse(Buffer.concat(chunks).toString());
  };

  const geometry = async () =>
    artifactJson(
      (await call("object_get", { entityId: "panel", includeGeometry: true }))
        .result.geometry,
    );
  const history = async () => (await call("history_get")).result.cursor;
  let positions = [];
  const count = 32;
  const point = (i, r, z) => [
    r * Math.cos((i * 2 * Math.PI) / count),
    r * Math.sin((i * 2 * Math.PI) / count),
    z,
  ];
  for (const [a, b, za, zb] of [
    [4, 4.15, 0, 0.5],
    [4.15, 5.5, 0.5, 0.5],
  ])
    for (let i = 0; i < count; i++) {
      const p = point(i, a, za),
        q = point(i, b, zb),
        r = point(i + 1, b, zb),
        t = point(i + 1, a, za);
      positions.push(...p, ...q, ...r, ...p, ...r, ...t);
    }
  const fixture = fixturePath
    ? JSON.parse(await readFile(fixturePath, "utf8"))
    : undefined;
  if (fixture) positions = fixture.positions;
  const center = fixture?.center ?? [0, 0, 0],
    normal = [0, 0, 0];
  const rim = fixture?.rim;
  if (rim) {
    for (let i = 0; i < rim.length; i += 3) {
      const j = (i + 3) % rim.length,
        a = center.map((v, k) => rim[i + k] - v),
        b = center.map((v, k) => rim[j + k] - v);
      normal[0] += a[1] * b[2] - a[2] * b[1];
      normal[1] += a[2] * b[0] - a[0] * b[2];
      normal[2] += a[0] * b[1] - a[1] * b[0];
    }
    const length = Math.hypot(...normal);
    for (let k = 0; k < 3; k++) normal[k] /= -length;
  } else normal[2] = 1;
  const height = (p) =>
    normal.reduce((sum, n, k) => sum + n * (p[k] - center[k]), 0);
  const rimHeights = rim
    ? Array.from({ length: rim.length / 3 }, (_, i) =>
        height(rim.slice(i * 3, i * 3 + 3)),
      )
    : [0];
  const interpolation = fixture?.expectedSurface === "interpolated";
  const supportHeights = interpolation
    ? positions
        .filter((_, i) => i % 3 === 0)
        .map((_, i) => height(positions.slice(i * 3, i * 3 + 3)))
    : rimHeights;
  const supportMin = Math.min(...supportHeights),
    supportMax = Math.max(...supportHeights);
  const perimeter = rim
    ? rimHeights.reduce(
        (sum, _, i) =>
          sum +
          Math.hypot(
            ...[0, 1, 2].map(
              (k) =>
                rim[i * 3 + k] - rim[((i + 1) % rimHeights.length) * 3 + k],
            ),
          ),
        0,
      )
    : 0;
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Automatic hole surface parity",
    units: "mm",
    entities: [
      {
        id: "panel",
        name: fixture
          ? "Exported Hole 22 component"
          : "Shallow panel with steep scan lip",
        kind: "mesh",
        positions: Array.from(new Float32Array(positions)),
        visible: true,
        color: "#b4bec4",
        opacity: 1,
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(project));
  let upload;
  for (let offset = 0; offset < bytes.length; offset += 262144) {
    upload = (
      await call("artifact_put", {
        name: "panel.json",
        offset,
        base64: bytes.subarray(offset, offset + 262144).toString("base64"),
        ...(upload ? { artifactId: upload.artifactId } : {}),
      })
    ).result;
  }
  await job(
    await mutate("project_import", {
      artifactId: upload.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "panel" });
  await mutate("ui_set", {
    workspace: "mesh",
    mode: "brush",
    toolPanelOpen: true,
  });
  await mutate("viewport_control", {
    action: "camera",
    position: fixture
      ? center.map((v, k) => v + normal[k] * fixture.radius * 3)
      : [0, 0, 45],
    target: center,
    up: Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0],
    zoom: interpolation ? 6 : fixture ? 1 : 4,
  });
  const original = await geometry(),
    beforeHistory = await history();
  const originalTopology = (
    await job(
      await call("mesh_analyze", { entityId: "panel", tolerance: 0.001 }),
    )
  ).result.topology;
  const inventoryJob = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      operation: { kind: "scanEdit", action: "inventory", tolerance: 0.001 },
    }),
  );
  const inventory = (await artifactJson(inventoryJob.result.artifact))
    .inventory;
  const hole = inventory.boundaries.findIndex(
    (b) =>
      b.closed &&
      (fixture
        ? Math.abs(b.length - perimeter) < 0.001
        : b.points.every((v, i) => i % 3 === 2 || Math.abs(v) < 4.01)),
  );
  assert(hole >= 0);
  await page.getByRole("button", { name: "Edit holes", exact: true }).click();
  const controls = page.locator(".scan-topology-panel");
  await controls
    .getByRole("button", { name: new RegExp(`^Hole ${hole + 1} `) })
    .click();
  await page.screenshot({ path: fileURLToPath(new URL("before.png", out)) });
  await controls
    .getByRole("button", { name: "Fill selected hole", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.scan-topology-panel[aria-busy="false"]'),
  );
  for (let i = 0; i < 150 && (await history()) === beforeHistory; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(await history(), beforeHistory + 1);
  await page
    .getByText(interpolation ? /1 holes filled/ : /1 filled from boundary/)
    .waitFor();
  const gui = await geometry();
  assert.deepEqual(
    gui.positions.slice(0, original.positions.length),
    original.positions,
  );
  let maximumHeight = 0;
  for (let i = original.positions.length; i < gui.positions.length; i += 3) {
    const h = height(gui.positions.slice(i, i + 3));
    maximumHeight = Math.max(maximumHeight, Math.abs(h));
    assert(
      h >= supportMin - 0.0001 && h <= supportMax + 0.0001,
      `Unbounded height ${h}`,
    );
  }
  assert(gui.positions.length > original.positions.length);
  if (fixture) {
    await writeFile(new URL("gui-geometry.json", out), JSON.stringify(gui));
    if (interpolation)
      await page.screenshot({
        path: fileURLToPath(new URL("candidate-closeup.png", out)),
      });
  }
  const seam = holeSeamMetrics(gui.positions, original.positions.length);
  if (interpolation) {
    assert.equal(seam.edges, rim.length / 3);
  }
  if (!fixture) assert(maximumHeight < 1e-6, `Pit depth ${maximumHeight}`);
  assert((gui.positions.length - original.positions.length) / 9 < 100000);
  const analyzed = await job(
    await call("mesh_analyze", { entityId: "panel", tolerance: 0.001 }),
  );
  const topology = analyzed.result.topology;
  for (const key of [
    "nonManifoldEdges",
    "nonManifoldVertices",
    "inconsistentEdges",
    "degenerateTriangles",
    "duplicateTriangles",
    "boundaryChains",
  ])
    assert.equal(
      topology[key],
      originalTopology[key],
      `${key}: ${JSON.stringify(topology)}`,
    );
  assert.equal(topology.boundaryLoops, originalTopology.boundaryLoops - 1);
  await page.screenshot({ path: fileURLToPath(new URL("after.png", out)) });
  await mutate("history_undo", {});
  assert.deepEqual((await geometry()).positions, original.positions);
  await mutate("history_redo", {});
  assert.deepEqual((await geometry()).positions, gui.positions);
  await mutate("history_undo", {});
  const mcp = await job(
    await mutate("mesh_process", {
      entityId: "panel",
      operation: {
        kind: "scanEdit",
        action: "fillHoles",
        indices: [hole],
        algorithm: "automatic",
        mode: "entire",
        tolerance: 0.001,
      },
    }),
  );
  assert.equal(
    mcp.result.diagnostics.boundedFallbackHoles,
    interpolation ? 0 : 1,
  );
  if (interpolation)
    assert.equal(mcp.result.diagnostics.interpolatedSurfaceHoles, 1);
  assert.deepEqual((await geometry()).positions, gui.positions);
  assert.equal(await history(), beforeHistory + 1);
  assert.deepEqual(errors, []);
  const inspection = [];
  if (interpolation && process.env.SCANFORGE_HOLE_BASELINE) {
    const baseline = JSON.parse(
      await readFile(process.env.SCANFORGE_HOLE_BASELINE, "utf8"),
    );
    assert.deepEqual(
      baseline.positions.slice(0, original.positions.length),
      original.positions,
    );
    const up = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const side = [
      up[1] * normal[2] - up[2] * normal[1],
      up[2] * normal[0] - up[0] * normal[2],
      up[0] * normal[1] - up[1] * normal[0],
    ];
    const sideLength = Math.hypot(...side);
    side.forEach((v, k) => (side[k] = v / sideLength));
    const cameras = [
      {
        name: "front",
        position: center.map((v, k) => v + normal[k] * fixture.radius * 3),
      },
      {
        name: "oblique",
        position: center.map(
          (v, k) =>
            v + fixture.radius * (normal[k] * 1.8 + side[k] * 1.2 - up[k]),
        ),
      },
    ];
    for (const [label, meshPositions] of [
      ["previous", baseline.positions],
      ["repaired", gui.positions],
    ]) {
      const bytes = Buffer.from(
        JSON.stringify({
          ...project,
          name: "Patch surface inspection",
          entities: [
            {
              ...project.entities[0],
              name: "Sample project repair area",
              positions: meshPositions,
            },
          ],
        }),
      );
      let uploaded;
      for (let offset = 0; offset < bytes.length; offset += 262144)
        uploaded = (
          await call("artifact_put", {
            name: "inspection.json",
            offset,
            base64: bytes.subarray(offset, offset + 262144).toString("base64"),
            ...(uploaded ? { artifactId: uploaded.artifactId } : {}),
          })
        ).result;
      await job(
        await mutate("project_import", {
          artifactId: uploaded.artifactId,
          replace: true,
        }),
      );
      await mutate("object_select", { entityId: "panel" });
      await mutate("ui_set", {
        workspace: "mesh",
        mode: "brush",
        toolPanelOpen: false,
      });
      for (const camera of cameras) {
        await mutate("viewport_control", {
          action: "camera",
          position: camera.position,
          target: center,
          up,
          zoom: 6,
        });
        const name = `${label}-${camera.name}.png`;
        await page.screenshot({ path: fileURLToPath(new URL(name, out)) });
        await mutate("settings_set", { patch: { flatShading: false } });
        await page.screenshot({
          path: fileURLToPath(
            new URL(`${label}-${camera.name}-smooth.png`, out),
          ),
        });
        await mutate("settings_set", { patch: { flatShading: true } });
        inspection.push({
          label,
          view: camera.name,
          file: name,
          position: camera.position,
          target: center,
          up,
          zoom: 6,
        });
      }
    }
  }
  assert.deepEqual(errors, []);
  ledger.result = {
    guiMcpEqual: true,
    undoRedo: true,
    sourcePreserved: true,
    maximumHeight,
    seam,
    inspection,
    topology,
    sourceBoundary: fixture?.sourceBoundary,
    perimeter,
    diagnostics: mcp.result.diagnostics,
    pageErrors: errors,
  };
  if (interpolation)
    assert(seam.p95Degrees < 8, `Visible seam angle ${JSON.stringify(seam)}`);
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
    new URL("hole-pit-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
