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
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5174";
const out = join(tmpdir(), `scanforge-owner-global-${randomUUID()}`);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let transport, client, browserServer, browser;
const timeout = setTimeout(() => void browserServer?.close(), 900000);
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
  const discovered = await client.listTools();
  for (const name of [
    "global_alignment_preview",
    "global_alignment_state",
    "alignment_preview",
    "alignment_apply",
    "object_geometry_digest",
  ])
    assert(
      discovered.tools.some((t) => t.name === name),
      "Missing MCP tool " + name,
    );
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
    const OriginalWorker = window.Worker,
      records = [];
    window.__alignmentValidationWorkers = records;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        this.record = {
          url: String(url),
          name: options?.name,
          createdAt: Date.now(),
          terminatedAt: null,
        };
        records.push(this.record);
      }
      terminate() {
        this.record.terminatedAt ??= Date.now();
        return super.terminate();
      }
    };
  });
  const errors = [],
    warnings = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (["warning", "error"].includes(m.type()))
      (m.text().startsWith("WARNING: Multiple instances of Three.js")
        ? warnings
        : errors
      ).push(m.text());
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
  await page.getByText(/Connected.*agents control this workspace/).waitFor();
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
    for (let i = 0; i < 1200; i++) {
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

  const digests = async (ids) => {
    const output = [];
    for (const entityId of ids) {
      const result = await job(
        await call("object_geometry_digest", { entityId }),
      );
      output.push({
        entityId,
        buffers: result.buffers.map(({ path, encoding, elements, sha256 }) => ({
          path,
          encoding,
          elements,
          sha256,
        })),
      });
    }
    return output;
  };
  const checks = [];
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles(
      [1, 2, 3].map(
        (i) => "C:/repo/alignment-example-files/scan-" + i + ".stl",
      ),
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  for (let i = 0; i < 2400; i++) {
    const state = (await call("session_get")).result;
    if (!state.busy && (await call("project_get")).result.objects.length === 3)
      break;
    if (i === 2399) throw Error("Owner STL import timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
  const before = (await call("project_get")).result;
  const ids = before.objects.map((o) => o.id);
  const baselineHistory = (await call("history_get")).result;
  const baselineDigests = await digests(ids);
  await mutate("ui_set", { globalAlignmentOpen: true });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const frames = [];
  let final;
  const t = Date.now();
  for (let i = 0; i < 3600; i++) {
    const state = (await call("global_alignment_state")).result;
    if (state.progress && frames.at(-1)?.sequence !== state.progress.sequence) {
      frames.push({ ...state.progress, elapsedMs: Date.now() - t });
      if (frames.length <= 3)
        await page.screenshot({
          path: join(out, "progress-" + frames.length + ".png"),
        });
    }
    if (state.state === "preview") {
      final = state;
      break;
    }
    const session = (await call("session_get")).result;
    if (i % 10 === 0)
      await writeFile(
        join(out, "journal.json"),
        JSON.stringify(
          {
            elapsedMs: Date.now() - t,
            state,
            frames,
            jobs: session.jobs,
            errors,
          },
          null,
          2,
        ),
      );
    const succeeded = session.jobs.find(
      (j) =>
        j.command === "global_alignment_preview" && j.status === "succeeded",
    );
    if (succeeded && state.state === "idle") {
      const job = (await call("job_get", { jobId: succeeded.jobId })).result;
      await writeFile(
        join(out, "lost-preview.json"),
        JSON.stringify({ state, job, frames, errors }, null, 2),
      );
      throw Error("Completed preview was unexpectedly discarded");
    }
    const failed = session.jobs.find(
      (j) =>
        j.command === "global_alignment_preview" &&
        ["failed", "cancelled"].includes(j.status),
    );
    if (failed) {
      await writeFile(
        join(out, "failure.json"),
        JSON.stringify({ failed, frames, session }, null, 2),
      );
      throw Error(JSON.stringify(failed));
    }
    if (Date.now() - t > 360000) throw Error("Owner alignment lease expired");
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(final, "Missing owner final preview");
  await mutate("viewport_set", { view: "fit" });
  await mutate("viewport_set", { view: "top" });
  await page.screenshot({ path: join(out, "owner-preview.png") });
  assert.deepEqual(
    await digests(ids),
    baselineDigests,
    "global preview mutated original buffers",
  );
  const workersBeforeApply = await page.evaluate(
    () =>
      window.__alignmentValidationWorkers.filter((w) =>
        /global-|datum-transform/.test(w.url),
      ).length,
  );
  const globalApplied = (
    await mutate("global_alignment_apply", { previewId: final.previewId })
  ).result;
  assert.deepEqual(globalApplied.outer, final.outer);
  assert.equal(
    await page.evaluate(
      () =>
        window.__alignmentValidationWorkers.filter((w) =>
          /global-|datum-transform/.test(w.url),
        ).length,
    ),
    workersBeforeApply,
    "cached Apply started new workers",
  );
  const globalDigests = await digests(ids);
  assert.notDeepEqual(globalDigests, baselineDigests);
  for (let i = 0; i < ids.length; i++)
    assert.deepEqual(
      globalDigests[i].buffers.find((b) => b.path === "indexedMesh.triangles"),
      baselineDigests[i].buffers.find(
        (b) => b.path === "indexedMesh.triangles",
      ),
    );
  assert.equal(
    (await call("history_get")).result.cursor,
    baselineHistory.cursor + 1,
  );
  await mutate("history_undo");
  assert.deepEqual(await digests(ids), baselineDigests);
  await mutate("history_redo");
  assert.deepEqual(await digests(ids), globalDigests);
  checks.push(
    "full-buffer original preservation; cached global Apply; exact Undo/Redo and unchanged topology",
  );
  await mutate("command_run", { name: "ribbon:align" });
  await page.getByLabel("Coordinate setup method").selectOption("automatic");
  for (const name of ["scan-1.stl", "scan-2.stl"])
    await page
      .getByRole("checkbox", { name: "Move " + name, exact: true })
      .check();
  await page
    .getByRole("button", { name: "Preview alignment", exact: true })
    .click();
  for (let i = 0; i < 1200; i++) {
    const alerts = await page.getByRole("alert").allTextContents();
    if (alerts.length) {
      await page.screenshot({ path: join(out, "cad-failure.png") });
      await writeFile(
        join(out, "cad-failure.json"),
        JSON.stringify(
          { alerts, session: (await call("session_get")).result },
          null,
          2,
        ),
      );
      throw Error(alerts.join("; "));
    }
    if (
      await page
        .getByRole("status")
        .filter({ hasText: "Alignment preview ready" })
        .count()
    )
      break;
    if (i === 1199) throw Error("CAD preview timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  await mutate("viewport_set", { view: "fit" });
  await mutate("viewport_set", { view: "iso" });
  await page.screenshot({ path: join(out, "owner-cad-setup.png") });
  const cadJob = (await call("session_get")).result.jobs.find(
    (j) => j.command === "alignment_preview" && j.status === "succeeded",
  );
  assert(cadJob, "Missing completed CAD setup job");
  const cadSetup = (await call("job_get", { jobId: cadJob.jobId })).result
    .result;
  assert(cadSetup.automatic.planeSupportPercent >= 8);
  assert.equal(cadSetup.targets.length, 3);
  assert(
    Math.abs(Math.min(...cadSetup.targets.map((t) => t.bounds.min[2]))) <
      0.0001,
  );
  assert.deepEqual(
    await digests(ids),
    globalDigests,
    "CAD preview mutated registered buffers",
  );
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply alignment", exact: true })
    .waitFor({ state: "hidden", timeout: 120000 });
  const cadAppliedJob = (await call("session_get")).result.jobs.find(
    (j) => j.command === "alignment_apply" && j.status === "succeeded",
  );
  assert(cadAppliedJob, "Missing CAD Apply result");
  const cadApplied = (await call("job_get", { jobId: cadAppliedJob.jobId }))
    .result.result;
  assert.deepEqual(
    cadApplied.matrix,
    cadSetup.matrix,
    "CAD Apply recomputed a different frame",
  );
  const cadDigests = await digests(ids);
  assert.notDeepEqual(cadDigests, globalDigests);
  assert.equal(
    (await call("history_get")).result.cursor,
    baselineHistory.cursor + 2,
  );
  await mutate("history_undo");
  assert.deepEqual(await digests(ids), globalDigests);
  await mutate("history_undo");
  assert.deepEqual(await digests(ids), baselineDigests);
  await mutate("history_redo");
  assert.deepEqual(await digests(ids), globalDigests);
  await mutate("history_redo");
  assert.deepEqual(await digests(ids), cadDigests);
  checks.push(
    "full-size GUI CAD Apply; same preview frame; exact combined two-step Undo/Redo",
  );
  const workers = await page.evaluate(
    () => window.__alignmentValidationWorkers,
  );
  const ownedWorkers = workers.filter((w) =>
    /global-|datum-transform/.test(w.url),
  );
  assert(
    ownedWorkers.some((w) => /initialization/.test(w.url)),
    "Missing automatic initializer worker",
  );
  assert(
    ownedWorkers.every((w) => w.terminatedAt !== null),
    "Alignment worker retained after completion",
  );
  checks.push(
    "all automatic/global/datum worker termination requests observed",
  );
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    origin,
    before,
    final,
    cadSetup,
    cadApplied,
    baselineDigests,
    globalDigests,
    cadDigests,
    checks,
    workers,
    frames,
    errors,
    warnings,
    elapsedMs: Date.now() - t,
    out,
    scope:
      "Original three STL files, automatic coarse placement and native global refinement through GUI Preview/public MCP state. Cached global Apply, GUI CAD Apply, complete authored-buffer hashes and combined Undo/Redo in a disposable workspace; no changes to the user workspace.",
  };
  await writeFile(
    join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      out,
      frames: frames.length,
      elapsedMs: evidence.elapsedMs,
      initialization: final.initialization,
      outer: final.outer,
      errors,
    }),
  );
} finally {
  clearTimeout(timeout);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
}
