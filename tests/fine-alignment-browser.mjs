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
  let helpVerified = false;
  const openFine = async (overlap = 50, samples = 73) => {
    await mutate("command_run", { name: "ribbon:fineAlign" });
    const menu = page.getByRole("complementary", { name: "Tool options" });
    const bounds = await menu.boundingBox();
    assert(bounds.width <= 280, JSON.stringify(bounds));
    const hasResult = await menu
      .getByRole("status", { name: "Mesh operation result" })
      .count();
    assert(bounds.height <= 560, JSON.stringify(bounds));
    if (!hasResult) assert(bounds.height < 390, JSON.stringify(bounds));
    assert.equal(
      await menu
        .getByText("Additional fixed surfaces", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await menu
        .getByText("Surface refinement samples", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await menu
        .getByRole("heading", { name: /^Fine alignment/i })
        .filter({ visible: true })
        .count(),
      1,
    );
    if (!hasResult)
      await page.screenshot({ path: join(out, "compact-fine-alignment.png") });
    if (!helpVerified) {
      const help = menu.getByRole("button", {
        name: "Fine alignment help",
        exact: true,
      });
      const popup = page
        .getByRole("tooltip")
        .filter({ hasText: "Fine alignment help" });
      assert.equal(await popup.isVisible(), false);
      await help.hover();
      await popup.waitFor({ state: "visible" });
      assert.equal((await menu.boundingBox()).height, bounds.height);
      const helpBounds = await popup.boundingBox();
      assert(helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 1500);
      assert(helpBounds.y >= 0 && helpBounds.y + helpBounds.height <= 1000);
      await page.mouse.move(helpBounds.x + 30, helpBounds.y + 30);
      assert(await popup.isVisible());
      await page.screenshot({ path: join(out, "alignment-help-popover.png") });
      await page.mouse.move(10, 150);
      await popup.waitFor({ state: "hidden" });
      await help.focus();
      await popup.waitFor({ state: "visible" });
      await help.press("Escape");
      await popup.waitFor({ state: "hidden" });
      await menu.getByLabel("Target overlap RMS (mm)", { exact: true }).focus();
      await help.click();
      await popup.waitFor({ state: "visible" });
      await menu.getByLabel("Target overlap RMS (mm)", { exact: true }).click();
      await popup.waitFor({ state: "hidden" });
      helpVerified = true;
    }
    assert.equal(
      await page
        .getByRole("button", {
          name: "Refine indexed mesh surfaces",
          exact: true,
        })
        .isVisible(),
      false,
    );
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
    const advanced = page.locator("details").filter({
      has: page.getByText("Advanced ICP settings", { exact: true }),
    });
    if (!(await advanced.evaluate((element) => element.open)))
      await page.getByText("Advanced ICP settings", { exact: true }).click();
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
    await page.getByText("Advanced ICP settings", { exact: true }).click();
  };
  await load(false, false, true);
  await mutate("command_run", { name: "ribbon:surfaceRefinement" });
  const refinementMenu = page.getByRole("complementary", {
    name: "Tool options",
  });
  assert(
    await refinementMenu
      .getByText("Surface refinement samples", { exact: true })
      .isVisible(),
  );
  assert.equal(
    await refinementMenu
      .getByText("Expected overlap (%)", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await refinementMenu
      .getByText("ICP maximum iterations", { exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: join(out, "compact-surface-refinement.png") });
  await mutate("ui_set", { workspace: "fineAlign", toolPanelOpen: true });
  await page.setViewportSize({ width: 700, height: 900 });
  const narrowMenu = await refinementMenu.boundingBox();
  assert(
    narrowMenu.x >= 0 && narrowMenu.x + narrowMenu.width <= 700,
    JSON.stringify(narrowMenu),
  );
  assert(
    narrowMenu.y >= 0 && narrowMenu.y + narrowMenu.height <= 900,
    JSON.stringify(narrowMenu),
  );
  assert(
    await refinementMenu
      .getByRole("button", { name: "Fine align scans", exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: join(out, "compact-narrow.png") });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openFine();
  await page
    .getByRole("button", { name: "Fine align scans", exact: true })
    .click();
  const result = page.getByRole("status", {
    name: "Mesh operation result",
    exact: true,
  });
  const captureResult = async (name) => {
    const menu = page.getByRole("complementary", {
      name: "Tool options",
      exact: true,
    });
    for (const [theme, width, height] of [
      ["light", 1500, 1000],
      ["dark", 1500, 1000],
      ["dark", 700, 900],
    ]) {
      await mutate("settings_set", { patch: { theme } });
      await page.setViewportSize({ width, height });
      await result.getByRole("heading", { level: 4 }).scrollIntoViewIfNeeded();
      const metrics = await result.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return {
          width: bounds.width,
          overflow: el.scrollWidth > el.clientWidth,
          rows: [...el.querySelectorAll(".mesh-result-metrics > dd")]
            .filter((x) => x.getBoundingClientRect().height > 0)
            .map((x) => x.getBoundingClientRect().right <= bounds.right + 1),
        };
      });
      assert.equal(metrics.overflow, false, JSON.stringify(metrics));
      assert(metrics.rows.every(Boolean), JSON.stringify(metrics));
      if (width === 700)
        assert(
          await result
            .locator("dt")
            .nth(4)
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return !!document
                .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
                ?.closest(".mesh-operation-result");
            }),
          "Viewport tools must not overlay result rows",
        );
      assert.equal(
        await result.getByRole("heading", { level: 4 }).isVisible(),
        true,
      );
      await menu.screenshot({
        path: join(out, `${name}-${theme}-${width}-menu.png`),
      });
      await page.screenshot({
        path: join(out, `${name}-${theme}-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    await mutate("settings_set", { patch: { theme: "light" } });
    await result.getByText("Diagnostics", { exact: true }).click();
    await result.getByText("Matching", { exact: true }).waitFor();
    assert.equal(
      await result
        .locator('dl[aria-label="Operation diagnostics"]')
        .isVisible(),
      true,
    );
    await result
      .locator('dl[aria-label="Operation diagnostics"]')
      .screenshot({ path: join(out, `${name}-diagnostics.png`) });
    await result.getByText("Diagnostics", { exact: true }).click();
  };
  await result.getByText(/Target accuracy reached/).waitFor();
  const guiResult = await result.innerText();
  assert.match(guiResult, /Target RMS\s+0\.02000 mm/);
  const guiGeometry = await geometry();
  await result.getByRole("heading", { level: 4 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "target-reached.png") });
  await captureResult("target-reached");
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
    .getByRole("button", { name: "Fine align scans", exact: true })
    .click();
  await result.getByText(/Stopped improving/).waitFor();
  await result.getByRole("heading", { level: 4 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "stopped-improving.png") });
  await captureResult("stopped-improving");
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
  const beforeInsufficient = await geometry();
  const insufficientRevision = (await call("project_get")).revision;
  await page
    .getByRole("button", { name: "Fine align scans", exact: true })
    .click();
  await result
    .getByRole("alert")
    .getByText(/Insufficient overlap within the search distance/)
    .waitFor();
  await result.getByRole("heading", { level: 4 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "insufficient-overlap.png") });
  await result.screenshot({
    path: join(out, "insufficient-overlap-result.png"),
  });
  assert.deepEqual(await geometry(), beforeInsufficient);
  assert.equal((await call("project_get")).revision, insufficientRevision);
  const insufficient = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 80 },
    }),
  );
  assert.equal(insufficient.registration.overlapSatisfied, false);
  assert.equal(insufficient.registration.applied, false);
  assert.equal(insufficient.registration.converged, false);
  assert.equal(
    insufficient.registration.terminationReason,
    "insufficientOverlap",
  );
  assert.equal(insufficient.registration.targetReached, false);
  assert.equal(insufficient.registration.overlapPoints, 400);
  assert.equal(insufficient.registration.requiredOverlapPoints, 640);
  assert.deepEqual(await geometry(), beforeInsufficient);
  assert.equal((await call("project_get")).revision, insufficientRevision);
  const defaults = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { kind: "icp" },
    }),
  );
  const explicitDefaults = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { kind: "icp", maxDistance: 10 },
    }),
  );
  assert.deepEqual(defaults.registration, explicitDefaults.registration);
  assert.equal(defaults.registration.rejectedPoints, 400);
  assert.equal(defaults.registration.applied, false);
  assert.equal(defaults.registration.overlapPercent, 85);
  assert.deepEqual(await geometry(), beforeInsufficient);
  assert.equal((await call("project_get")).revision, insufficientRevision);
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
  assert.deepEqual(errors, []);
  const meshProject = {
    format: "maliev-scanforge",
    version: 1,
    name: "Thin-wall overlap",
    units: "mm",
    entities: [
      {
        ...cloud(
          "moving",
          [2, 2, 0.02, 4, 2, 0.02, 2, 4, 0.02, 2, 2, 0.3, 2, 4, 0.3, 4, 2, 0.3],
        ),
        kind: "mesh",
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      },
      { ...cloud("fixed", [0, 0, 0, 20, 0, 0, 0, 20, 0]), kind: "mesh" },
    ],
  };
  const meshArtifact = (
    await call("artifact_put", {
      name: "thin-wall.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(meshProject)).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: meshArtifact.artifactId,
      replace: true,
    }),
  );
  await mutate("object_select", { entityId: "moving" });
  await openFine(85, 73);
  const beforeGuard = await geometry();
  const beforeRevision = (await call("project_get")).revision;
  await page
    .getByRole("button", { name: "Fine align scans", exact: true })
    .click();
  await result
    .getByText(/Insufficient compatible overlap/)
    .first()
    .waitFor();
  assert.deepEqual(await geometry(), beforeGuard);
  assert.equal((await call("project_get")).revision, beforeRevision);
  const guarded = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 85 },
    }),
  );
  assert.equal(guarded.registration.applied, false);
  assert.equal(guarded.registration.terminationReason, "insufficientOverlap");
  assert.equal(guarded.registration.matching, "fullTargetSurface");
  assert.equal(guarded.registration.rejectedNormalPoints, 3);
  assert.deepEqual(await geometry(), beforeGuard);
  assert.equal((await call("project_get")).revision, beforeRevision);
  await page.getByLabel("Expected overlap (%)", { exact: true }).fill("50");
  await page
    .getByLabel("Target overlap RMS (mm)", { exact: true })
    .fill("0.01");
  await page
    .getByRole("button", { name: "Fine align scans", exact: true })
    .click();
  await result.getByText(/Target accuracy reached/).waitFor();
  const surfaceGui = await geometry();
  await mutate("history_undo");
  const surfaceMcp = await job(
    await mutate("mesh_process", {
      entityId: "moving",
      targetId: "fixed",
      operation: { ...operation, overlapPercent: 50, targetRms: 0.01 },
    }),
  );
  assert.equal(surfaceMcp.registration.matching, "fullTargetSurface");
  assert.equal(surfaceMcp.registration.normalCompatibility, true);
  assert(surfaceMcp.registration.overlapRms < 1e-6);
  assert(surfaceMcp.registration.wholeCloudRms > 0.15);
  assert.deepEqual(await geometry(), surfaceGui);
  await result.getByRole("heading", { level: 4 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "surface-overlap.png") });
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    origin,
    browser: "Browser plugin not available; isolated Playwright Chrome",
    guiResult,
    mcp: mcp.registration,
    plateau: plateau.registration,
    insufficient: insufficient.registration,
    defaults: defaults.registration,
    explicitDefaults: explicitDefaults.registration,
    precisionRuns,
    guarded: guarded.registration,
    surface: surfaceMcp.registration,
    errors,
    checks: [
      "help icon hover, pointer transfer, keyboard focus, Escape, click and outside dismissal",
      "help top layer stays within viewport without growing the menu",
      "compact default panel width <= 280px and height < 390px",
      "separate fine alignment and surface refinement controls through command_run and ui_set",
      "narrow viewport panel remains within browser bounds",
      "GUI target editing",
      "real worker",
      "full target despite targetSampleSize:3",
      "all-source RMS",
      "GUI/MCP identical geometry",
      "kind-only MCP uses the same 10 mm application search distance",
      "target and plateau status",
      "Undo/Redo",
      "surface matching and normal rejection",
      "insufficient compatible overlap leaves revision and history unchanged",
      "surface GUI/MCP identical geometry",
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
