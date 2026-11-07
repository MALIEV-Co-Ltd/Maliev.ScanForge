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
    "../.resources/scan-transform-preview-browser/",
    import.meta.url,
  );
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
    owner: "scan-transform-preview-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server,
  reserve,
  browserServer,
  browser,
  client,
  transport,
  failed,
  currentPage;
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
  client = new Client({ name: "transform-validation", version: "1" });
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
    new URL("scan-transform-preview-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  currentPage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__transformRequests = [];
    window.__transformStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.processing = String(url).includes("processing-worker");
        if (this.processing)
          this.addEventListener("message", (e) => {
            if (e.data.stage) window.__transformStages.push(e.data.stage);
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
        if (this.processing) window.__transformRequests.push(data.kind);
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

  const fixture = async (name) =>
    JSON.parse(await readFile(new URL(`tests/fixtures/${name}`, root), "utf8"));
  const decode = (hex) =>
    Array.from(
      new Float32Array(Uint8Array.from(Buffer.from(hex, "hex")).buffer),
    );
  const bits = (values) =>
    Buffer.from(new Float32Array(values).buffer).toString("hex");
  const scale = (await fixture("scale-geometry-native.json")).cases.find(
    (c) => c.name === "annular" && c.factor === 1.1,
  );
  const mirror = (await fixture("mirror-coordinate-native.json")).cases[0];
  const tilted = (await fixture("mirror-nurbs-plane-native.json")).cases[0];
  const flip = (await fixture("flip-kernel-native.json")).cases[0];
  const runs = [
    {
      name: "Scale mesh",
      entry: scale,
      settings: { kind: "scaleMesh", factor: 1.1 },
      op: { kind: "scaleMesh", factor: 1.1 },
    },
    {
      name: "Mirror mesh",
      label: "mirror-origin",
      entry: mirror,
      settings: { kind: "mirrorMesh", plane: "OXY" },
      op: {
        kind: "mirrorMesh",
        center: mirror.plane.center,
        normal: mirror.plane.normal,
      },
    },
    {
      name: "Mirror mesh",
      label: "mirror-tilted",
      entry: tilted,
      settings: { kind: "mirrorMesh", plane: "object", referenceId: "plane" },
      op: {
        kind: "mirrorMesh",
        center: tilted.plane.center,
        normal: tilted.plane.normal,
        tangent: tilted.plane.tangent,
      },
    },
    { name: "Flip normals", entry: flip, op: { kind: "flipNormals" } },
  ];
  const results = [];
  for (const run of runs) {
    console.log(
      JSON.stringify({ stage: "start", case: run.label ?? run.name }),
    );
    const source = mesh(
      "source",
      "Native control",
      decode(run.entry.inputBits),
    );
    const inputs = [source];
    if (run.label === "mirror-tilted") {
      const { center, normal, tangent } = tilted.plane;
      const cross = [
        normal[1] * tangent[2] - normal[2] * tangent[1],
        normal[2] * tangent[0] - normal[0] * tangent[2],
        normal[0] * tangent[1] - normal[1] * tangent[0],
      ];
      const point = (u, v) =>
        center.map((c, i) => c + u * tangent[i] + v * cross[i]);
      inputs.push({
        ...mesh("plane", "Observed reference plane", [
          ...point(0, 0),
          ...point(10, 0),
          ...point(0, 10),
        ]),
        kind: "plane",
        planeFrame: { center, normal, tangent },
      });
    }
    const upload = (
      await call("artifact_put", {
        name: "transform.json",
        offset: 0,
        base64: Buffer.from(
          JSON.stringify({
            format: "maliev-scanforge",
            version: 1,
            name: run.label ?? run.name,
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
    await mutate("object_select", { entityId: source.id });
    const h = await history();
    await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
    await page.getByRole("button", { name: run.name, exact: true }).click();
    const panel = page.getByRole("region", { name: run.name, exact: true });
    if (run.settings) await panel.waitFor();
    if (run.name === "Scale mesh") {
      await panel
        .getByRole("button", { name: "Scale by", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Percentage", exact: true })
        .click();
      await panel
        .getByRole("spinbutton", { name: "Scale (%)", exact: true })
        .fill("110");
    }
    if (run.label === "mirror-tilted") {
      await panel
        .getByRole("button", { name: "Mirror plane", exact: true })
        .click();
      await page
        .getByRole("option", { name: "CAD / construction plane", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Reference plane", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Observed reference plane", exact: true })
        .click();
    }
    if (run.settings) {
      await panel
        .locator("footer")
        .getByRole("button", { name: "Preview", exact: true })
        .last()
        .click();
      await panel
        .getByRole("button", { name: "Accept", exact: true })
        .waitFor();
      assert.equal(
        bits((await geometry(source.id)).positions),
        run.entry.inputBits,
      );
      assert.equal(await history(), h);
      await panel.getByRole("button", { name: "Accept", exact: true }).click();
    }
    for (let i = 0; i < 120 && (await history()) === h; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(await history(), h + 1);
    assert.equal(
      bits((await geometry(source.id)).positions),
      run.entry.nativeBits,
    );
    await mutate("history_undo", {});
    assert.equal(
      bits((await geometry(source.id)).positions),
      run.entry.inputBits,
    );
    await mutate("history_redo", {});
    assert.equal(
      bits((await geometry(source.id)).positions),
      run.entry.nativeBits,
    );
    await mutate("history_undo", {});
    if (run.settings) {
      const create = async () =>
        await job(
          await mutate("scan_preview", {
            action: "create",
            entityId: source.id,
            operation: run.settings,
          }),
        );
      let preview = await create();
      await job(
        await mutate("scan_preview", {
          action: "cancel",
          entityId: source.id,
          previewId: preview.result.previewId,
        }),
      );
      assert.equal(await history(), h);
      assert.equal(
        bits((await geometry(source.id)).positions),
        run.entry.inputBits,
      );
      preview = await create();
      const accepted = await job(
        await mutate("scan_preview", {
          action: "accept",
          entityId: source.id,
          previewId: preview.result.previewId,
        }),
      );
      assert.equal(accepted.result.accepted, true);
      assert.equal(
        bits((await geometry(source.id)).positions),
        run.entry.nativeBits,
      );
      await mutate("history_undo", {});
    }
    await job(
      await mutate("mesh_process", {
        entityId: source.id,
        operation: { kind: "scanTools", operation: run.op },
      }),
    );
    assert.equal(
      bits((await geometry(source.id)).positions),
      run.entry.nativeBits,
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
    assert.equal(
      bits((await geometry(source.id)).positions),
      run.entry.nativeBits,
    );
    await mutate("object_select", { entityId: source.id });
    await mutate("viewport_control", { action: "fit", entityId: source.id });
    await page.screenshot({
      path: fileURLToPath(new URL(`${run.label ?? run.op.kind}.png`, out)),
    });
    results.push({
      case: run.label ?? run.name,
      coordinateBytesMatchRetainedNative: true,
      guiDirectMcpEqual: true,
      publicPreview: !!run.settings,
      undoRedo: true,
      persistence: true,
    });
    const close = panel.getByRole("button", {
      name: run.settings ? "Cancel" : "Close",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
  }
  assert.deepEqual(errors, []);
  ledger.result = { cases: results, pageErrors: errors };
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  if (currentPage) {
    await currentPage
      .screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
      .catch(() => {});
    await writeFile(
      new URL("failure-dom.txt", out),
      await currentPage.locator("body").innerText(),
    ).catch(() => {});
  }
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
    new URL("scan-transform-preview-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
