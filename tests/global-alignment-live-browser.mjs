import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// Uses an existing dev server and a disposable browser/workspace and MCP bridge.
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5174";
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser;
let developmentServer;
const timeout = setTimeout(() => void browserServer?.close(), 240000);
try {
  if (process.env.SCANFORGE_TEST_START_SERVER === "1") {
    const url = new URL(origin);
    developmentServer = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        url.hostname,
        "--port",
        url.port,
        "--strictPort",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let serverOutput = "";
    developmentServer.stdout.on("data", (chunk) => {
      serverOutput += chunk;
    });
    developmentServer.stderr.on("data", (chunk) => {
      serverOutput += chunk;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (developmentServer.exitCode !== null)
        throw Error("Development server exited before becoming ready");
      if (serverOutput.includes("ready in")) {
        try {
          ready = (await fetch(origin)).ok;
        } catch {}
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw Error("Development server did not become ready");
  }
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
  await page.addInitScript(() => {
    window.__alignmentWorkers = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        window.__alignmentWorkers.push(options?.name ?? "");
        super(url, options);
      }
    };
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Page error:", e.message);
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
  function fixtureStl(offset) {
    const t = (1 + Math.sqrt(5)) / 2;
    const unit = (p) => {
      const l = Math.hypot(...p);
      return p.map((v) => v / l);
    };
    const vertices = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ].map(unit);
    let faces = [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ];
    // Native source normal bins retain at least 100 vertices; the 162-vertex
    // level-two fixture cannot qualify. Level four retains valid groups.
    for (let level = 0; level < 4; level++) {
      const edges = new Map();
      const midpoint = (a, b) => {
        const key = [a, b].sort((x, y) => x - y).join(":");
        if (!edges.has(key)) {
          edges.set(key, vertices.length);
          vertices.push(
            unit(vertices[a].map((v, i) => (v + vertices[b][i]) / 2)),
          );
        }
        return edges.get(key);
      };
      faces = faces.flatMap(([a, b, c]) => {
        const ab = midpoint(a, b),
          bc = midpoint(b, c),
          ca = midpoint(c, a);
        return [
          [a, ab, ca],
          [b, bc, ab],
          [c, ca, bc],
          [ab, bc, ca],
        ];
      });
    }
    const coordinates = vertices.map(([x, y, z]) => {
      const bump = 1 + 0.07 * x * y + 0.04 * z * x;
      return [
        x * 24 * bump + offset[0],
        y * 18 * bump + offset[1],
        z * 14 * bump + offset[2],
      ];
    });
    // Binary encoding stays below the public artifact upload limit without
    // reducing the geometry needed by native normal-group eligibility.
    const bytes = Buffer.alloc(84 + faces.length * 50);
    bytes.write("Synthetic alignment scan");
    bytes.writeUInt32LE(faces.length, 80);
    faces.forEach((face, index) => {
      face.forEach((id, vertex) => {
        coordinates[id].forEach((coordinate, axis) => {
          bytes.writeFloatLE(
            coordinate,
            84 + index * 50 + 12 + vertex * 12 + axis * 4,
          );
        });
      });
    });
    return bytes;
  }

  for (const [name, offset] of [
    ["reference.stl", [0, 0, 0]],
    ["moving.stl", [12, -4, 6]],
    ["third.stl", [-7, 11, -3]],
  ]) {
    const upload = (
      await call("artifact_put", {
        name,
        offset: 0,
        base64: fixtureStl(offset).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: upload.artifactId,
        unit: "mm",
      }),
    );
  }
  const geometry = async (ids) => {
    const result = [];
    for (const entityId of ids) {
      const object = (
        await call("object_get", { entityId, includeGeometry: true })
      ).result;
      const bytes = [];
      let offset = 0,
        eof = false;
      while (!eof) {
        const chunk = (
          await call("artifact_read", {
            artifactId: object.geometry.artifactId,
            offset,
            length: 262144,
          })
        ).result;
        bytes.push(Buffer.from(chunk.base64, "base64"));
        offset = chunk.nextOffset;
        eof = chunk.eof;
      }
      const raw = Buffer.concat(bytes);
      const decoded = JSON.parse(raw.toString("utf8"));
      assert(
        decoded.positions.length > 0 &&
          decoded.positions.every(Number.isFinite),
        "Authored coordinates detached or invalid",
      );
      result.push({
        id: entityId,
        sha256: createHash("sha256").update(raw).digest("hex"),
        coordinates: decoded.positions.length,
      });
      await call("artifact_delete", { artifactId: object.geometry.artifactId });
    }
    return result;
  };
  const before = (await call("project_get")).result,
    history = (await call("history_get")).result;
  const ids = before.objects.map((o) => o.id);
  const originalGeometry = await geometry(ids);
  await mutate("ui_set", { globalAlignmentOpen: true });
  assert(
    await page
      .getByRole("checkbox", {
        name: "Automatic initial placement",
        exact: true,
      })
      .isChecked(),
  );
  const canvas = page.locator(".viewport canvas").first();
  const canvasFrames = [
    createHash("sha256")
      .update(await canvas.screenshot())
      .digest("hex"),
  ];
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  let ready;
  const frames = [];
  for (let i = 0; i < 1200; i++) {
    const state = (await call("global_alignment_state")).result;
    if (state.progress && frames.at(-1)?.sequence !== state.progress.sequence) {
      frames.push(state.progress);
      if (canvasFrames.length < 5)
        canvasFrames.push(
          createHash("sha256")
            .update(await canvas.screenshot())
            .digest("hex"),
        );
    }
    if (state.state === "preview") {
      ready = state;
      break;
    }
    const session = (await call("session_get")).result;
    const failed = session.jobs.find(
      (j) => j.command === "global_alignment_preview" && j.status === "failed",
    );
    assert(!failed, JSON.stringify(failed));
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "missing completed preview");
  assert(
    await page.evaluate(() => crossOriginIsolated),
    "expected isolated worker context",
  );
  assert(
    await page.evaluate(() =>
      window.__alignmentWorkers.includes("global-alignment-controller"),
    ),
    "isolated controller worker did not start",
  );
  assert(frames.length, "no provisional matrices exposed");
  assert(
    frames.some((frame) => frame.phase === "refining"),
    "no refinement poses exposed through MCP",
  );
  assert(
    new Set(canvasFrames).size > 1,
    "Live solver poses did not change rendered canvas pixels",
  );
  assert(ready.initialization?.fits.length === 3);
  assert.equal(ready.settings.initialization, "automatic");
  assert.deepEqual((await call("history_get")).result, history);
  assert.equal(
    (await call("project_get")).result.objects.length,
    before.objects.length,
  );
  const panelBounds = await page
    .locator(".global-alignment-panel")
    .boundingBox();
  const actionBounds = await page
    .locator(".global-alignment-panel .global-alignment-actions")
    .boundingBox();
  assert(panelBounds && actionBounds);
  assert(
    actionBounds.y >= panelBounds.y &&
      actionBounds.y + actionBounds.height <=
        panelBounds.y + panelBounds.height + 1,
    "Global alignment actions are clipped by results",
  );
  assert.deepEqual(await geometry(ids), originalGeometry);
  await mutate("global_alignment_cancel");
  assert.equal((await call("global_alignment_state")).result.state, "idle");
  assert.deepEqual((await call("history_get")).result, history);
  assert.deepEqual(await geometry(ids), originalGeometry);
  await job(
    await mutate("global_alignment_preview", { initialization: "automatic" }),
  );
  const cached = (await call("global_alignment_state")).result;
  await mutate("global_alignment_apply", { previewId: cached.previewId });
  const alignedGeometry = await geometry(ids);
  assert.notDeepEqual(alignedGeometry, originalGeometry);
  assert.equal((await call("history_get")).result.cursor, history.cursor + 1);
  await mutate("history_undo");
  assert.deepEqual(await geometry(ids), originalGeometry);
  await mutate("history_redo");
  assert.deepEqual(await geometry(ids), alignedGeometry);
  await mutate("history_undo");
  const cancelHistory = (await call("history_get")).result;
  const started = await mutate("global_alignment_preview", {
    initialization: "automatic",
  });
  for (let i = 0; i < 200; i++) {
    const s = (await call("global_alignment_state")).result;
    if (s.progress) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await mutate("global_alignment_cancel", { jobId: started.result.jobId });
  assert.equal((await call("global_alignment_state")).result.state, "idle");
  assert.deepEqual((await call("history_get")).result, cancelHistory);
  assert.deepEqual(await geometry(ids), originalGeometry);
  assert.deepEqual((await call("history_get")).result, cancelHistory);
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    frames,
    canvasFrames,
    ready,
    errors,
    checks: [
      "GUI automatic default",
      "public MCP provisional pose state",
      "actual canvas pixels change during real pose updates",
      "raw originals/history unchanged before Apply",
      "GUI and MCP shared preview",
      "cached preview discard",
      "in-flight cancellation restores original display and history",
    ],
  };
  console.log(JSON.stringify(evidence));
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  developmentServer?.kill();
}
