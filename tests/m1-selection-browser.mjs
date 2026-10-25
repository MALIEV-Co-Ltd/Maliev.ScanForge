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
  out = new URL("../.resources/m1-selection/", import.meta.url);
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
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 300000);
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
    new URL("selection-ledger.json", out),
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

  const results = [];
  const readSelection = async (id) => {
    const state = (await call("selection_get", { entityId: id })).result;
    const artifact = (
      await call("artifact_read", { artifactId: state.artifact.artifactId })
    ).result;
    const slots = JSON.parse(Buffer.from(artifact.base64, "base64").toString());
    await call("artifact_delete", { artifactId: state.artifact.artifactId });
    return slots;
  };
  const settle = async () => {
    await page.waitForTimeout(150);
  };
  for (const kind of ["pointcloud", "mesh"]) {
    const positions = [];
    if (kind === "pointcloud") {
      for (const z of [1, 0])
        for (let y = 0; y < 20; y++)
          for (let x = 0; x < 20; x++) positions.push(x, y, z);
    } else {
      for (const z of [1, 0])
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++) {
            positions.push(
              x * 2,
              y * 2,
              z,
              x * 2 + 1.8,
              y * 2,
              z,
              x * 2,
              y * 2 + 1.8,
              z,
            );
            positions.push(
              x * 2 + 1.8,
              y * 2,
              z,
              x * 2 + 1.8,
              y * 2 + 1.8,
              z,
              x * 2,
              y * 2 + 1.8,
              z,
            );
          }
    }
    const id = kind;
    const data = {
      format: "maliev-scanforge",
      version: 1,
      name: "M1 selection",
      units: "mm",
      entities: [
        {
          id,
          name: id,
          kind,
          positions,
          visible: true,
          color: "#aaff00",
          opacity: 1,
        },
      ],
    };
    const upload = (
      await call("artifact_put", {
        name: "selection.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(data)).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: upload.artifactId,
        replace: true,
      }),
    );
    await mutate("object_select", { entityId: id });
    await page.getByRole("button", { name: "Edit scan", exact: true }).click();
    await mutate("viewport_control", {
      action: "projection",
      projection: "orthographic",
    });
    await mutate("viewport_set", { view: "fit" });
    await mutate("viewport_set", { view: "top" });
    await page.waitForTimeout(450);
    const box = await page.locator(".viewport canvas").first().boundingBox();
    assert(box);
    const start = [Math.round(box.width * 0.42), Math.round(box.height * 0.32)];
    const end = [Math.round(box.width * 0.65), Math.round(box.height * 0.65)];
    const control = (options) =>
      mutate("scan_selection_control", { entityId: id, ...options });
    const clear = () =>
      mutate("selection_modify", { entityId: id, operation: "clear" });
    const select = async (region, through = true, operation = "replace") =>
      job(
        await mutate("scan_select_region", {
          entityId: id,
          region,
          through,
          operation,
        }),
      );
    for (const tool of process.env.SCANFORGE_M1_SELECTION_FAST
      ? []
      : ["rectangle", "circle", "brush", "freehand", "line"]) {
      for (const through of [false, true]) {
        await clear();
        await control({ action: "configure", tool, through });
        await settle();
        const radius = (await call("scan_selection_get")).result.brushRadiusPx;
        let points =
          tool === "line"
            ? [start, end]
            : [start, [end[0], start[1]], end, [start[0], end[1]], start];
        const region =
          tool === "rectangle" || tool === "circle"
            ? { kind: tool, start, end }
            : { kind: tool === "brush" ? "lasso" : "brush", points, radius };
        const draw = async () => {
          await page.mouse.move(box.x + start[0], box.y + start[1]);
          await page.mouse.down();
          if (tool === "rectangle" || tool === "circle")
            await page.mouse.move(box.x + end[0], box.y + end[1], { steps: 8 });
          else
            for (const point of points.slice(1))
              await page.mouse.move(box.x + point[0], box.y + point[1], {
                steps: 4,
              });
          await page.mouse.up();
        };
        await draw();
        await page.waitForTimeout(500);
        const gui = await readSelection(id);
        assert(
          gui.length > 0,
          `${kind}/${tool}/${through}: GUI selected nothing`,
        );
        await page.keyboard.down("Alt");
        try {
          await draw();
        } finally {
          await page.keyboard.up("Alt");
        }
        await page.waitForTimeout(500);
        assert.deepEqual(
          await readSelection(id),
          [],
          `${kind}/${tool}: GUI Alt subtraction`,
        );
        await clear();
        await select(region, through);
        const mcp = await readSelection(id);
        assert.deepEqual(
          mcp,
          gui,
          `${kind}/${tool}/${through}: same screen region`,
        );
        await select(region, through, "subtract");
        assert.deepEqual(await readSelection(id), []);
        await control({ action: "undo" });
        assert.deepEqual(await readSelection(id), gui);
        await control({ action: "redo" });
        assert.deepEqual(await readSelection(id), []);
        results.push({
          kind,
          tool,
          through,
          selected: gui.length,
          exactSourceSlots: true,
          subtract: true,
          selectionUndoRedo: true,
        });
      }
    }
    // Connected components and morphology use the same processing operations.
    const seed = {
      entityId: id,
      [kind === "pointcloud" ? "points" : "triangles"]: [0],
    };
    await mutate("selection_set", seed);
    if (kind === "pointcloud")
      await page
        .getByLabel("Neighbor radius (mm)", { exact: true })
        .fill("1.01");
    await page
      .getByRole("button", {
        name:
          kind === "pointcloud"
            ? "Select connected points"
            : "Select connected objects",
        exact: true,
      })
      .click();
    const connectedCount = kind === "pointcloud" ? 800 : 2;
    for (let i = 0; i < 100; i++) {
      if ((await readSelection(id)).length === connectedCount) break;
      await page.waitForTimeout(50);
    }
    const connectedGui = await readSelection(id);
    assert.equal(connectedGui.length, connectedCount);
    await mutate("selection_set", seed);
    await job(
      await mutate("mesh_process", {
        entityId: id,
        operation:
          kind === "pointcloud"
            ? {
                kind: "pointCloudEdit",
                action: "connectedSelection",
                neighborRadius: 1.01,
              }
            : {
                kind: "connectedSelection",
                allConnected: true,
                tolerance: 0.001,
                angleDegrees: 30,
              },
      }),
    );
    assert.deepEqual(await readSelection(id), connectedGui);
    if (kind === "mesh") {
      await clear();
      await control({
        action: "configure",
        tool: "wand",
        through: false,
        angleDegrees: 30,
        allConnected: false,
      });
      const THREE = await import("three");
      const camera = (await call("viewport_get")).result;
      const p = new THREE.Vector3(8.4, 8.4, 1)
        .applyMatrix4(
          new THREE.Matrix4().fromArray(camera.cameraWorldMatrix).invert(),
        )
        .applyMatrix4(new THREE.Matrix4().fromArray(camera.projectionMatrix));
      await page.mouse.click(
        box.x + ((p.x + 1) * box.width) / 2,
        box.y + ((1 - p.y) * box.height) / 2,
      );
      for (let i = 0; i < 100; i++) {
        if ((await readSelection(id)).length === 2) break;
        await page.waitForTimeout(50);
      }
      const wand = await readSelection(id);
      assert.equal(wand.length, 2);
      await mutate("selection_set", { entityId: id, triangles: [wand[0]] });
      await job(
        await mutate("mesh_process", {
          entityId: id,
          operation: {
            kind: "connectedSelection",
            tolerance: 0.001,
            angleDegrees: 30,
            allConnected: false,
          },
        }),
      );
      assert.deepEqual(await readSelection(id), wand);
      await page.getByText("More selection actions", { exact: true }).click();
      for (const [button, operation] of [
        ["Enlarge selection", "grow"],
        ["Shrink selection", "shrink"],
      ]) {
        await mutate("selection_set", seed);
        await page.getByRole("button", { name: button, exact: true }).click();
        await page.waitForTimeout(300);
        const gui = await readSelection(id);
        await mutate("selection_set", seed);
        await job(
          await mutate("mesh_process", {
            entityId: id,
            operation: { kind: "selectionMorphology", operation },
          }),
        );
        assert.deepEqual(await readSelection(id), gui, operation);
      }
      await page
        .getByRole("button", { name: "Select boundaries", exact: true })
        .click();
      await page.waitForTimeout(300);
      const boundaryState = (await call("scan_selection_get")).result;
      assert(boundaryState.boundaryPathCount > 0);
      const inventory = (
        await job(
          await mutate("mesh_process", {
            entityId: id,
            operation: {
              kind: "scanEdit",
              action: "inventory",
              tolerance: 0.001,
            },
          }),
        )
      ).result;
      const reportArtifact = (
        await call("artifact_read", {
          artifactId: inventory.artifact.artifactId,
        })
      ).result;
      const report = JSON.parse(
        Buffer.from(reportArtifact.base64, "base64").toString(),
      );
      assert.equal(
        report.inventory.boundaries.length,
        boundaryState.boundaryPathCount,
      );
      assert.equal(
        report.inventory.boundaries.reduce(
          (sum, path) => sum + path.points.length,
          0,
        ),
        boundaryState.boundaryCoordinateCount,
      );
      results.push({
        kind,
        wandCurvatureThreshold: true,
        boundaryGrowShrink: true,
      });
    }
    results.push({ kind, connectedGuiMcpEqual: true, connectedCount });
    const full = {
      kind: "rectangle",
      start: [0, 0],
      end: [box.width, box.height],
    };
    await select(full, true);
    assert.equal(
      (await call("scan_selection_get")).result.boundaryPathCount,
      0,
      "New selection clears the boundary overlay through both interfaces",
    );
    const all = await readSelection(id);
    await select(full, false);
    const visible = await readSelection(id);
    assert(
      visible.length < all.length,
      `${kind}: occluded layer excluded ${JSON.stringify({ all: all.length, visible: visible.length, camera: (await call("viewport_get")).result })}`,
    );
    const selectedSlots = visible.slice(0, 3);
    await mutate("selection_set", {
      entityId: id,
      [kind === "pointcloud" ? "points" : "triangles"]: selectedSlots,
    });
    await page
      .getByRole("group", { name: "Selection actions", exact: true })
      .getByRole("button", { name: "Hide selected", exact: true })
      .click();
    const hiddenGui = (await call("scan_selection_get")).result.hiddenCount;
    assert.equal(hiddenGui, selectedSlots.length);
    await select(full, true);
    assert(
      (await readSelection(id)).every((slot) => !selectedSlots.includes(slot)),
    );
    await control({ action: "reveal" });
    await mutate("selection_set", {
      entityId: id,
      [kind === "pointcloud" ? "points" : "triangles"]: selectedSlots,
    });
    await control({ action: "hide" });
    assert.equal(
      (await call("scan_selection_get")).result.hiddenCount,
      hiddenGui,
    );
    const newest = [visible[3]];
    const mark = (slots) =>
      mutate("selection_set", {
        entityId: id,
        [kind === "pointcloud" ? "points" : "triangles"]: slots,
      });
    await mark(newest);
    await control({ action: "hide" });
    const revealButton = page.getByRole("button", {
      name:
        kind === "pointcloud"
          ? "Show selected points"
          : "Show selected triangles",
      exact: true,
    });
    if (!(await revealButton.isVisible()))
      await page.getByText("More selection actions", { exact: true }).click();
    await revealButton.click();
    assert.deepEqual(await readSelection(id), newest);
    assert.equal(
      (await call("scan_selection_get")).result.hiddenCount,
      hiddenGui,
    );
    await control({ action: "reveal" });
    await mark(selectedSlots);
    await control({ action: "hide" });
    await mark(newest);
    await control({ action: "hide" });
    await control({ action: "revealSelected" });
    assert.deepEqual(await readSelection(id), newest);
    assert.equal(
      (await call("scan_selection_get")).result.hiddenCount,
      hiddenGui,
    );
    results.push({
      kind,
      showLastHiddenGuiMcpEqual: true,
      earlierHiddenBatchRetained: true,
    });
    await control({ action: "reveal" });
    await mutate("selection_set", {
      entityId: id,
      [kind === "pointcloud" ? "points" : "triangles"]: selectedSlots,
    });
    await control({ action: "isolate" });
    await select(full, true);
    assert.deepEqual(await readSelection(id), selectedSlots);
    await control({ action: "reveal" });
    await control({
      action: "configure",
      clip: { min: [-1, -1, -0.1], max: [9, 30, 2] },
    });
    await select(full, true);
    const clipped = await readSelection(id);
    assert(clipped.length > 0 && clipped.length < all.length);
    const stride = kind === "pointcloud" ? 3 : 9;
    assert(clipped.every((slot) => positions[slot * stride] <= 9));
    await control({ action: "configure", clip: null });
    await select(full, true);
    assert.deepEqual(await readSelection(id), all);
    for (const operation of ["copy", "cut"]) {
      await mark([0]);
      await page
        .getByRole("button", {
          name: operation === "copy" ? "Copy & Create" : "Cut & Create",
          exact: true,
        })
        .click();
      const guiProject = (await call("project_get")).result;
      assert.notEqual(guiProject.selectedId, id);
      const guiCopy = guiProject.selectedId;
      assert.equal(
        (await call("selection_get", { entityId: guiCopy })).result.count,
        0,
      );
      const signature = async (entityId) =>
        (
          await job(await call("object_geometry_digest", { entityId }))
        ).result.buffers.map(({ path, encoding, elements, sha256 }) => ({
          path,
          encoding,
          elements,
          sha256,
        }));
      const guiGeometry = await signature(guiCopy);
      await mutate("object_select", { entityId: id });
      assert.equal(
        (await call("selection_get", { entityId: id })).result.count,
        0,
      );
      await mutate("history_undo", {});
      await mutate("object_select", { entityId: id });
      await mark([0]);
      const mcpCopy = (
        await mutate("selection_edit", { entityId: id, operation })
      ).result.entityId;
      assert.equal((await call("project_get")).result.selectedId, mcpCopy);
      assert.equal(
        (await call("selection_get", { entityId: mcpCopy })).result.count,
        0,
      );
      assert.deepEqual(await signature(mcpCopy), guiGeometry);
      await mutate("history_undo", {});
      await mutate("object_select", { entityId: id });
      results.push({
        kind,
        operation,
        selectedCopyAndClearedSource: true,
        geometryGuiMcpEqual: true,
      });
    }
    results.push({
      kind,
      hiddenSourceSlots: true,
      isolate: true,
      clipSourceSlots: true,
      occlusion: { all: all.length, visible: visible.length },
    });
    await page.screenshot({
      path: fileURLToPath(new URL(`${kind}-selection.png`, out)),
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  ledger.result = { passed: true, results, errors };
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
    new URL("selection-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}
