// Run against a freshly built isolated candidate:
// node --max-old-space-size=768 --max-semi-space-size=16 tests/global-alignment-browser.mjs
import assert from "node:assert/strict";
import {appendFile} from "node:fs/promises";
import {importOriginalPlyViaGui} from "./public-gui-ply-input.mjs";
import {createImportAttribution} from "./import-attribution.mjs";
import {installBorrowedThreePlyObserver} from "./browser-borrowed-observer.mjs";
import {createBorrowedGeometryReader} from "./borrowed-geometry-reader.mjs";
import http from "node:http";
import net from "node:net";
import { freemem } from "node:os";
import { getHeapStatistics } from "node:v8";
import { readFile, writeFile, mkdir, readlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const acceptedRequire = createRequire("B:/temp/scanforge-original-three-ply-public-diagnostic-indexed-display-20261020-r5/package.json");
const { Client } = await import(pathToFileURL(acceptedRequire.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(acceptedRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const { chromium } = acceptedRequire("playwright");
assert.equal(typeof chromium.launchServer, "function", "Accepted Playwright CommonJS API must expose launchServer");

const publicRun = JSON.parse(await readFile(new URL("./public-run.ACTUAL.json", import.meta.url), "utf8"));
assert.equal(publicRun.status, "ROOT_REVIEWED_DIAGNOSTIC_PARENT_AND_BUILD_BOUND");
assert.equal(typeof publicRun.diagnosticSourceDirectory, "string");
assert(!publicRun.diagnosticSourceDirectory.replaceAll("\\", "/").startsWith("B:/maliev-legacy/"), "Never serve or instrument the live workspace");
assert(publicRun.scenePath.startsWith("/assets/") && publicRun.controllerPath.startsWith("/assets/"));
const root = pathToFileURL(publicRun.diagnosticSourceDirectory.replaceAll("\\", "/") + "/");
const out = new URL("./harness-output/", import.meta.url);
const leaseMs = 240000;
const requiredMiB = 4608;
const availableMiB = freemem() / 1048576;
assert(
  availableMiB >= requiredMiB,
  `Browser admission blocked: ${Math.floor(availableMiB)} MiB free; ${requiredMiB} MiB required.`,
);
assert(
  getHeapStatistics().heap_size_limit <= 832 * 1048576,
  "Run this harness with node --max-old-space-size=768 --max-semi-space-size=16.",
);
const builtIndex = await readFile(new URL("dist/index.html", root));
await mkdir(out, { recursive: true });

async function identity(pid) {
  if (process.platform === "win32") {
    const observed = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress}`,
      ],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    );
    if (!observed.stdout?.trim()) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return null;
        throw error;
      }
      throw Error(`Could not identify live process ${pid}`);
    }
    assert.equal(
      observed.status,
      0,
      "Cannot establish exact process ownership",
    );
    const result = JSON.parse(observed.stdout);
    assert(
      result.startedAt && result.executable,
      "Incomplete process identity",
    );
    return result;
  }
  const observed = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (!observed.stdout?.trim()) return null;
  return {
    pid,
    startedAt: observed.stdout.trim(),
    executable: await readlink(`/proc/${pid}/exe`),
  };
}
const owner = await identity(process.pid);
assert(owner, "Cannot establish harness ownership");
const ledger = {
  owner: "global-alignment-browser",
  runId: randomUUID(),
  ...owner,
  expiresAt: new Date(Date.now() + leaseMs).toISOString(),
  persistentData: false,
  distIndexSha256: createHash("sha256").update(builtIndex).digest("hex"),
  fixture: {
    scans: 3,
    format: "original sequential public PLY imports",
    sources: publicRun.sources,
    units: "mm",
  },
  admission: {
    availableMiB: Math.floor(availableMiB),
    requiredMiB,
    oldSpaceMiB: 768,
    semiSpaceMiB: 16,
    heapLimitMiB: getHeapStatistics().heap_size_limit / 1048576,
  },
  resources: [],
  cleanup: [],
  checks: [],
};
let server,
  reserve,
  browserServer,
  browser,
  client,
  transport,
  failure,
  cleanupPromise,
  bridgePort;
let page, geometryReader, eventQueue=Promise.resolve(), eventCount=0, eventBytes=0;
const publicEvents=[];
const evidencePath = new URL("evidence.json", out);
const save = () =>
  writeFile(
    evidencePath,
    JSON.stringify(
      {
        ...ledger,
        passed: ledger.completed === true && !failure,
        error: failure?.message,
      },
      null,
      2,
    ),
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadlineAt = Date.now() + leaseMs;
const remaining = () => Math.max(1, deadlineAt - Date.now());
async function waitUntil(check, description, maxMs = 45000) {
  const end = Math.min(deadlineAt, Date.now() + maxMs);
  while (Date.now() < end) {
    if (await check()) return;
    await delay(150);
  }
  throw Error(`Timed out: ${description}`);
}
async function record(kind, pid, extra) {
  const observed = await identity(pid);
  assert(observed, `${kind} exited before ownership could be recorded`);
  ledger.resources.push({ kind, ...observed, persistentData: false, ...extra });
  await save();
}
async function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (closed) => {
      socket.destroy();
      resolve(closed);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(500, () => finish(false));
  });
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    clearTimeout(deadline);
    const issues = [];
    // A failed handshake/launch can throw before the normal ledger write.
    for (const [kind, pid] of [
      ["mcp-stdio-child", transport?.pid],
      ["disposable-browser", browserServer?.process()?.pid],
    ]) {
      if (!pid || ledger.resources.some((entry) => entry.pid === pid)) continue;
      const observed = await identity(pid);
      if (observed)
        ledger.resources.push({
          kind,
          ...observed,
          persistentData: false,
          ...(kind === "mcp-stdio-child"
            ? { port: bridgePort, bind: "127.0.0.1" }
            : {}),
          purpose: "task-owned handle observed during failed setup cleanup",
        });
    }
    for (const [name, close] of [
      ["MCP client", () => client?.close()],
      ["MCP transport", () => transport?.close()],
      ["browser connection", () => browser?.close()],
      ["browser server", () => browserServer?.close()],
    ]) {
      let timer;
      try {
        await Promise.race([
          close(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("graceful close timed out")),
              8000,
            );
          }),
        ]);
      } catch (error) {
        issues.push(`${name}: ${error.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    for (const listener of [reserve, server]) {
      if (!listener?.listening) continue;
      await new Promise((resolve) => {
        listener.close(resolve);
        listener.closeAllConnections();
      });
    }
    for (const resource of ledger.resources.filter(
      (entry) => entry.kind !== "http-server",
    )) {
      let current = await identity(resource.pid);
      for (let i = 0; current && i < 10; i++) {
        await delay(100);
        current = await identity(resource.pid);
      }
      if (
        current &&
        current.startedAt === resource.startedAt &&
        current.executable === resource.executable
      ) {
        // Graceful client/server closure already attempted; terminate only this exact owned process.
        process.kill(resource.pid, "SIGTERM");
        for (let i = 0; current && i < 20; i++) {
          await delay(100);
          current = await identity(resource.pid);
        }
      }
      if (
        current &&
        current.startedAt === resource.startedAt &&
        current.executable === resource.executable
      ) {
        process.kill(resource.pid, "SIGKILL");
        for (let i = 0; current && i < 20; i++) {
          await delay(100);
          current = await identity(resource.pid);
        }
      }
      const exited =
        current === null || current.startedAt !== resource.startedAt;
      ledger.cleanup.push({ kind: resource.kind, pid: resource.pid, exited });
      if (!exited) issues.push(`Owned process ${resource.pid} did not exit`);
    }
    for (const port of [
      ...new Set(ledger.resources.map((entry) => entry.port).filter(Boolean)),
    ]) {
      const closed = await portClosed(port);
      ledger.cleanup.push({ port, closed });
      if (!closed) issues.push(`Port ${port} remained open`);
    }
    if (issues.length)
      failure = Error([failure?.message, ...issues].filter(Boolean).join("; "));
    await save();
  })();
  return cleanupPromise;
}
const deadline = setTimeout(() => {
  failure = Error(
    "Global alignment browser validation exceeded its 240-second lease",
  );
  void cleanup();
}, leaseMs);

// A small closed, curved, asymmetrical scan pair in millimetres. Imported through
// public artifact APIs; no application/private geometry injection is used.
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

try {
  server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://127.0.0.1").pathname,
      );
      const dist = new URL("dist/", root);
      const file = new URL(path === "/" ? "index.html" : path.slice(1), dist);
      assert(file.href.startsWith(dist.href), "Forbidden path");
      const data = await readFile(file);
      const types = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        wasm: "application/wasm",
        json: "application/json",
        svg: "image/svg+xml",
      };
      res.writeHead(200, {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Content-Type":
          types[file.pathname.split(".").pop()] ?? "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const appPort = server.address().port;
  const origin = `http://127.0.0.1:${appPort}`;
  ledger.resources.push({
    kind: "http-server",
    ...owner,
    port: appPort,
    bind: "127.0.0.1",
    persistentData: false,
    purpose: "isolated candidate dist",
  });
  reserve = http.createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  bridgePort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  reserve = undefined;
  const token = randomBytes(32).toString("hex");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--max-old-space-size=768",
      "--max-semi-space-size=16",
      fileURLToPath(new URL("scripts/mcp-server.mjs", root)),
    ],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(bridgePort),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  // Drain without persisting credentials or complete protocol payloads.
  transport.stderr?.on("data", () => {});
  client = new Client({ name: "global-alignment-browser", version: "1.0" });
  await client.connect(transport);
  await record("mcp-stdio-child", transport.pid, {
    port: bridgePort,
    bind: "127.0.0.1",
    purpose: "actual stdio MCP bridge",
  });
  const discovered = await client.listTools();
  for (const name of [
    "global_alignment_state",
    "global_alignment_preview",
    "global_alignment_apply",
    "global_alignment_cancel",
  ]) {
    assert(
      discovered.tools.some((tool) => tool.name === name),
      `Missing MCP discovery: ${name}`,
    );
  }
  assert(
    freemem() / 1048576 >= requiredMiB,
    "Browser launch admission fell below 4608 MiB",
  );
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    host: "127.0.0.1",
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=768 --max-semi-space-size=16",
    ],
    timeout: Math.min(30000, remaining()),
  });
  const browserEndpoint = new URL(browserServer.wsEndpoint());
  await record("disposable-browser", browserServer.process().pid, {
    purpose: "isolated headless browser profile",
    port: Number(browserEndpoint.port),
    bind: browserEndpoint.hostname,
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.exposeBinding("__scanforgePublicPlyEvent", async (_source,row) => {
    assert.equal(row.sequence,++eventCount);assert(eventCount<=512);
    const line=JSON.stringify(row)+"\n";assert(Buffer.byteLength(line)<=60001);
    eventBytes+=Buffer.byteLength(line);assert(eventBytes<=16*1048576);
    publicEvents.push(row);
    eventQueue=eventQueue.then(()=>appendFile(new URL("public-controller-events.jsonl",out),line,{flag:"a"}));
    await eventQueue;return {recorded:true};
  });
  await page.addInitScript(installBorrowedThreePlyObserver,{leaseMs:Math.min(240000,remaining()),scenePath:publicRun.scenePath,controllerPath:publicRun.controllerPath});
  const diagnosticNavigationStarted=Date.now();  await page.goto(origin); ledger.diagnosticNavigation={elapsedMs:Date.now()-diagnosticNavigationStarted,instrumented:true,productionNavigationMeasurement:false};
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
  ledger.callTimings = [];
  const call = async (name, args = {}) => {
    const started = Date.now();
    try {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        {
          timeout: Math.min(45000, remaining()),
        },
      );
      const wire =
        result.structuredContent ?? JSON.parse(result.content[0].text);
      assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
      return wire;
    } catch (error) {
      throw Error(`${name}: ${error.message}`, { cause: error });
    } finally {
      ledger.callTimings.push({ name, elapsedMs: Date.now() - started });
    }
  };
  const mutate = async (name, args = {}) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt) => {
    let result;
    await waitUntil(
      async () => {
        const state = (await call("job_get", { jobId: receipt.result.jobId }))
          .result;
        if (state.status === "running") return false;
        assert.equal(state.status, "succeeded", JSON.stringify(state));
        result = state.result;
        return true;
      },
      "MCP geometry job",
      60000,
    );
    return result;
  };
  ledger.typedReadbacks=[];ledger.geometryCheckpoints=[];let publicEpoch="imported-source";
  const setEpoch=async purpose=>{publicEpoch=purpose;await page.evaluate(value=>globalThis.__scanforgeThreePlyBorrow.setEpoch(value),purpose)};
  geometryReader=createBorrowedGeometryReader({page,directory:fileURLToPath(new URL("typed-readbacks/",out)),sources:publicRun.sources,
    check:()=>assert(remaining()>0,"Original public harness lease expired"),onReadback:row=>{assert(ledger.typedReadbacks.length<24);ledger.typedReadbacks.push({epoch:publicEpoch,...row});}});
  const geometry=async ids=>{const rows=await geometryReader.geometry(ids);assert(ledger.geometryCheckpoints.length<30);ledger.geometryCheckpoints.push({epoch:publicEpoch,rows});return rows};  const workers = () =>
    page.evaluate(() => window.__globalAlignmentWorkerEvidence);
  const globalWorkers = (records) =>
    records.filter((entry) => /global-(alignment|scene|query)/.test(entry.url));
  async function ready() {
    let state;
    await waitUntil(
      async () => {
        state = (await call("global_alignment_state")).result;
        if (state.state === "preview") return true;
        const session = (await call("session_get")).result;
        const failedJob = session.jobs.find(
          (entry) =>
            entry.command === "global_alignment_preview" &&
            entry.status === "failed",
        );
        assert(!failedJob, JSON.stringify(failedJob));
        return false;
      },
      "shared global alignment preview",
      60000,
    );
    assert.equal(typeof state.converged, "boolean");
    assert.equal(state.outer.states.length, 3);
    assert(
      state.outer.states.every((scan) => typeof scan.converged === "boolean"),
    );
    await waitUntil(
      async () => !(await call("session_get")).result.busy,
      "preview job lane released",
    );
    const observed = globalWorkers(await workers());
    assert(
      observed.length > 0,
      "No real global preparation/query workers observed",
    );
    assert(
      observed.every((entry) => entry.terminatedAt !== null),
      "A global worker survived preview completion",
    );
    return state;
  }
  const empty = (await call("project_get")).result;
  assert.equal(
    empty.objects.length,
    0,
    "Browser profile must start with an empty workspace",
  );
  const importAttribution=await createImportAttribution({page,directory:out,check:()=>assert(remaining()>0,"Original public harness lease expired")});
  try{ledger.originalImports=await importOriginalPlyViaGui({sources:publicRun.sources,page,call,waitUntil,check:()=>assert(remaining()>0,"Original public harness lease expired"),onImportStage:importAttribution.record});}
  finally{ledger.importAttribution=await importAttribution.close()}
  await mutate("object_select");
  const baseline = (await call("project_get")).result;
  const ids=publicRun.sources.map(source=>{const matches=baseline.objects.filter(entry=>entry.name===source.name);assert.equal(matches.length,1,"Unique original PLY source name");return matches[0].id;});
  ledger.publicSourceIds=ids.map((id,i)=>({sourceId:String(i),entityId:id,name:publicRun.sources[i].name}));
  assert.equal(ids.length, 3);
  assert.equal(baseline.selectedId, null);
  assert(
    baseline.objects.every(
      (entry) => entry.visible && entry.kind === "mesh" && !entry.exactCad,
    ),
  );
  const before = await geometry(ids);
  const initialHistory = (await call("history_get")).result;
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  const launch = page.getByRole("button", {
    name: "Global fine align",
    exact: true,
  });
  assert(
    await launch.isEnabled(),
    "Global command incorrectly requires a selected object",
  );
  await launch.click();
  const panel = page.getByRole("complementary", {
    name: "Global fine align",
    exact: true,
  });
  await panel.waitFor();
  await panel.getByRole("spinbutton", { name: "Search tolerance (mm)", exact: true }).fill(String(publicRun.searchTolerance));
  await setEpoch("gui-preview-cancel");
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  const guiPreview = await ready();
  await panel
    .getByText("Preview ready · originals and history unchanged.", {
      exact: true,
    })
    .waitFor();
  if (!guiPreview.converged) {
    await panel.getByText(/Alignment did not converge/).waitFor();
    assert(
      await panel
        .getByRole("button", { name: "Apply anyway", exact: true })
        .isEnabled(),
    );
  }
  assert.deepEqual(
    await geometry(ids),
    before,
    "GUI preview modified authored geometry",
  );
  assert.deepEqual(
    (await call("history_get")).result,
    initialHistory,
    "GUI preview changed history",
  );
  await page.screenshot({
    path: fileURLToPath(new URL("gui-preview.png", out)),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Cancel / close", exact: true })
    .click();
  await panel.waitFor({ state: "hidden" });
  assert.equal((await call("global_alignment_state")).result.state, "idle");
  assert.deepEqual(
    await geometry(ids),
    before,
    "GUI cancellation failed to preserve originals",
  );
  assert.deepEqual((await call("history_get")).result, initialHistory);
  ledger.checks.push({
    check: "GUI preview/cancel",
    converged: guiPreview.converged,
    authoredHashes: before,
  });

  await setEpoch("mcp-one-apply");
  await job(
    await mutate("global_alignment_preview", {
      entityIds: ids,
      parallel: true,
      searchTolerance: publicRun.searchTolerance,
    }),
  );
  const staged = await ready();
  const mismatchedCleanup = (
    await mutate("global_alignment_cancel", { jobId: randomUUID() })
  ).result;
  assert.equal(mismatchedCleanup.cancelled, false);
  assert.equal(
    (await call("global_alignment_state")).result.previewId,
    staged.previewId,
    "Cleanup from another job discarded the current preview",
  );
  ledger.checks.push({
    check: "MCP mismatched job cleanup preserves current preview",
  });
  assert.deepEqual(
    await geometry(ids),
    before,
    "MCP preview modified authored geometry",
  );
  const workerCountBeforeApply = (await workers()).length;
  const applied = (
    await mutate("global_alignment_apply", { previewId: staged.previewId })
  ).result;
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.outer, staged.outer);
  assert.deepEqual(applied.diagnostics, staged.diagnostics);
  assert.equal(
    (await workers()).length,
    workerCountBeforeApply,
    "Apply started new workers instead of adopting its staged result",
  );
  const committed = (await call("project_get")).result;
  assert.equal(committed.undo, baseline.undo + 1);
  assert.equal(committed.redo, 0);
  const appliedGeometry = await geometry(ids);
  const history = (await call("history_get")).result;
  assert.equal(history.cursor, initialHistory.cursor + 1);
  assert.equal(history.entries.at(-1).label, "Global Fine Align");
  const timeline = page.getByRole("region", {
    name: "Model timeline",
    exact: true,
  });
  const appliedStep = timeline.getByRole("button", {
    name: `${history.cursor}: Global Fine Align`,
    exact: true,
  });
  await appliedStep.waitFor();
  assert.equal(await appliedStep.getAttribute("aria-current"), "step");
  await mutate("history_undo");
  assert.deepEqual(
    await geometry(ids),
    before,
    "Undo did not restore complete authored coordinates",
  );
  assert.equal(
    (await call("history_get")).result.cursor,
    initialHistory.cursor,
  );
  assert.equal(await appliedStep.getAttribute("aria-current"), null);
  await mutate("history_redo");
  assert.deepEqual(
    await geometry(ids),
    appliedGeometry,
    "Redo did not restore exact committed geometry",
  );
  assert.equal((await call("history_get")).result.cursor, history.cursor);
  assert.equal(await appliedStep.getAttribute("aria-current"), "step");
  assert.equal((await call("global_alignment_state")).result.state, "idle");
  ledger.checks.push({
    check: "MCP cached Apply + one history step + Undo/Redo",
    converged: staged.converged,
    appliedGeometry,
    historyCursor: history.cursor,
    noWorkersStartedOnApply: true,
  });
  // Second large Apply omitted: avoid retaining a third complete geometry generation under unchanged Job2GiB.
  // No artificial worker gates/delays: a completed preview is an explicit failure here.
  const cancelGeometryBefore = await geometry(ids);
  const cancelHistoryBefore = (await call("history_get")).result;
  const cancelWorkerBaseline = (await workers()).length;
  await setEpoch("mcp-inflight-cancel");
  const runningReceipt = await mutate("global_alignment_preview", { entityIds:ids, parallel:true, searchTolerance:publicRun.searchTolerance });
  const runningJobId = runningReceipt.result.jobId;
  assert.equal(typeof runningJobId, "string");
  const preparing = (await call("global_alignment_state")).result;
  assert.equal(preparing.state, "preparing", "Must observe preparing, not an already cached preview");
  const runningJob = (await call("job_get", { jobId:runningJobId })).result;
  assert.equal(runningJob.status, "running", "Cancellation must target the returned active job");
  const runningSession = (await call("session_get")).result;
  assert.equal(runningSession.busy, true, "Owned preview job must still hold the busy lane");
  assert.equal(runningSession.activeJobId, runningJobId, "Cancellation must target the exact active busy-lane owner");
  const ownedRunningJob = runningSession.jobs.find(entry => entry.jobId === runningJobId);
  assert(ownedRunningJob && ownedRunningJob.command === "global_alignment_preview" && ownedRunningJob.status === "running", "Session must identify the exact owned running preview job");
  const cancelled = (await mutate("global_alignment_cancel", { jobId:runningJobId })).result;
  assert.equal(cancelled.cancelled, true);
  let cancelledTerminal;
  await waitUntil(async () => {
    cancelledTerminal = (await call("job_get", {jobId:runningJobId})).result;
    if (cancelledTerminal.status === "running") return false;
    assert.equal(cancelledTerminal.status, "cancelled", "Ready-preview cancellation does not prove active job cancellation");
    return !(await call("session_get")).result.busy;
  }, "exact in-flight preview cancellation settles", 30000);
  assert.equal((await call("global_alignment_state")).result.state, "idle");
  assert.deepEqual(await geometry(ids), cancelGeometryBefore, "Running cancellation changed authored source hashes");
  assert.deepEqual((await call("history_get")).result, cancelHistoryBefore, "Running cancellation created history");
  const cancelledWorkers = (await workers()).slice(cancelWorkerBaseline);
  assert(cancelledWorkers.length > 0, "Active cancellation must exercise actual workers");
  assert(cancelledWorkers.every(entry => entry.terminatedAt !== null), "Running cancellation left a worker alive");
  ledger.checks.push({check:"MCP actual in-flight preview cancellation", jobId:runningJobId,
    observedPreparing:true, observedRunning:true, ownedJob:true, terminalStatus:cancelledTerminal.status,
    noArtificialDelays:true, workerCount:cancelledWorkers.length, authoredHashes:cancelGeometryBefore});
  ledger.workers = await workers();
  assert(
    globalWorkers(ledger.workers).every((entry) => entry.terminatedAt !== null),
  );
  assert.deepEqual(errors, [], "Browser raised uncaught errors");
  await page.screenshot({
    path: fileURLToPath(new URL("applied-timeline.png", out)),
    fullPage: true,
  });
  await page.evaluate(()=>globalThis.__scanforgeThreePlyBorrow.flush());await eventQueue;
  const observedResults=publicEvents.filter(row=>row.event==="controller-result");
  assert.equal(observedResults.length,2,"Actual isolated controller result for GUI cancel and ONE MCP Apply preview");
  assert(publicEvents.filter(row=>row.event==="scene-result").length>=2,"Actual public preparation clocks observed");
  for(const row of observedResults){assert.equal(row.childrenCloseRequested,true);assert.equal(row.outer.states.length,3);assert.equal(row.outer.applications.length,6);}
  ledger.actualPublicControllerResults=observedResults;
  ledger.actualPublicSettings={searchTolerance:publicRun.searchTolerance,mask:1,clocks:"Actual unmodified environment; observed scene clock bits and outer seed bits retained"};
  ledger.geometryReader=geometryReader.stats();ledger.nativeComparison={status:"MATCHED_NATIVE_REPLAY_PENDING",fixedR14OutputInherited:false,authoredNormalsDistinctFromQueryNormals:true};
  ledger.diagnosticTiming={observerInstalled:true,borrowedCarrierHashing:true,instrumentedPrivatebytes:true,productionNavigationMeasurement:false};
  ledger.limitations = [
    "Original three PLYs imported through public commands; optional snapshot getter and Worker observation add diagnostic timing overhead.",
    "Actual published indexed/render carriers are borrowed and streamed; no whole geometry JSON export or production API extension.",
    "Actual public settings/clocks/commands require a matched native replay; fixed-clock R14 acceptance is not inherited. Public authored normals differ from recomputed query normals.",
  ];
  ledger.completed = true;
} catch (error) {
  failure = error instanceof Error ? error : Error(String(error));
  if (page && !page.isClosed())
    await page
      .screenshot({
        path: fileURLToPath(new URL("failure.png", out)),
        fullPage: true,
      })
      .catch(() => {});
} finally {
  try{if(page&&!page.isClosed())await page.evaluate(async()=>{const api=globalThis.__scanforgeThreePlyBorrow;if(api)try{await api.flush()}finally{await api.close()}});await eventQueue;}
  catch(error){failure??=error instanceof Error?error:Error(String(error));ledger.observerCleanupFailure=String(error).slice(0,240);}
  finally{try{await geometryReader?.close()}catch(error){failure??=error instanceof Error?error:Error(String(error));ledger.readerCleanupFailure=String(error).slice(0,240);}}
  await cleanup().catch(async (error) => {
    failure = Error(
      [failure?.message, `Cleanup failed: ${error.message}`]
        .filter(Boolean)
        .join("; "),
    );
    ledger.cleanup.push({ error: error.message, verified: false });
    await save();
  });
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
} else
  console.log(
    `Global alignment browser validation passed; evidence: ${fileURLToPath(evidencePath)}`,
  );
