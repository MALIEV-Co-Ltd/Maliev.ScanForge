import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const startedAt = new Date().toISOString();
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "scanforge-landmark-canvas-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/landmark-canvas-browser/", root);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport;
let failed;
let cleaningUp = false;
const mime = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  wasm: "application/wasm",
  json: "application/json",
  svg: "image/svg+xml",
};
const staticServer = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const file = new URL(
      path === "/" ? "index.html" : path.slice(1),
      new URL("dist/", root),
    );
    if (!file.href.startsWith(new URL("dist/", root).href))
      throw Error("Forbidden path");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        mime[file.pathname.split(".").pop()] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
staticServer.requestTimeout = 10000;
await new Promise((resolve, reject) => {
  staticServer.once("error", reject);
  staticServer.listen(0, "127.0.0.1", resolve);
});
const appPort = staticServer.address().port,
  origin = `http://127.0.0.1:${appPort}`;
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const bridgePort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
ledger.resources.push({
  kind: "http-server",
  pid: process.pid,
  executable: process.execPath,
  startedAt,
  port: appPort,
  bind: "127.0.0.1",
  purpose: "isolated built application",
});
const deadline = setTimeout(() => {
  failed = Error("Browser validation exceeded 4 minute lease");
  void cleanup();
}, 240000);
async function cleanup() {
  cleaningUp = true;
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await new Promise((resolve) => {
    staticServer.close(resolve);
    staticServer.closeAllConnections();
  });
  for (const port of [appPort, bridgePort]) {
    let closed = false;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      closed = true;
    }
    ledger.cleanup.push({ port, closed });
    assert(closed, `Port ${port} remained open`);
  }
  for (const resource of ledger.resources.filter((r) =>
    ["mcp-stdio-child", "disposable-browser"].includes(r.kind),
  )) {
    let exited = false;
    try {
      process.kill(resource.pid, 0);
    } catch {
      exited = true;
    }
    ledger.cleanup.push({ pid: resource.pid, exited });
    assert(exited, `${resource.kind} process still alive`);
  }
  await writeFile(
    evidence,
    JSON.stringify(
      { ...ledger, passed: !failed, error: failed?.message },
      null,
      2,
    ),
  );
}
try {
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
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "scanforge-browser-smoke", version: "1.0.0" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-stdio-child",
    pid: transport.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    port: bridgePort,
    bind: "127.0.0.1",
    purpose: "actual stdio SDK and browser bridge",
  });
  const discovered = await client.listTools();
  assert(discovered.tools.length >= 35);
  const guide = await client.readResource({ uri: "scanforge://agent-guide" });
  assert(guide.contents[0].text.includes("expectedRevision"));
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    kind: "disposable-browser",
    pid: browserServer.process().pid,
    executable: "installed Chrome",
    startedAt: new Date().toISOString(),
    purpose: "isolated profile and UI validation",
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE ERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !cleaningUp) {
      errors.push(message.text());
      console.error("BROWSER", message.text());
    }
  });
  page.on("requestfailed", (request) => {
    if (!cleaningUp && request.failure()?.errorText !== "net::ERR_ABORTED")
      console.error(
        "REQUEST FAILED",
        request.url().split("?")[0],
        request.failure()?.errorText,
      );
  });
  await page.goto(origin);
  assert.match(await page.title(), /ScanForge/i);
  const contextPolicy = await page.evaluate(() => {
    const portalInput = document.createElement("input");
    document.body.appendChild(portalInput);
    let customHandlerReached = false;
    portalInput.addEventListener("contextmenu", () => {
      customHandlerReached = true;
    });
    const targets = [
      document.body,
      document.querySelector(".workbench"),
      document.querySelector("button"),
      portalInput,
    ];
    const canceled = targets.map((target) => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    });
    portalInput.remove();
    return { canceled, customHandlerReached };
  });
  assert.deepEqual(
    contextPolicy.canceled,
    [true, true, true, true],
    "Chrome context menus must be disabled across the page, including ribbon, background and portal inputs",
  );
  assert.equal(
    contextPolicy.customHandlerReached,
    true,
    "Custom context handlers must still receive the event",
  );
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
  // Closing Settings must leave the paired session alive.
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const wire = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
    return wire;
  }
  async function mutate(name, args) {
    const state = await call("project_get");
    return call(name, {
      ...args,
      expectedRevision: state.revision,
      requestId: randomUUID(),
    });
  }
  async function job(receipt, expected = "succeeded") {
    const id = receipt.result.jobId;
    for (let i = 0; i < 120; i++) {
      const result = await call("job_get", { jobId: id });
      if (result.result.status !== "running") {
        assert.equal(result.result.status, expected, JSON.stringify(result));
        return expected === "succeeded" ? result.result.result : result.result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Geometry job failed to settle");
  }

  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  const entry = page.locator('[data-command="alignNPoints"]');
  assert.equal(await entry.isDisabled(), true);
  const commandAvailable = async () =>
    (await call("command_get")).result.commands.find(
      (command) => command.name === "ribbon:alignNPoints",
    ).available;
  assert.equal(await commandAvailable(), false);
  const geometry = async (entityId) => {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    const data = (
      await call("artifact_read", { artifactId: object.geometry.artifactId })
    ).result;
    return JSON.parse(Buffer.from(data.base64, "base64").toString());
  };
  const cases = [];
  ledger.cases = cases;
  const rectangle = [
    -20, -20, 0, 0, -20, 0, 0, 20, 0, -20, -20, 0, 0, 20, 0, -20, 20, 0,
  ];
  for (const kind of ["mesh", "pointcloud"]) {
    const sourcePoints =
      kind === "mesh"
        ? rectangle
        : [-18, -15, 0, -2, -15, 0, -10, 15, 0, -12, 5, 0];
    const translated = sourcePoints.map((v, i) => (i % 3 === 0 ? v + 40 : v));
    const project = {
      format: "maliev-scanforge",
      version: 1,
      name: "Canvas picks",
      units: "mm",
      entities: [
        {
          id: "moving",
          name: "Moving scan",
          kind,
          positions: sourcePoints,
          visible: true,
          color: "#abcdef",
          opacity: 1,
        },
        {
          id: "fixed",
          name: "Fixed scan",
          kind,
          positions: translated,
          visible: true,
          color: "#fedcba",
          opacity: 1,
        },
      ],
    };
    const upload = await call("artifact_put", {
      name: "canvas.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(project)).toString("base64"),
    });
    await job(
      await mutate("project_import", {
        artifactId: upload.result.artifactId,
        replace: true,
      }),
    );
    await mutate("object_select", {});
    assert.equal(
      await entry.isDisabled(),
      true,
      "Ambiguous sources must not launch",
    );
    assert.equal(await commandAvailable(), false);
    await mutate("object_select", { entityId: "moving" });
    assert.equal(await entry.isDisabled(), false);
    assert.equal(await commandAvailable(), true);
    assert.equal(
      (await call("application_inspect")).result.contextMenuPolicy,
      "application-only",
    );
    if (kind === "mesh") {
      await page.evaluate(() => {
        globalThis.__panContextEvents = [];
        document.addEventListener(
          "contextmenu",
          (event) => globalThis.__panContextEvents.push(event.defaultPrevented),
          true,
        );
      });
      const mainCanvas = page.locator(".canvas-area > .viewport > canvas");
      const canvasBox = await mainCanvas.boundingBox();
      const ribbonBox = await page
        .getByRole("tab", { name: "Scan Data", exact: true })
        .boundingBox();
      await page.mouse.move(
        canvasBox.x + canvasBox.width * 0.6,
        canvasBox.y + canvasBox.height * 0.6,
      );
      await page.mouse.down({ button: "right" });
      await page.mouse.move(
        ribbonBox.x + ribbonBox.width / 2,
        ribbonBox.y + ribbonBox.height / 2,
        { steps: 8 },
      );
      await page.mouse.up({ button: "right" });
      const nativeEvents = await page.evaluate(
        () => globalThis.__panContextEvents,
      );
      assert(
        nativeEvents.every(Boolean),
        "Any context event from pan release must cancel Chrome's menu",
      );
      // Chrome may omit contextmenu entirely for a drag. A plain ribbon right
      // click must still dispatch and be canceled by the document policy.
      await page
        .getByRole("tab", { name: "Scan Data", exact: true })
        .click({ button: "right" });
      const ribbonEvents = await page.evaluate(
        () => globalThis.__panContextEvents,
      );
      assert(
        ribbonEvents.length > 0 && ribbonEvents.every(Boolean),
        "Ribbon right-click must cancel Chrome's menu",
      );
      // Stationary canvas right-click still opens the application's custom menu.
      await page.mouse.click(
        canvasBox.x + canvasBox.width * 0.7,
        canvasBox.y + canvasBox.height * 0.7,
        { button: "right" },
      );
      const ownMenu = page.getByRole("menu", {
        name: "Viewport selection actions",
      });
      await ownMenu.waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await ownMenu.waitFor({ state: "hidden" });
    }
    const before = (await call("project_get")).result.undo;
    const sourceBefore = await geometry("moving");
    const fixedBefore = await geometry("fixed");
    await entry.click();
    assert.equal((await call("landmark_get")).result.fixedId, "fixed");
    assert.equal(
      await commandAvailable(),
      false,
      "Active session must block duplicate command launch",
    );
    const dialog = page.getByRole("complementary", {
      name: "N-points alignment",
    });
    await dialog.waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Pick moving points", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Pick fixed points", exact: true })
        .count(),
      0,
    );
    const fixedViewBox = await page
      .locator('[data-landmark-view="fixed"]')
      .boundingBox();
    const movingViewBox = await page
      .locator('[data-landmark-view="moving"]')
      .boundingBox();
    assert(
      fixedViewBox.y < movingViewBox.y,
      "Fixed must be top-right and Moving bottom-right",
    );
    assert.equal(await page.locator(".canvas-area canvas").count(), 3);
    const mainBefore = (await call("viewport_get")).result;
    for (const side of ["moving", "fixed"]) {
      const center = side === "fixed" ? 40 : 0;
      await mutate("viewport_control", {
        view: side,
        action: "camera",
        position: [center, 0, 160],
        target: [center, 0, 0],
        up: [0, 1, 0],
        projection: "perspective",
        zoom: 1,
      });
    }
    assert.deepEqual(
      (await call("viewport_get")).result.position,
      mainBefore.position,
      "Picking cameras must be independent of result camera",
    );
    const captures = [];
    await page.evaluate(() => {
      globalThis.__lastCanvasPointer = null;
      for (const canvas of document.querySelectorAll(
        ".landmark-viewport > canvas",
      )) {
        canvas.addEventListener("pointerup", (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          globalThis.__lastCanvasPointer = {
            x: (e.clientX - r.left) / r.width,
            y: (e.clientY - r.top) / r.height,
          };
        });
      }
    });
    async function pick(side, px, py) {
      const canvas = page.locator(`[data-landmark-view="${side}"] canvas`);
      const box = await canvas.boundingBox();
      assert(box);
      const view = (await call("viewport_get", { view: side })).result;
      const halfHeight = 160 * Math.tan((42 * Math.PI) / 360);
      const aspect = view.viewport.width / view.viewport.height;
      const x = 0.5 + px / (2 * halfHeight * aspect),
        y = 0.5 - py / (2 * halfHeight);
      await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
      const actual = await page.evaluate(() => globalThis.__lastCanvasPointer);
      assert(actual, "Click must reach isolated canvas");
      const hits = (
        await call("viewport_pick", { view: side, ...actual, maxHits: 20 })
      ).result.hits;
      assert(
        hits.length > 0 && hits.every((hit) => hit.entityId === side),
        "Picking view must contain only its object",
      );
      const hit = hits[0];
      const state = (await call("landmark_get")).result;
      assert.equal(
        state.picks.length,
        captures.length + 1,
        `${kind} ${side} click must append exactly one pick`,
      );
      const picked = state.picks.at(-1);
      assert.equal(picked.entityId, side);
      assert.deepEqual(
        picked.point,
        hit.point.map(Math.fround),
        "GUI/MCP original-pose picks must agree",
      );
      captures.push({ side, coordinates: actual, hit, pick: picked });
    }
    async function ready(count) {
      for (let i = 0; i < 200; i++) {
        const state = (await call("landmark_get")).result;
        assert.notEqual(
          state.previewStatus,
          "error",
          state.previewError ?? "preview error",
        );
        if (state.previewStatus === "ready") {
          assert.equal(state.pairCount, count);
          assert.equal(state.registration.pairs, count);
          return state;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error("Automatic landmark preview did not settle");
    }
    for (const side of ["moving", "fixed"]) {
      for (const [px, py] of [
        [-18, -15],
        [-2, -15],
        [-10, 15],
      ])
        await pick(side, px, py);
    }
    const three = await ready(3);
    assert(three.registration.rms < 0.001);
    assert.equal((await call("project_get")).result.undo, before);
    await pick("moving", -12, 5);
    assert.equal(
      (await call("landmark_get")).result.preview,
      false,
      "Incomplete fourth pair invalidates acceptance",
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "OK", exact: true })
        .isDisabled(),
      true,
    );
    await pick("fixed", -12, 5);
    const gui = await ready(4);
    assert(gui.registration.rms < 0.001);
    assert.equal(gui.canRemove, true);
    assert.deepEqual(gui.views.moving.entityIds, ["moving"]);
    assert.deepEqual(gui.views.fixed.entityIds, ["fixed"]);
    assert.deepEqual(gui.views.moving.markers[0].point, gui.picks[0].point);
    assert.deepEqual(await geometry("moving"), sourceBefore);
    assert.deepEqual(await geometry("fixed"), fixedBefore);
    // Each view owns removal: fixed Undo cannot touch moving picks, and a
    // numbered moving marker can be deselected without adding a canvas pick.
    await page
      .getByRole("button", { name: "Remove last fixed point", exact: true })
      .click();
    let deselected = (await call("landmark_get")).result;
    assert.equal(
      deselected.picks.filter((pick) => pick.entityId === "moving").length,
      4,
    );
    assert.equal(
      deselected.picks.filter((pick) => pick.entityId === "fixed").length,
      3,
    );
    assert.equal(deselected.preview, false);
    await page
      .locator('[data-landmark-view="moving"]')
      .getByRole("button", {
        name: "Remove alignment landmark M4",
        exact: true,
      })
      .click();
    await ready(3);
    for (const capture of captures.slice(-2))
      await mutate("landmark_edit", {
        action: "pick",
        entityId: capture.side,
        point: capture.pick.point,
      });
    await ready(4);
    await page
      .getByRole("button", { name: "Clear fixed points", exact: true })
      .click();
    deselected = (await call("landmark_get")).result;
    assert.equal(deselected.picks.length, 4);
    assert(deselected.picks.every((pick) => pick.entityId === "moving"));
    await page
      .getByRole("button", { name: "Clear moving points", exact: true })
      .click();
    assert.equal((await call("landmark_get")).result.picks.length, 0);
    for (const capture of captures)
      await mutate("landmark_edit", {
        action: "pick",
        entityId: capture.side,
        point: capture.pick.point,
      });
    assert.deepEqual((await ready(4)).registration, gui.registration);
    const divider = page.getByRole("separator", {
      name: "Resize alignment views",
    });
    assert.equal(
      await page.locator(".landmark-result-label").count(),
      0,
      "No caption may peek behind the floating panel",
    );
    const area = await page.locator(".canvas-area").boundingBox();
    const dividerBox = await divider.boundingBox();
    const cameras = {};
    for (const view of ["main", "moving", "fixed"])
      cameras[view] = (await call("viewport_get", { view })).result.position;
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2,
      dividerBox.y + dividerBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      area.x + area.width * 0.55,
      dividerBox.y + dividerBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    assert(
      Math.abs(
        (await call("landmark_get")).result.layout.referenceWidthPercent - 45,
      ) < 0.2,
      "Dragging must update shared layout",
    );
    await divider.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      (await call("landmark_get")).result.layout.referenceWidthPercent,
      50,
    );
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      (await call("landmark_get")).result.layout.referenceWidthPercent,
      20,
    );
    await mutate("landmark_edit", {
      action: "view-layout",
      referenceWidthPercent: 40,
    });
    const resized = (await call("landmark_get")).result;
    assert.equal(resized.layout.referenceWidthPercent, 40);
    assert.deepEqual(
      resized.registration,
      gui.registration,
      "Resize must preserve alignment preview",
    );
    assert.deepEqual(
      resized.picks,
      gui.picks,
      "Resize must preserve landmarks",
    );
    assert.equal((await call("project_get")).result.undo, before);
    for (const view of ["main", "moving", "fixed"])
      assert.deepEqual(
        (await call("viewport_get", { view })).result.position,
        cameras[view],
        "Resize must preserve camera position",
      );
    const mainBox = await page
      .locator(".canvas-area > .viewport")
      .boundingBox();
    const referenceBox = await page
      .locator(".landmark-picking-views")
      .boundingBox();
    assert(mainBox.width >= 360 && referenceBox.width >= 220);
    assert(
      Math.abs(mainBox.x + mainBox.width - referenceBox.x) < 2,
      "Views must share one boundary",
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`${kind}-three-views.png`, artifactDir)),
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    // Let the existing 120ms control background transition finish before visual evidence.
    await page.waitForTimeout(150);
    await page.screenshot({
      path: fileURLToPath(new URL(`${kind}-three-views-dark.png`, artifactDir)),
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    assert.equal((await call("landmark_get")).result.previewStatus, "idle");
    await job(
      await mutate("landmark_preview", { parallel: true, workerCount: 2 }),
    );
    const agent = (await call("landmark_get")).result;
    assert.deepEqual(agent.registration, gui.registration);
    // An incomplete edit supersedes any current result and cannot publish late.
    await mutate("landmark_edit", { action: "remove-last" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await call("landmark_get")).result.preview, false);
    await mutate("landmark_edit", {
      action: "pick",
      entityId: "fixed",
      point: captures.at(-1).pick.point,
    });
    await ready(4);
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await call("landmark_get")).result.active, false);
    assert.equal((await call("project_get")).result.undo, before + 1);
    const accepted = await geometry("moving");
    accepted.positions.forEach((value, i) =>
      assert(
        Math.abs(value - translated[i]) < 0.001,
        `${kind} accepted coordinate ${i}`,
      ),
    );
    assert.deepEqual(await geometry("fixed"), fixedBefore);
    await mutate("history_undo", {});
    assert.deepEqual(await geometry("moving"), sourceBefore);
    await mutate("command_run", { name: "ribbon:alignNPoints" });
    assert.equal((await call("landmark_get")).result.movingId, "moving");
    // Hold callbacks even for retained/reused workers, avoiding network-cache timing.
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Worker.prototype,
        "onmessage",
      );
      if (!globalThis.__landmarkWorkerWrapped) {
        Object.defineProperty(Worker.prototype, "onmessage", {
          ...descriptor,
          set(callback) {
            const worker = this;
            descriptor.set.call(
              worker,
              callback == null
                ? callback
                : (event) => {
                    const deliver = () => callback.call(worker, event);
                    if (globalThis.__holdLandmarkMessages)
                      globalThis.__heldLandmarkMessages.push(deliver);
                    else deliver();
                  },
            );
          },
        });
        globalThis.__landmarkWorkerWrapped = true;
      }
      globalThis.__heldLandmarkMessages = [];
      globalThis.__holdLandmarkMessages = true;
    });
    const releaseWorker = () =>
      page.evaluate(() => {
        globalThis.__holdLandmarkMessages = false;
        for (const deliver of globalThis.__heldLandmarkMessages.splice(0))
          deliver();
      });
    for (const capture of captures.slice(0, 6))
      await mutate("landmark_edit", {
        action: "pick",
        entityId: capture.side,
        point: capture.pick.point,
      });
    await page.waitForFunction(
      () => globalThis.__heldLandmarkMessages.length > 0,
    );
    assert.equal((await call("landmark_get")).result.previewStatus, "pending");
    await mutate("landmark_edit", {
      action: "view-layout",
      referenceWidthPercent: 42,
    });
    assert.equal(
      (await call("landmark_get")).result.previewStatus,
      "pending",
      "Resize must not abort or restart a solve",
    );
    await releaseWorker();
    assert.equal(
      (await ready(3)).layout.referenceWidthPercent,
      42,
      "Pending result must retain the latest divider position",
    );
    await mutate("landmark_edit", { action: "remove-last" });
    await page.evaluate(() => {
      globalThis.__holdLandmarkMessages = true;
    });
    await mutate("landmark_edit", {
      action: "pick",
      entityId: "fixed",
      point: captures[5].pick.point,
    });
    await page.waitForFunction(
      () => globalThis.__heldLandmarkMessages.length > 0,
    );
    assert.equal((await call("landmark_get")).result.previewStatus, "pending");
    await mutate("landmark_edit", { action: "remove-last" });
    await releaseWorker();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await call("landmark_get")).result.previewStatus, "idle");
    assert.equal(
      (await call("landmark_get")).result.preview,
      false,
      "Canceled worker cannot publish late",
    );
    await mutate("landmark_edit", {
      action: "pick",
      entityId: "fixed",
      point: captures[5].pick.point,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await call("landmark_get")).result.active, false);
    assert.equal(await page.locator(".canvas-area canvas").count(), 1);
    assert.deepEqual(await geometry("moving"), sourceBefore);
    assert.equal((await call("project_get")).result.undo, before);
    cases.push({
      kind,
      captures,
      registration: gui.registration,
      commandEntry: true,
      guiMcpPreviewEqual: true,
      acceptUndo: true,
    });
  }
  ledger.steps = [
    "Actual mesh and point-cloud canvas clicks preserve native Float32 pick records",
    "Three independent views isolate moving/reference geometry and original-pose picks",
    "Divider drag, keyboard limits and MCP resizing preserve preview, picks, cameras and history; pending solves retain resized layout",
    "No result caption overlaps behind the panel",
    "Browser context menus are canceled app-wide; pan release over ribbon is safe and stationary canvas right-click still opens the application menu",
    "Fixed canvas is above Moving; direct picks need no mode buttons; per-view undo, marker deselection and clear preserve the other side",
    "Third and fourth complete pairs update automatically; incomplete edits invalidate acceptance",
    "Read-only MCP ray queries agree with GUI picks",
    "Picking and cancel preserve modeling history",
    "Ribbon and MCP command share source eligibility and active-session admission",
    "Real canvas picks produce equal GUI/MCP previews; accept translates only the moving scan; undo restores it",
  ];
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({
    path: fileURLToPath(new URL("browser-validation.png", artifactDir)),
  });
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  failed = error;
  throw error;
} finally {
  await cleanup();
}
