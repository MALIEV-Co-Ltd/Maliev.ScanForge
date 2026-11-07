import { m2BrowserHeapFlag } from "./m2-memory.mjs";
import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const preciseComponents = process.env.SCANFORGE_COMPONENT_PRECISE === "1";
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/component-cleanup/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = 1536;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Component replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "component-cleanup-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
function processIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid}) | Select-Object @{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='executable';e={$_.Path}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return {
    ...JSON.parse(result.stdout),
    expiresAt: ledger.expiresAt,
    persistentData: false,
  };
}
let server, reserve, browserServer, browser, client, transport, failed, page;
const fixturePath = fileURLToPath(new URL("component-cleanup-panel.stl", out));
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
  client = new Client({ name: "component-cleanup-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...processIdentity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader", m2BrowserHeapFlag],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("component-cleanup-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  if (process.env.SCANFORGE_COMPONENT_RIPPLE_CAPTURE === "1")
    await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__componentProgressTrace = [];
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (
              this.__componentInventory &&
              window.__holdComponentInventory &&
              e.data.result
            ) {
              e.stopImmediatePropagation();
              window.__pendingComponentInventory = true;
              window.__finishComponentInventory = (fail) => {
                window.__holdComponentInventory = false;
                this.dispatchEvent(
                  new MessageEvent("message", {
                    data: fail
                      ? { error: "Controlled component inventory failure" }
                      : e.data,
                  }),
                );
              };
              return;
            }
            const componentAction = this.__componentAction;
            if (this.__componentAction && typeof e.data.progress === "number")
              window.__componentProgressTrace.push({
                action: this.__componentAction,
                progress: e.data.progress,
                stage: e.data.stage,
              });
            if (e.data.result || e.data.error)
              this.__componentAction = undefined;
            if (
              window.__holdComponentResult &&
              e.data.result &&
              componentAction
            ) {
              e.stopImmediatePropagation();
              window.__pendingComponentResult = true;
            }
          });
      }
      postMessage(message, ...rest) {
        if (message?.kind === "scanEdit")
          this.__componentInventory =
            message.action === "inventory" &&
            message.inventoryScope === "components";
        if (message?.kind === "scanEdit")
          this.__componentAction = message.action?.startsWith("component")
            ? message.action
            : undefined;
        return super.postMessage(message, ...rest);
      }
    };
  });
  await page.goto(origin);
  ledger.browserHeapLimitBytes = await page.evaluate(
    () => performance.memory?.jsHeapSizeLimit ?? null,
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
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Workspace did not settle before component validation");
  };
  const mutate = async (name, args) => {
    await idle();
    return call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  };
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 1800; i++) {
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
    for (let offset = 0; offset < artifact.bytes;) {
      const read = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const chunk = Buffer.from(read.base64, "base64");
      assert(chunk.length > 0);
      chunks.push(chunk);
      offset += chunk.length;
    }
    await call("artifact_delete", { artifactId: artifact.artifactId });
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const geometry = async (entityId = "scan") => {
    await idle();
    return (
      await artifactJson(
        (await call("object_get", { entityId, includeGeometry: true })).result
          .geometry,
      )
    ).positions;
  };
  const checkedIndex = async (entityId, expected) => {
    const data = await artifactJson(
      (await call("object_get", { entityId, includeGeometry: true })).result
        .geometry,
    );
    assert(data.indexedMesh, `Indexed topology missing for ${entityId}`);
    const { vertices, triangles } = data.indexedMesh;
    assert.deepEqual(
      triangles.flatMap((id) => vertices.slice(id * 3, id * 3 + 3)),
      expected,
    );
    return { vertices, triangles };
  };
  const digest = (positions) =>
    createHash("sha256")
      .update(Buffer.from(new Float32Array(positions).buffer))
      .digest("hex");
  const rawEqual = (actual, expected, message) =>
    preciseComponents
      ? assert.deepEqual(actual, expected, message)
      : assert.equal(digest(actual), digest(expected), message);
  if (process.env.SCANFORGE_COMPONENT_EXACT_CAD === "1") {
    const created = await job(
      await mutate("cad_create", {
        name: "Exact component guard",
        recipe: {
          kind: "primitive",
          input: { kind: "box", center: [0, 0, 0], size: [2, 2, 2] },
        },
      }),
    );
    const cadId = created.result.entityIds[0];
    await mutate("object_select", { entityId: cadId });
    const before = await call("project_get");
    const beforeGeometry = await geometry(cadId);
    assert(
      before.result.objects.find((object) => object.id === cadId).exactCad,
    );
    await mutate("command_run", { name: "ribbon:editScan" });
    await page
      .getByRole("button", { name: "Create mesh copy", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Edit individual meshes", exact: true })
        .count(),
      0,
    );
    const afterGui = await call("project_get");
    assert.equal(afterGui.revision, before.revision);
    assert.equal(afterGui.result.undo, before.result.undo);
    rawEqual(
      await geometry(cadId),
      beforeGeometry,
      "GUI changed protected CAD geometry",
    );
    const rejected = await job(
      await mutate("mesh_process", {
        entityId: cadId,
        operation: {
          kind: "scanEdit",
          action: "componentExtract",
          indices: [0],
        },
      }),
      "failed",
    );
    assert.match(JSON.stringify(rejected.error), /mesh copy/i);
    const afterMcp = await call("project_get");
    assert.equal(afterMcp.revision, before.revision);
    assert.equal(afterMcp.result.undo, before.result.undo);
    rawEqual(
      await geometry(cadId),
      beforeGeometry,
      "MCP changed protected CAD geometry",
    );
    await mutate("project_new", { discard: true });
  }
  if (process.env.SCANFORGE_COMPONENT_SAMPLED_KIND === "1") {
    for (const kind of ["plane", "cad"]) {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const project = {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Sampled source",
        entities: [
          {
            id: "sampled",
            name: `Sampled ${kind}`,
            kind,
            positions,
            visible: true,
            color: "#ffffff",
            opacity: 1,
          },
        ],
      };
      const artifact = (
        await call("artifact_put", {
          name: "sampled.json",
          offset: 0,
          base64: Buffer.from(JSON.stringify(project)).toString("base64"),
        })
      ).result;
      await job(
        await mutate("project_import", {
          artifactId: artifact.artifactId,
          replace: true,
        }),
      );
      await call("artifact_delete", { artifactId: artifact.artifactId });
      await mutate("object_select", { entityId: "sampled" });
      await mutate("command_run", { name: "ribbon:editScan" });
      await page
        .getByRole("button", { name: "Edit individual meshes", exact: true })
        .click();
      const panel = page.getByRole("region", {
        name: "Individual meshes",
        exact: true,
      });
      await panel.getByRole("button", { name: /· 1 triangles ·/ }).waitFor();
      const baseline = (await call("project_get")).result.undo;
      await panel
        .getByRole("button", { name: "Create new object", exact: true })
        .click();
      for (let i = 0; i < 120; i++) {
        if ((await call("project_get")).result.undo === baseline + 1) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await idle();
      const gui = (await call("project_get")).result;
      const guiSource = gui.objects.find((object) => object.id === "sampled");
      const guiPart = gui.objects.find((object) => object.id !== "sampled");
      assert.equal(guiSource.kind, "mesh");
      assert.equal(guiSource.emptyComponentSource, true);
      assert(guiPart);
      rawEqual(
        await geometry(guiPart.id),
        positions,
        "GUI sampled extraction changed geometry",
      );
      await mutate("history_undo", {});
      assert.equal(
        (await call("project_get")).result.objects.find(
          (object) => object.id === "sampled",
        ).kind,
        kind,
      );
      await job(
        await mutate("mesh_process", {
          entityId: "sampled",
          operation: {
            kind: "scanEdit",
            action: "componentExtract",
            indices: [0],
          },
        }),
      );
      const mcp = (await call("project_get")).result;
      assert.equal(
        mcp.objects.find((object) => object.id === "sampled").kind,
        "mesh",
      );
      const mcpPart = mcp.objects.find((object) => object.id !== "sampled");
      assert(mcpPart);
      rawEqual(
        await geometry(mcpPart.id),
        positions,
        "MCP sampled extraction changed geometry",
      );
      const saved = await job(
        await call("project_export", { format: "project" }),
      );
      await job(
        await mutate("project_import", {
          artifactId: saved.result.artifactId,
          replace: true,
        }),
      );
      await call("artifact_delete", { artifactId: saved.result.artifactId });
      assert.equal(
        (await call("project_get")).result.objects.find(
          (object) => object.id === "sampled",
        ).emptyComponentSource,
        true,
      );
      await mutate("project_new", { discard: true });
    }
  }
  await page
    .locator('input[type=file][accept*=".stl"]')
    .setInputFiles(
      fileURLToPath(
        new URL(
          "tests/fixtures/m2-small-adjacent-native-20261107/source.stl",
          root,
        ),
      ),
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .locator('.status-message[title^="Opened · 1/1 files"]')
    .waitFor({ timeout: 60000 });
  const nativeSource = (await call("project_get")).result.objects[0].id;
  const nativeSourceGeometry = await geometry(nativeSource);
  await mutate("object_select", { entityId: nativeSource });
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('output[aria-label="Individual meshes count"]')
        ?.textContent?.trim() === "1",
    null,
    { timeout: 60000 },
  );
  const nativeInventory = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: nativeSource,
          operation: {
            kind: "scanEdit",
            action: "inventory",
            inventoryScope: "components",
          },
        }),
      )
    ).result.artifact,
  );
  assert.deepEqual(
    nativeInventory.inventory.components.map(
      (component) => component.triangles.length,
    ),
    [2],
  );
  for (let repeat = 0; repeat < 2; repeat++) {
    const full = await artifactJson(
      (
        await job(
          await mutate("mesh_process", {
            entityId: nativeSource,
            operation: { kind: "scanEdit", action: "inventory" },
          }),
        )
      ).result.artifact,
    );
    assert.deepEqual(
      full.inventory.components.map((c) => c.triangles.length),
      [2],
    );
  }
  await page
    .getByRole("button", { name: "Edit individual meshes", exact: true })
    .click();
  const nativeControls = page.getByRole("region", {
    name: "Individual meshes",
    exact: true,
  });
  await nativeControls
    .getByRole("button", { name: /· 2 triangles ·/ })
    .waitFor();
  const nativeBaseline = (await call("project_get")).result.undo;
  await nativeControls
    .getByRole("button", { name: "Create new object", exact: true })
    .click();
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await call("project_get")).result.undo === nativeBaseline + 1) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await idle();
  const nativeGuiProject = (await call("project_get")).result;
  assert.equal(nativeGuiProject.objects.length, 2);
  const nativeGuiPart = nativeGuiProject.objects.find(
    (object) => object.id !== nativeSource,
  );
  assert.equal(
    nativeGuiProject.objects.find((object) => object.id === nativeSource)
      .visible,
    true,
  );
  assert.equal(
    nativeGuiProject.objects.find((object) => object.id === nativeSource)
      .emptyComponentSource,
    true,
  );
  assert.equal((await geometry(nativeSource)).length, 0);
  const nativeGuiGeometry = await geometry(nativeGuiPart.id);
  assert.equal(nativeGuiGeometry.length, 18);
  rawEqual(
    nativeGuiGeometry,
    nativeSourceGeometry,
    "Extracting the complete native fixture changed source coordinates",
  );
  await checkedIndex(nativeGuiPart.id, nativeSourceGeometry);
  await mutate("history_undo", {});
  await job(
    await mutate("mesh_process", {
      entityId: nativeSource,
      operation: { kind: "scanEdit", action: "componentExtract", indices: [0] },
    }),
  );
  const nativeMcpProject = (await call("project_get")).result;
  assert.equal(nativeMcpProject.objects.length, 2);
  assert.equal(
    nativeMcpProject.objects.find((object) => object.id === nativeSource)
      .emptyComponentSource,
    true,
  );
  assert.equal((await geometry(nativeSource)).length, 0);
  const nativeMcpPart = nativeMcpProject.objects.find(
    (object) => object.id !== nativeSource,
  );
  rawEqual(
    await geometry(nativeMcpPart.id),
    nativeGuiGeometry,
    "GUI/MCP native-fixture extraction mismatch",
  );
  const nativeSaved = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: nativeSaved.result.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: nativeSaved.result.artifactId });
  const nativeReopened = (await call("project_get")).result;
  assert.equal(
    nativeReopened.objects.find((object) => object.id === nativeSource)
      .emptyComponentSource,
    true,
  );
  assert.equal((await geometry(nativeSource)).length, 0);
  rawEqual(
    await geometry(nativeMcpPart.id),
    nativeGuiGeometry,
    "Reopen lost native-fixture component",
  );
  await mutate("object_select", { entityId: nativeSource });
  assert.equal(
    (await call("application_inspect")).result.selectedId,
    nativeSource,
  );
  assert.deepEqual(
    errors,
    [],
    "Selecting the empty source caused a page error",
  );
  await mutate("history_undo", {});
  if (await nativeControls.isVisible())
    await nativeControls
      .getByRole("button", { name: "Back", exact: true })
      .click();
  // Compare the real native export with both publication paths using the same
  // three-triangle STL that QuickSurface imported, not a manufactured proxy.
  const nativeExport = await readFile(
    new URL(
      "tests/fixtures/m2-native-extract-lifecycle-20261107/native-two-triangle.stl",
      root,
    ),
  );
  assert.equal(
    createHash("sha256").update(nativeExport).digest("hex"),
    "c7f98fe653e3b228756dbe675673c86e72e6b26e402ee3fea3763d2f9e413e97",
  );
  assert.equal(nativeExport.readUInt32LE(80), 2);
  const nativeExpected = [];
  const nativeFacetNormals = [];
  for (let face = 0; face < 2; face++)
    for (let coordinate = 0; coordinate < 9; coordinate++) {
      if (coordinate < 3)
        nativeFacetNormals.push(
          nativeExport.readFloatLE(84 + face * 50 + coordinate * 4),
        );
      nativeExpected.push(
        nativeExport.readFloatLE(84 + face * 50 + 12 + coordinate * 4),
      );
    }
  const nativeRemainderExport = await readFile(
    new URL(
      "tests/fixtures/m2-native-extract-lifecycle-20261107/native-one-triangle.stl",
      root,
    ),
  );
  assert.equal(
    createHash("sha256").update(nativeRemainderExport).digest("hex"),
    "cd01401710e3cfccb0ed1423ae22155c0d7bae192c527dd05ed664dbfb5ac62b",
  );
  assert.equal(nativeRemainderExport.readUInt32LE(80), 1);
  const nativeRemainder = Array.from({ length: 9 }, (_, i) =>
    nativeRemainderExport.readFloatLE(96 + i * 4),
  );
  const nativeRemainderNormal = Array.from({ length: 3 }, (_, i) =>
    nativeRemainderExport.readFloatLE(84 + i * 4),
  );
  const checkFacetNormals = async (entityId, expected, message) => {
    const data = await artifactJson(
      (await call("object_get", { entityId, includeGeometry: true })).result
        .geometry,
    );
    assert.deepEqual(data.indexedMesh?.facetNormals, expected, message);
  };
  const beforeNativeImport = new Set(
    (await call("project_get")).result.objects.map((o) => o.id),
  );
  await page
    .locator('input[type=file][accept*=".stl"]')
    .setInputFiles(
      fileURLToPath(
        new URL(
          "tests/fixtures/m2-native-extract-lifecycle-20261107/source.stl",
          root,
        ),
      ),
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  let lifecycleSource;
  for (let attempt = 0; attempt < 600 && !lifecycleSource; attempt++) {
    lifecycleSource = (await call("project_get")).result.objects.find(
      (o) => !beforeNativeImport.has(o.id),
    )?.id;
    if (!lifecycleSource)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(lifecycleSource, "Native lifecycle fixture was not imported");
  const lifecycleInput = await geometry(lifecycleSource);
  await mutate("object_select", { entityId: lifecycleSource });
  await mutate("command_run", { name: "ribbon:editScan" });
  await page
    .getByRole("button", { name: "Edit individual meshes", exact: true })
    .click();
  const lifecycleControls = page.getByRole("region", {
    name: "Individual meshes",
    exact: true,
  });
  await lifecycleControls
    .getByRole("button", { name: /· 2 triangles ·/ })
    .click();
  const lifecycleBaseline = (await call("project_get")).result.undo;
  const guiProgressStart = await page.evaluate(
    () => window.__componentProgressTrace.length,
  );
  await lifecycleControls
    .getByRole("button", { name: "Create new object", exact: true })
    .click();
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await call("project_get")).result.undo === lifecycleBaseline + 1)
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await idle();
  const guiComponentProgress = await page.evaluate(
    (start) =>
      window.__componentProgressTrace
        .slice(start)
        .filter((entry) => entry.action === "componentExtract"),
    guiProgressStart,
  );
  assert(
    guiComponentProgress.length > 0,
    "GUI component progress was not observed",
  );
  assert(
    guiComponentProgress.every((entry) => entry.progress < 1),
    "GUI component progress reported completion before the result",
  );
  assert.deepEqual(
    guiComponentProgress.map((entry) => entry.progress),
    [...guiComponentProgress.map((entry) => entry.progress)].sort(
      (a, b) => a - b,
    ),
    "GUI component progress moved backwards",
  );
  const lifecycleGuiProject = (await call("project_get")).result;
  const lifecycleGuiPart = lifecycleGuiProject.objects.find(
    (o) => o.id !== lifecycleSource && !beforeNativeImport.has(o.id),
  );
  assert(lifecycleGuiPart, "GUI did not publish the native fixture component");
  rawEqual(
    await geometry(lifecycleGuiPart.id),
    nativeExpected,
    "GUI differs from native export",
  );
  rawEqual(
    await geometry(lifecycleSource),
    nativeRemainder,
    "GUI changed the source remainder",
  );
  await checkFacetNormals(
    lifecycleGuiPart.id,
    nativeFacetNormals,
    "GUI component facet normals differ from native STL",
  );
  await checkFacetNormals(
    lifecycleSource,
    nativeRemainderNormal,
    "GUI remainder facet normal differs from native STL",
  );
  await mutate("history_undo", {});
  rawEqual(
    await geometry(lifecycleSource),
    lifecycleInput,
    "Undo did not restore source",
  );
  await mutate("history_redo", {});
  rawEqual(
    await geometry(lifecycleGuiPart.id),
    nativeExpected,
    "GUI redo changed native fixture output",
  );
  await checkFacetNormals(
    lifecycleGuiPart.id,
    nativeFacetNormals,
    "GUI redo changed native facet normals",
  );
  await mutate("history_undo", {});
  const lifecycleInventory = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: lifecycleSource,
          operation: {
            kind: "scanEdit",
            action: "inventory",
            inventoryScope: "components",
          },
        }),
      )
    ).result.artifact,
  );
  const lifecycleIndex = lifecycleInventory.inventory.components.findIndex(
    (c) => c.triangles.length === 2,
  );
  assert(lifecycleIndex >= 0);
  const mcpProgressStart = await page.evaluate(
    () => window.__componentProgressTrace.length,
  );
  await job(
    await mutate("mesh_process", {
      entityId: lifecycleSource,
      operation: {
        kind: "scanEdit",
        action: "componentExtract",
        indices: [lifecycleIndex],
      },
    }),
  );
  const mcpComponentProgress = await page.evaluate(
    (start) =>
      window.__componentProgressTrace
        .slice(start)
        .filter((entry) => entry.action === "componentExtract"),
    mcpProgressStart,
  );
  assert(
    mcpComponentProgress.length > 0,
    "MCP component progress was not observed",
  );
  assert(
    mcpComponentProgress.every((entry) => entry.progress < 1),
    "MCP component progress reported completion before the result",
  );
  assert.deepEqual(
    mcpComponentProgress.map((entry) => entry.progress),
    [...mcpComponentProgress.map((entry) => entry.progress)].sort(
      (a, b) => a - b,
    ),
    "MCP component progress moved backwards",
  );
  const lifecycleMcpPart = (await call("project_get")).result.objects.find(
    (o) => o.id !== lifecycleSource && !beforeNativeImport.has(o.id),
  );
  assert(lifecycleMcpPart, "MCP did not publish the native fixture component");
  rawEqual(
    await geometry(lifecycleMcpPart.id),
    nativeExpected,
    "MCP differs from native export",
  );
  rawEqual(
    await geometry(lifecycleSource),
    nativeRemainder,
    "MCP changed the source remainder",
  );
  await checkFacetNormals(
    lifecycleMcpPart.id,
    nativeFacetNormals,
    "MCP component facet normals differ from native STL",
  );
  await checkFacetNormals(
    lifecycleSource,
    nativeRemainderNormal,
    "MCP remainder facet normal differs from native STL",
  );
  await mutate("history_undo", {});
  rawEqual(
    await geometry(lifecycleSource),
    lifecycleInput,
    "MCP undo did not restore source",
  );
  await mutate("history_redo", {});
  rawEqual(
    await geometry(lifecycleMcpPart.id),
    nativeExpected,
    "MCP redo changed native fixture output",
  );
  await checkFacetNormals(
    lifecycleMcpPart.id,
    nativeFacetNormals,
    "MCP redo changed native facet normals",
  );
  const lifecycleSaved = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: lifecycleSaved.result.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", {
    artifactId: lifecycleSaved.result.artifactId,
  });
  rawEqual(
    await geometry(lifecycleMcpPart.id),
    nativeExpected,
    "Reopen changed native fixture output",
  );
  rawEqual(
    await geometry(lifecycleSource),
    nativeRemainder,
    "Reopen changed native fixture remainder",
  );
  await checkFacetNormals(
    lifecycleMcpPart.id,
    nativeFacetNormals,
    "Reopen changed native component facet normals",
  );
  await checkFacetNormals(
    lifecycleSource,
    nativeRemainderNormal,
    "Reopen changed native remainder facet normal",
  );
  const nearFile = new URL(
    "tests/fixtures/m2-near-edge-native-20261107/source.stl",
    root,
  );
  const nearBytes = await readFile(nearFile);
  assert.equal(
    createHash("sha256").update(nearBytes).digest("hex"),
    "e3a21262309a84818cb473cefaf93c6d4ee4d57924f452ccb1be8dc0cf2ab0f5",
  );
  const nearBefore = new Set(
    (await call("project_get")).result.objects.map((o) => o.id),
  );
  await page
    .locator('input[type=file][accept*=".stl"]')
    .setInputFiles(fileURLToPath(nearFile));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  let nearId;
  for (let attempt = 0; attempt < 600 && !nearId; attempt++) {
    nearId = (await call("project_get")).result.objects.find(
      (o) => !nearBefore.has(o.id),
    )?.id;
    if (!nearId) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(nearId, "Near-edge fixture was not imported");
  const nearPositions = await geometry(nearId);
  await mutate("object_select", { entityId: nearId });
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('output[aria-label="Individual meshes count"]')
        ?.textContent?.trim() === "2",
    null,
    { timeout: 60000 },
  );
  const nearIndexed = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: nearId,
          operation: {
            kind: "scanEdit",
            action: "inventory",
            inventoryScope: "components",
            tolerance: 0.001,
          },
        }),
      )
    ).result.artifact,
  );
  assert.deepEqual(
    nearIndexed.inventory.components.map((c) => c.triangles.length),
    [1, 1],
  );
  for (const control of [
    {
      name: "low",
      sha256:
        "453163693730696daee6ba369e5120885cc80ce04aeb467e64a48ea24cab2dc8",
      vertices: 4,
      components: [2],
    },
    {
      name: "high",
      sha256:
        "5806b2e9b2d8133755bc4a4d61c038c1fca4d4129dd7549b237686e7710005f6",
      vertices: 6,
      components: [1, 1],
    },
  ]) {
    const file = new URL(
      `tests/fixtures/m2-near-edge-native-20261107/key-boundary-${control.name}.stl`,
      root,
    );
    assert.equal(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
      control.sha256,
    );
    const before = new Set(
      (await call("project_get")).result.objects.map((o) => o.id),
    );
    await page
      .locator('input[type=file][accept*=".stl"]')
      .setInputFiles(fileURLToPath(file));
    await page.getByRole("button", { name: "Import", exact: true }).click();
    let id;
    for (let attempt = 0; attempt < 600 && !id; attempt++) {
      id = (await call("project_get")).result.objects.find(
        (o) => !before.has(o.id),
      )?.id;
      if (!id) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(id, `Key-boundary ${control.name} fixture was not imported`);
    const data = await artifactJson(
      (await call("object_get", { entityId: id, includeGeometry: true })).result
        .geometry,
    );
    assert.equal(data.indexedMesh.vertices.length / 3, control.vertices);
    await mutate("object_select", { entityId: id });
    await mutate("command_run", { name: "ribbon:editScan" });
    await page.waitForFunction(
      (count) =>
        document
          .querySelector('output[aria-label="Individual meshes count"]')
          ?.textContent?.trim() === String(count),
      control.components.length,
      { timeout: 60000 },
    );
    const report = await artifactJson(
      (
        await job(
          await mutate("mesh_process", {
            entityId: id,
            operation: {
              kind: "scanEdit",
              action: "inventory",
              inventoryScope: "components",
              tolerance: 0.001,
            },
          }),
        )
      ).result.artifact,
    );
    assert.deepEqual(
      report.inventory.components.map((c) => c.triangles.length),
      control.components,
    );
  }
  const nearProject = {
    format: "maliev-scanforge",
    version: 1,
    name: "Near-edge unindexed control",
    units: "mm",
    entities: [
      {
        id: "near-unindexed",
        name: "Near-edge unindexed",
        kind: "mesh",
        positions: nearPositions,
        color: "#b4bec4",
        visible: true,
        opacity: 1,
      },
    ],
  };
  const nearUpload = (
    await call("artifact_put", {
      name: "near-edge-unindexed.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(nearProject)).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: nearUpload.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: nearUpload.artifactId });
  await mutate("object_select", { entityId: "near-unindexed" });
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('output[aria-label="Individual meshes count"]')
        ?.textContent?.trim() === "1",
    null,
    { timeout: 60000 },
  );
  const nearUnindexed = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: "near-unindexed",
          operation: {
            kind: "scanEdit",
            action: "inventory",
            inventoryScope: "components",
            tolerance: 0.001,
          },
        }),
      )
    ).result.artifact,
  );
  assert.deepEqual(
    nearUnindexed.inventory.components.map((c) => c.triangles.length),
    [2],
  );
  // Exercise the same native fixture without imported index identity.
  const collapsedProject = {
    format: "maliev-scanforge",
    version: 1,
    name: "Collapsed component control",
    units: "mm",
    entities: [
      {
        id: "collapsed",
        name: "Collapsed component",
        kind: "mesh",
        positions: nativeSourceGeometry,
        color: "#b4bec4",
        visible: true,
        opacity: 1,
      },
    ],
  };
  const collapsedUpload = (
    await call("artifact_put", {
      name: "collapsed-component.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(collapsedProject)).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: collapsedUpload.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: collapsedUpload.artifactId });
  await mutate("object_select", { entityId: "collapsed" });
  await page.evaluate(() => {
    window.__holdComponentInventory = true;
  });
  await mutate("command_run", { name: "ribbon:editScan" });
  await page.waitForFunction(
    () => window.__pendingComponentInventory === true,
    null,
    { timeout: 60000 },
  );
  assert.equal(
    await page
      .locator('output[aria-label="Individual meshes count"]')
      .textContent(),
    "Calculating…",
  );
  await page.evaluate(() => window.__finishComponentInventory(true));
  await page.waitForFunction(
    () =>
      document
        .querySelector('output[aria-label="Individual meshes count"]')
        ?.textContent?.trim() === "Unavailable",
  );
  await page
    .getByRole("button", { name: "Retry component count", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('output[aria-label="Individual meshes count"]')
        ?.textContent?.trim() === "1",
    null,
    { timeout: 60000 },
  );
  const collapsedInventory = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: "collapsed",
          operation: {
            kind: "scanEdit",
            action: "inventory",
            inventoryScope: "components",
            tolerance: 0.001,
          },
        }),
      )
    ).result.artifact,
  );
  assert.deepEqual(
    collapsedInventory.inventory.components.map((c) => c.triangles.length),
    [2],
  );
  const collapsedFull = await artifactJson(
    (
      await job(
        await mutate("mesh_process", {
          entityId: "collapsed",
          operation: {
            kind: "scanEdit",
            action: "inventory",
            tolerance: 0.001,
          },
        }),
      )
    ).result.artifact,
  );
  assert.deepEqual(
    collapsedFull.inventory.components.map((c) => c.triangles.length),
    [2],
  );
  await page
    .getByRole("button", { name: "Edit individual meshes", exact: true })
    .click();
  const collapsedControls = page.getByRole("region", {
    name: "Individual meshes",
    exact: true,
  });
  await collapsedControls
    .getByRole("button", { name: /2 triangles/ })
    .waitFor();
  const collapsedBaseline = (await call("project_get")).result.undo;
  await collapsedControls
    .getByRole("button", { name: "Create new object", exact: true })
    .click();
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await call("project_get")).result.undo === collapsedBaseline + 1)
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await idle();
  const collapsedGuiProject = (await call("project_get")).result;
  assert.equal(collapsedGuiProject.objects.length, 2);
  const collapsedGuiPart = collapsedGuiProject.objects.find(
    (object) => object.id !== "collapsed",
  );
  rawEqual(
    await geometry(collapsedGuiPart.id),
    nativeSourceGeometry,
    "GUI collapsed component changed source corners",
  );
  await mutate("history_undo", {});
  await job(
    await mutate("mesh_process", {
      entityId: "collapsed",
      operation: {
        kind: "scanEdit",
        action: "componentExtract",
        indices: [0],
        tolerance: 0.001,
      },
    }),
  );
  const collapsedMcpProject = (await call("project_get")).result;
  assert.equal(collapsedMcpProject.objects.length, 2);
  const collapsedMcpPart = collapsedMcpProject.objects.find(
    (object) => object.id !== "collapsed",
  );
  rawEqual(
    await geometry(collapsedMcpPart.id),
    nativeSourceGeometry,
    "MCP collapsed component changed source corners",
  );
  await mutate("history_undo", {});
  assert.deepEqual(await geometry("collapsed"), nativeSourceGeometry);
  if (await collapsedControls.isVisible())
    await collapsedControls
      .getByRole("button", { name: "Back", exact: true })
      .click();
  const positions = [],
    groups = [];
  for (let n = 1; n <= 3; n++) {
    const part = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = [n * 10 + x, y, 0],
          b = [n * 10 + x + 1, y, 0],
          c = [n * 10 + x + 1, y + 1, 0],
          d = [n * 10 + x, y + 1, 0];
        part.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    groups.push(part);
    positions.push(...part);
  }
  // Retained corners may be near-coincident without being identical.
  if (!preciseComponents) groups[2][2] = 2e-7;
  positions.splice(
    groups[0].length + groups[1].length,
    groups[2].length,
    ...groups[2],
  );
  let indexedMesh;
  if (preciseComponents) {
    for (let i = 0; i < groups[1].length; i += 3) groups[1][i] += 2 ** -20;
    positions.splice(groups[0].length, groups[1].length, ...groups[1]);
    const vertices = [],
      triangles = [],
      ids = new Map();
    for (let i = 0; i < positions.length; i += 3) {
      const point = positions.slice(i, i + 3),
        key = point.join(",");
      let id = ids.get(key);
      if (id === undefined) {
        id = vertices.length / 3;
        ids.set(key, id);
        vertices.push(...point);
      }
      triangles.push(id);
    }
    indexedMesh = { vertices, triangles };
  }
  const project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Component lifecycle control",
    units: "mm",
    entities: [
      {
        id: "scan",
        name: "Three components",
        source: "manufactured-components-control.stl",
        kind: "mesh",
        positions,
        ...(indexedMesh ? { indexedMesh } : {}),
        visible: true,
        color: "#b4bec4",
        opacity: 1,
      },
    ],
  };
  const upload = (
    await call("artifact_put", {
      name: "component-control.json",
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
  await call("artifact_delete", { artifactId: upload.artifactId });
  await mutate("object_select", { entityId: "scan" });
  await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
  await mutate("viewport_control", {
    action: "camera",
    position: [20, 2, 45],
    target: [20, 2, 0],
    up: [0, 1, 0],
    zoom: 1,
  });
  const baseline = (await call("project_get")).result.undo;
  rawEqual(
    await geometry(),
    positions,
    "Import changed original corner records",
  );
  if (preciseComponents) await checkedIndex("scan", positions);
  const runEdit = async (operation, expected = "succeeded") =>
    job(
      await mutate("mesh_process", {
        entityId: "scan",
        operation: { kind: "scanEdit", ...operation },
      }),
      expected,
    );
  const inspect = async () =>
    artifactJson((await runEdit({ action: "inventory" })).result.artifact);
  const report = await inspect();
  const scoped = await artifactJson(
    (await runEdit({ action: "inventory", inventoryScope: "components" }))
      .result.artifact,
  );
  assert.equal(scoped.inventory.scope, "components");
  assert.deepEqual(
    scoped.inventory.components.map((component) => ({
      ...component,
      triangles: [...component.triangles].sort((a, b) => a - b),
    })),
    report.inventory.components.map((component) => ({
      ...component,
      triangles: [...component.triangles].sort((a, b) => a - b),
    })),
  );
  assert.deepEqual(scoped.inventory.boundaries, []);
  assert.deepEqual(
    report.inventory.components
      .map((c) => c.triangles.length)
      .sort((a, b) => a - b),
    [2, 8, 18],
  );
  const middle = report.inventory.components.findIndex(
    (c) => c.triangles.length === 8,
  );
  const small = report.inventory.components.findIndex(
    (c) => c.triangles.length === 2,
  );
  assert.equal(report.inventory.components[middle].area, 4);
  assert.equal(
    (await call("project_get")).result.undo,
    baseline,
    "Inventory added history",
  );
  const controls = page.getByRole("region", {
    name: "Individual meshes",
    exact: true,
  });
  const open = async () => {
    await mutate("command_run", { name: "ribbon:editScan" });
    if (!(await controls.isVisible()))
      await page
        .getByRole("button", { name: "Edit individual meshes", exact: true })
        .click();
    await controls.getByRole("button", { name: /· 8 triangles ·/ }).waitFor();
    assert.match(await controls.innerText(), /3 meshes/);
  };
  const reset = async () => {
    await mutate("history_seek", { index: baseline });
    await mutate("object_select", { entityId: "scan" });
    rawEqual(await geometry(), positions, "History reset changed source");
    const restored = (await call("project_get")).result;
    assert.equal(restored.objects.length, 1);
    assert.equal(
      restored.objects.find((o) => o.id === "scan").visible,
      true,
      "History did not restore extracted source visibility",
    );
  };
  const waitHistory = async (index) => {
    for (let i = 0; i < 120; i++) {
      if ((await call("project_get")).result.undo === index) {
        await idle();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("GUI component operation did not commit");
  };
  const cases = [
    {
      name: "keep",
      button: "Leave selected only",
      action: "componentKeep",
      indices: [middle],
      expected: groups[1],
    },
    {
      name: "flip",
      button: "Flip normals",
      action: "componentFlip",
      indices: [middle],
      expected: positions.map((v, i) => {
        const start = groups[0].length,
          end = start + groups[1].length;
        if (i < start || i >= end) return v;
        const corner = i % 9;
        return positions[
          i + (corner >= 3 && corner < 6 ? 3 : corner >= 6 ? -3 : 0)
        ];
      }),
    },
    {
      name: "extract",
      button: "Create new object",
      action: "componentExtract",
      indices: [middle],
      expected: groups[1],
      extract: true,
    },
    {
      name: "triangle-threshold-inclusive",
      button: "Remove small meshes",
      action: "componentRemove",
      indices: [small],
      threshold: 2,
      expected: [...groups[1], ...groups[2]],
    },
    {
      name: "area-threshold-exclusive",
      button: "Remove small meshes",
      action: "componentRemove",
      indices: [small],
      threshold: 4,
      area: true,
      expected: [...groups[1], ...groups[2]],
    },
  ];
  await reset();
  await open();
  const items = controls
    .getByRole("group", { name: "Individual meshes items", exact: true })
    .getByRole("button");
  assert.equal(await items.count(), 3);
  for (let i = 0; i < 3; i++) {
    assert.match(
      await items.nth(i).innerText(),
      new RegExp(`· ${[2, 8, 18][i]} triangles · ${[1, 4, 9][i]}.00 mm²`),
    );
  }
  await controls
    .getByRole("button", { name: "Next item", exact: true })
    .click();
  assert.equal(await items.nth(1).getAttribute("aria-pressed"), "true");
  await controls
    .getByRole("button", { name: "Previous item", exact: true })
    .click();
  assert.equal(await items.nth(0).getAttribute("aria-pressed"), "true");
  assert.equal(
    (await call("project_get")).result.undo,
    baseline,
    "Component navigation added history",
  );
  const results = [];
  for (const c of cases) {
    await reset();
    await open();
    await controls.getByRole("button", { name: /· 8 triangles ·/ }).click();
    if (c.threshold !== undefined) {
      if (c.area) {
        await controls.locator(".app-select > button").click();
        await page
          .getByRole("option", {
            name: "Area smaller than (mm²)",
            exact: true,
          })
          .click();
      }
      await controls
        .getByRole("spinbutton", { name: "Threshold", exact: true })
        .fill(String(c.threshold));
    }
    await page.screenshot({
      path: fileURLToPath(new URL(`${c.name}-before.png`, out)),
    });
    await controls.getByRole("button", { name: c.button, exact: true }).click();
    await waitHistory(baseline + 1);
    const guiProject = (await call("project_get")).result;
    let guiGeometry;
    if (c.extract) {
      assert.equal(guiProject.objects.length, 2);
      const created = guiProject.objects.find((o) => o.id !== "scan");
      assert.equal(
        guiProject.objects.find((o) => o.id === "scan").visible,
        true,
      );
      assert.equal(created.visible, true);
      assert.equal(created.source, "manufactured-components-control.stl");
      assert.equal(
        (await call("application_inspect")).result.selectedId,
        created.id,
        "GUI did not select extracted owner",
      );
      rawEqual(
        await geometry(),
        [...groups[0], ...groups[2]],
        "GUI extraction remainder mismatch",
      );
      guiGeometry = await geometry(
        guiProject.objects.find((o) => o.id !== "scan").id,
      );
    } else guiGeometry = await geometry();
    rawEqual(
      guiGeometry,
      c.expected,
      `GUI ${c.name} differs from raw-corner oracle`,
    );
    const guiIndex = preciseComponents
      ? await checkedIndex(
          c.extract
            ? guiProject.objects.find((o) => o.id !== "scan").id
            : "scan",
          c.expected,
        )
      : undefined;
    await page.screenshot({
      path: fileURLToPath(new URL(`${c.name}-after.png`, out)),
    });
    await reset();
    await runEdit({ action: c.action, indices: c.indices });
    const mcpProject = (await call("project_get")).result;
    let mcpGeometry;
    if (c.extract) {
      assert.equal(mcpProject.objects.length, 2);
      const created = mcpProject.objects.find((o) => o.id !== "scan");
      assert.equal(
        mcpProject.objects.find((o) => o.id === "scan").visible,
        true,
      );
      assert.equal(created.visible, true);
      assert.equal(created.source, "manufactured-components-control.stl");
      assert.equal(
        (await call("application_inspect")).result.selectedId,
        created.id,
        "MCP did not select extracted owner",
      );
      assert.equal(
        created.name,
        guiProject.objects.find((o) => o.id !== "scan").name,
        "GUI/MCP extracted names differ",
      );
      rawEqual(
        await geometry(),
        [...groups[0], ...groups[2]],
        "MCP extraction remainder mismatch",
      );
      mcpGeometry = await geometry(
        mcpProject.objects.find((o) => o.id !== "scan").id,
      );
    } else mcpGeometry = await geometry();
    rawEqual(mcpGeometry, c.expected, `MCP ${c.name} differs from oracle`);
    rawEqual(mcpGeometry, guiGeometry, `GUI/MCP ${c.name} mismatch`);
    if (preciseComponents) {
      const mcpIndex = await checkedIndex(
        c.extract ? mcpProject.objects.find((o) => o.id !== "scan").id : "scan",
        c.expected,
      );
      assert.deepEqual(
        mcpIndex,
        guiIndex,
        `GUI/MCP ${c.name} topology mismatch`,
      );
    }
    await mutate("history_undo", {});
    rawEqual(await geometry(), positions, "Undo changed source");
    assert.equal(
      (await call("project_get")).result.objects.find((o) => o.id === "scan")
        .visible,
      true,
      "Undo did not restore original visibility",
    );
    await mutate("history_redo", {});
    if (c.extract)
      rawEqual(
        await geometry(
          (await call("project_get")).result.objects.find(
            (o) => o.id !== "scan",
          ).id,
        ),
        c.expected,
        "Redo lost extracted owner",
      );
    else rawEqual(await geometry(), c.expected, "Redo changed output");
    const saved = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: saved.result.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: saved.result.artifactId });
    const reopened = (await call("project_get")).result;
    if (c.extract) {
      assert.equal(reopened.objects.length, 2);
      rawEqual(
        await geometry(),
        [...groups[0], ...groups[2]],
        "Reopen altered extraction remainder",
      );
      rawEqual(
        await geometry(reopened.objects.find((o) => o.id !== "scan").id),
        c.expected,
        "Reopen changed extraction",
      );
    } else
      rawEqual(await geometry(), c.expected, "Reopen changed component output");
    if (preciseComponents)
      await checkedIndex(
        c.extract ? reopened.objects.find((o) => o.id !== "scan").id : "scan",
        c.expected,
      );
    results.push({
      name: c.name,
      triangles: c.expected.length / 9,
      geometrySha256: digest(c.expected),
      guiMcpParity: true,
      rawCornerOracle: true,
      undoRedo: true,
      binarySaveReopen: true,
      sourceVisibilityAndSelection: c.extract ? true : null,
    });
    // Binary import starts a new history; reimport the immutable original for the next case.
    const source = (
      await call("artifact_put", {
        name: "component-control.json",
        offset: 0,
        base64: Buffer.from(JSON.stringify(project)).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: source.artifactId,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: source.artifactId });
    assert.equal((await call("project_get")).result.undo, baseline);
  }
  await reset();
  await page.evaluate(() => {
    window.__holdComponentResult = true;
    window.__pendingComponentResult = false;
  });
  const cancelled = await mutate("mesh_process", {
    entityId: "scan",
    operation: {
      kind: "scanEdit",
      action: "componentRemove",
      indices: [small],
    },
  });
  await page.waitForFunction(() => window.__pendingComponentResult);
  const heldMcpProgress = (
    await call("job_get", { jobId: cancelled.result.jobId })
  ).result;
  assert.equal(heldMcpProgress.status, "running");
  assert(
    heldMcpProgress.progress >= 0 && heldMcpProgress.progress < 1,
    "MCP job reported completion before result delivery",
  );
  await call("job_cancel", { jobId: cancelled.result.jobId });
  await job(cancelled, "cancelled");
  await page.evaluate(() => {
    window.__holdComponentResult = false;
  });
  rawEqual(await geometry(), positions, "Cancelled result changed original");
  assert.equal((await call("project_get")).result.undo, baseline);
  await open();
  if (process.env.SCANFORGE_COMPONENT_RIPPLE_CAPTURE === "1")
    await controls
      .getByRole("button", { name: /Mesh 2 · 8 triangles/ })
      .click();
  await page.evaluate(() => {
    window.__holdComponentResult = true;
    window.__pendingComponentResult = false;
  });
  await controls
    .getByRole("button", { name: "Leave selected only", exact: true })
    .click();
  await page.waitForFunction(() => window.__pendingComponentResult);
  const heldGuiProgress = (await call("application_inspect")).result.progress
    .scan;
  await page.setViewportSize({ width: 1400, height: 600 });
  await controls.locator(".tool-panel-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const guiStatus = controls.getByRole("status");
  await guiStatus.waitFor({ state: "visible" });
  const progressLayout = await guiStatus.evaluate((element) => {
    const panel = element.closest("section");
    const fieldset = panel?.querySelector("fieldset");
    const box = element.getBoundingClientRect();
    const panelBox = panel?.getBoundingClientRect();
    const footerBox = panel?.querySelector("footer")?.getBoundingClientRect();
    return {
      outsideScroller: !element.closest(".tool-panel-content"),
      panelBusy: panel?.getAttribute("aria-busy"),
      controlsBusy: fieldset?.getAttribute("aria-busy"),
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      textInset: parseFloat(getComputedStyle(element).paddingLeft),
      panelLeft: panelBox?.left,
      panelTop: panelBox?.top,
      footerTop: footerBox?.top,
      viewportHeight: innerHeight,
    };
  });
  assert(
    progressLayout.outsideScroller &&
      progressLayout.panelBusy !== "true" &&
      progressLayout.controlsBusy === "true",
    "GUI status is inside the busy or scrolling controls",
  );
  assert(
    progressLayout.left + progressLayout.textInset >=
      progressLayout.panelLeft + 8,
    "GUI status text is not aligned inside the panel",
  );
  assert(
    progressLayout.top >= Math.max(0, progressLayout.panelTop) &&
      progressLayout.bottom <=
        Math.min(progressLayout.viewportHeight, progressLayout.footerTop),
    "GUI status is outside the visible panel area",
  );
  await page.screenshot({
    path: fileURLToPath(new URL("component-progress-status.png", out)),
  });
  const heldGuiStatus = await guiStatus.innerText();
  await page.setViewportSize({ width: 1400, height: 900 });
  const displayedPercent = /·\s*(\d+)%/.exec(heldGuiStatus);
  assert(
    displayedPercent && Number(displayedPercent[1]) < 100,
    `GUI reported premature completion: ${heldGuiStatus}`,
  );
  if (process.env.SCANFORGE_COMPONENT_RIPPLE_CAPTURE === "1")
    await page
      .locator("canvas")
      .first()
      .screenshot({
        path: fileURLToPath(new URL("component-processing-ripple.png", out)),
      });
  await controls
    .getByRole("button", { name: "Cancel and back", exact: true })
    .click();
  await page.evaluate(() => {
    window.__holdComponentResult = false;
  });
  rawEqual(await geometry(), positions, "Cancelled GUI result changed source");
  assert.equal((await call("project_get")).result.undo, baseline);
  const cornerNormals = positions.map((_, index) =>
    index % 3 === 0 ? (Math.floor(index / 9) % 2 ? -1 : 1) : 0,
  );
  const normalProject = {
    ...project,
    entities: [
      {
        ...project.entities[0],
        indexedMesh: undefined,
        normals: cornerNormals,
      },
    ],
  };
  const normalArtifact = (
    await call("artifact_put", {
      name: "component-corner-normals.json",
      offset: 0,
      base64: Buffer.from(JSON.stringify(normalProject)).toString("base64"),
    })
  ).result.artifactId;
  await job(
    await mutate("project_import", {
      artifactId: normalArtifact,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: normalArtifact });
  await mutate("object_select", { entityId: "scan" });
  await open();
  await controls.getByRole("button", { name: /· 8 triangles ·/ }).click();
  const normalBaseline = (await call("project_get")).result.undo;
  await controls
    .getByRole("button", { name: "Create new object", exact: true })
    .click();
  await waitHistory(normalBaseline + 1);
  const normalGui = (await call("project_get")).result;
  const normalGuiPart = normalGui.objects.find(
    (object) => object.id !== "scan",
  );
  const readGeometry = async (entityId) =>
    artifactJson(
      (await call("object_get", { entityId, includeGeometry: true })).result
        .geometry,
    );
  const expectedNormalPart = cornerNormals.slice(
    groups[0].length,
    groups[0].length + groups[1].length,
  );
  const expectedNormalRest = [
    ...cornerNormals.slice(0, groups[0].length),
    ...cornerNormals.slice(groups[0].length + groups[1].length),
  ];
  assert.deepEqual((await readGeometry("scan")).normals, expectedNormalRest);
  assert.deepEqual(
    (await readGeometry(normalGuiPart.id)).normals,
    expectedNormalPart,
  );
  await mutate("history_undo", {});
  await runEdit({ action: "componentExtract", indices: [middle] });
  const normalMcp = (await call("project_get")).result;
  const normalMcpPart = normalMcp.objects.find(
    (object) => object.id !== "scan",
  );
  assert.deepEqual((await readGeometry("scan")).normals, expectedNormalRest);
  assert.deepEqual(
    (await readGeometry(normalMcpPart.id)).normals,
    expectedNormalPart,
  );
  const normalSaved = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: normalSaved.result.artifactId,
      replace: true,
    }),
  );
  await call("artifact_delete", { artifactId: normalSaved.result.artifactId });
  assert.deepEqual((await readGeometry("scan")).normals, expectedNormalRest);
  assert.deepEqual(
    (await readGeometry(normalMcpPart.id)).normals,
    expectedNormalPart,
  );
  let largeIndexedInventory;
  if (process.env.SCANFORGE_COMPONENT_LARGE_INDEXED === "1") {
    const vertices = [],
      triangles = [],
      expanded = [];
    const width = 256,
      height = 129;
    for (let y = 0; y <= height; y++)
      for (let x = 0; x <= width; x++) vertices.push(x, y, 0);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const a = y * (width + 1) + x,
          b = a + 1;
        const d = a + width + 1,
          c = d + 1;
        triangles.push(a, b, c, a, c, d);
        for (const id of [a, b, c, a, c, d])
          expanded.push(
            vertices[id * 3],
            vertices[id * 3 + 1],
            vertices[id * 3 + 2],
          );
      }
    const largeProject = {
      ...project,
      entities: [
        {
          ...project.entities[0],
          positions: expanded,
          indexedMesh: { vertices, triangles },
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(largeProject));
    let artifactId;
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      const part = (
        await call("artifact_put", {
          name: "large-indexed-control.json",
          ...(artifactId ? { artifactId } : {}),
          offset,
          base64: bytes.subarray(offset, offset + 262144).toString("base64"),
        })
      ).result;
      artifactId = part.artifactId;
    }
    await job(await mutate("project_import", { artifactId, replace: true }));
    await call("artifact_delete", { artifactId });
    const largeReport = await artifactJson(
      (await runEdit({ action: "inventory", inventoryScope: "components" }))
        .result.artifact,
    );
    assert.equal(largeReport.inventory.components.length, 1);
    const component = largeReport.inventory.components[0];
    assert(
      Array.isArray(component.triangles),
      "MCP artifact must contain a JSON array",
    );
    assert.equal(component.triangles.length, width * height * 2);
    assert.equal(new Set(component.triangles).size, width * height * 2);
    assert.equal(component.area, width * height);
    assert.equal((await geometry()).length, expanded.length);
    const largeProgressStart = await page.evaluate(
      () => window.__componentProgressTrace.length,
    );
    await runEdit({ action: "componentExtract", indices: [0] });
    const largeComponentProgress = await page.evaluate(
      (start) =>
        window.__componentProgressTrace
          .slice(start)
          .filter((entry) => entry.action === "componentExtract"),
      largeProgressStart,
    );
    assert(
      largeComponentProgress.some(
        (entry) => entry.stage === "Packing precise scan segments",
      ),
      "Indexed extraction packing progress was not observed",
    );
    assert(
      largeComponentProgress.every((entry) => entry.progress < 1),
      "Indexed extraction reported completion before result delivery",
    );
    assert.deepEqual(
      largeComponentProgress.map((entry) => entry.progress),
      [...largeComponentProgress.map((entry) => entry.progress)].sort(
        (a, b) => a - b,
      ),
      "Indexed extraction progress moved backwards",
    );
    const extractedProject = (await call("project_get")).result;
    const extracted = extractedProject.objects.find(
      (object) => object.id !== "scan",
    );
    assert(extracted, "MCP did not publish the indexed component");
    assert.deepEqual(await geometry(extracted.id), expanded);
    assert.deepEqual(await geometry(), []);
    await mutate("history_undo", {});
    assert.deepEqual(await geometry(), expanded);
    await mutate("history_redo", {});
    assert.deepEqual(await geometry(extracted.id), expanded);
    const smallPart = [1000, 0, 0, 1001, 0, 0, 1000, 1, 0];
    const firstVertex = vertices.length / 3;
    const mixedProject = {
      ...largeProject,
      entities: [
        {
          ...largeProject.entities[0],
          positions: [...expanded, ...smallPart],
          indexedMesh: {
            vertices: [...vertices, ...smallPart],
            triangles: [
              ...triangles,
              firstVertex,
              firstVertex + 1,
              firstVertex + 2,
            ],
          },
        },
      ],
    };
    const mixedBytes = Buffer.from(JSON.stringify(mixedProject));
    let mixedArtifact;
    for (let offset = 0; offset < mixedBytes.length; offset += 262144) {
      const part = (
        await call("artifact_put", {
          name: "large-indexed-remainder.json",
          ...(mixedArtifact ? { artifactId: mixedArtifact } : {}),
          offset,
          base64: mixedBytes
            .subarray(offset, offset + 262144)
            .toString("base64"),
        })
      ).result;
      mixedArtifact = part.artifactId;
    }
    await job(
      await mutate("project_import", {
        artifactId: mixedArtifact,
        replace: true,
      }),
    );
    await call("artifact_delete", { artifactId: mixedArtifact });
    await runEdit({ action: "componentExtract", indices: [1] });
    const mixedResult = (await call("project_get")).result;
    const small = mixedResult.objects.find((object) => object.id !== "scan");
    assert(small, "MCP did not publish the small component");
    assert.deepEqual(await geometry(small.id), smallPart);
    assert.deepEqual(await geometry(), expanded);
    await mutate("history_undo", {});
    assert.deepEqual(await geometry(), [...expanded, ...smallPart]);
    await mutate("history_redo", {});
    assert.deepEqual(await geometry(), expanded);
    largeIndexedInventory = {
      triangles: component.triangles.length,
      area: component.area,
      jsonArray: true,
      publicMcpExtractUndoRedo: true,
      smallComponentLargeRemainder: true,
      progress: largeComponentProgress,
    };
  }
  assert.deepEqual(errors, []);
  ledger.result = {
    nativeStlKeyBoundary: {
      low: { vertices: 4, components: 1 },
      high: { vertices: 6, components: 2 },
      guiMcp: true,
    },
    collapsedUnindexedNativeFixture: {
      guiMcpComponents: 1,
      triangles: 2,
      guiMcpExtractAndUndo: true,
      pendingFailureAndRetry: true,
      fullAndScopedInventory: true,
      originalCornersPreserved: true,
    },
    nearEdgeNativeControl: {
      nativeComponents: 2,
      indexedGuiMcp: 2,
      unindexedGuiMcp: 1,
      toleranceMm: 0.001,
    },
    browserHeapLimitBytes: ledger.browserHeapLimitBytes,
    nativeLifecycleExport: {
      nativeOutputSha256:
        "c7f98fe653e3b228756dbe675673c86e72e6b26e402ee3fea3763d2f9e413e97",
      guiMcpOrderedCoordinatesMatch: true,
      guiMcpFacetNormalsMatch: true,
      guiComponentProgress,
      mcpComponentProgress,
      sourceRemainder: true,
      guiMcpUndoRedo: true,
      binaryReopen: true,
    },
    nativeFixture: {
      triangles: 2,
      guiComponents: 1,
      mcpComponents: 1,
      guiMcpExtraction: true,
    },
    inputCoordinateSha256: digest(positions),
    componentTriangles: [2, 8, 18],
    componentAreas: report.inventory.components.map((c) => c.area),
    inventoryHistoryIsolation: true,
    renderedCountsAreasAndNavigation: true,
    cases: results,
    mcpHeldResultCancellation: true,
    heldMcpProgress: {
      status: heldMcpProgress.status,
      progress: heldMcpProgress.progress,
      stage: heldMcpProgress.stage,
    },
    guiCancelAndBack: true,
    heldGuiProgress,
    heldGuiStatus,
    progressLayout,
    independentCornerNormalsGuiMcp: true,
    pageErrors: errors,
    largeIndexedInventory,
  };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
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
  await unlink(fixturePath).catch((error) => {
    if (error.code !== "ENOENT") failed ??= error;
  });
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("component-cleanup-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
