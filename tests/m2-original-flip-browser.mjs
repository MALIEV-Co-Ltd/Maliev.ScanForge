import { m2BrowserHeapFlag } from "./m2-memory.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL(
    process.env.SCANFORGE_M2_FLIP_BROWSER_OUTPUT ??
      "../.resources/m2-original-flip-browser/",
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
    owner: "m2-original-flip-browser",
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
    args: ["--enable-unsafe-swiftshader", m2BrowserHeapFlag],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("m2-original-flip-browser-ledger.json", out),
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

  const history = async () => (await call("history_get")).result.cursor;

  if (process.env.SCANFORGE_M2_LARGE_STL_INPUT) {
    const path = process.env.SCANFORGE_M2_LARGE_STL_INPUT;
    const inputHash = createHash("sha256");
    for await (const chunk of createReadStream(path)) inputHash.update(chunk);
    assert.equal(
      inputHash.digest("hex"),
      "bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2",
    );
    await page.locator('input[type=file][accept*=".stl"]').setInputFiles(path);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .locator('.status-message[title^="Opened · 1/1 files"]')
      .waitFor({ timeout: 180000 });
    const before = await call("project_get");
    assert.equal(before.result.objects.length, 1);
    assert.equal(before.result.objects[0].triangles, 3691133);
    assert.equal(before.result.objects[0].indexedTopology?.triangles, 3691133);
    const cursor = await history();
    await page.evaluate(() => {
      let last = performance.now();
      window.__m2ExportTiming = { maximumGapMs: 0, ticks: 0 };
      window.__m2ExportTimer = setInterval(() => {
        const now = performance.now();
        window.__m2ExportTiming.maximumGapMs = Math.max(
          window.__m2ExportTiming.maximumGapMs,
          now - last,
        );
        window.__m2ExportTiming.ticks++;
        last = now;
      }, 100);
    });
    const exported = (
      await job(await call("project_export", { format: "stl" }))
    ).result;
    const agentHash = createHash("sha256");
    let nonGeometricNormal = false;
    try {
      for (let offset = 0; offset < exported.bytes;) {
        const part = (
          await call("artifact_read", {
            artifactId: exported.artifactId,
            offset,
            length: 262144,
          })
        ).result;
        const bytes = Buffer.from(part.base64, "base64");
        assert(bytes.length > 0);
        if (offset === 0) {
          for (let face = 0; face < 1000; face++) {
            const at = 84 + face * 50;
            const point = (corner) =>
              [0, 1, 2].map((axis) =>
                bytes.readFloatLE(at + 12 + corner * 12 + axis * 4),
              );
            const [a, b, c] = [point(0), point(1), point(2)];
            const u = b.map((v, i) => v - a[i]);
            const v = c.map((v, i) => v - a[i]);
            const cross = [
              u[1] * v[2] - u[2] * v[1],
              u[2] * v[0] - u[0] * v[2],
              u[0] * v[1] - u[1] * v[0],
            ];
            const length = Math.hypot(...cross);
            if (
              length &&
              cross.some(
                (component, axis) =>
                  Math.abs(
                    component / length - bytes.readFloatLE(at + axis * 4),
                  ) > 1e-5,
              )
            )
              nonGeometricNormal = true;
          }
        }
        agentHash.update(bytes);
        offset += bytes.length;
      }
      const pending = page.waitForEvent("download", { timeout: 180000 });
      await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
      await page
        .getByRole("button", { name: "Export visible", exact: true })
        .click();
      const download = await pending;
      const downloadPath = fileURLToPath(new URL("large-gui-export.stl", out));
      let guiDigest;
      try {
        await download.saveAs(downloadPath);
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(downloadPath))
          hash.update(chunk);
        guiDigest = hash.digest("hex");
      } finally {
        await download.delete();
        await unlink(downloadPath).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      const mcpDigest = agentHash.digest("hex");
      assert.equal(guiDigest, mcpDigest);
      assert.equal(exported.bytes, 84 + 3691133 * 50);
      assert(
        nonGeometricNormal,
        "Large export did not exercise non-geometric indexed normals",
      );
      const timing = await page.evaluate(() => {
        clearInterval(window.__m2ExportTimer);
        return window.__m2ExportTiming;
      });
      assert.deepEqual(errors, []);
      assert.equal((await call("project_get")).revision, before.revision);
      assert.equal(await history(), cursor);
      ledger.result = {
        mode: "large-stl-export",
        facets: 3691133,
        bytes: exported.bytes,
        guiMcpSha256: guiDigest,
        nonGeometricNormal,
        timing,
        pageErrors: errors,
      };
      console.log(JSON.stringify(ledger.result));
    } finally {
      await call("artifact_delete", { artifactId: exported.artifactId });
    }
  } else {
    const sourcePath = process.env.SCANFORGE_M2_FIRST_STL;
    assert(sourcePath, "Set SCANFORGE_M2_FIRST_STL to original scan 1");
    assert.equal(
      createHash("sha256")
        .update(await readFile(sourcePath))
        .digest("hex"),
      "6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9",
    );
    await page
      .locator('input[type=file][accept*=".stl"]')
      .setInputFiles(sourcePath);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .getByRole("button", { name: "scan-1.stl", exact: true })
      .waitFor({ timeout: 180000 });
    const source = (await call("project_get")).result.objects.find(
      (o) => o.name === "scan-1.stl",
    );
    assert(source, "Imported source not found");
    const target = source.id;
    const digest = async () =>
      (
        await job(await call("object_geometry_digest", { entityId: target }))
      ).result.buffers.map(({ path, encoding, elements, sha256 }) => ({
        path,
        encoding,
        elements,
        sha256,
      }));
    const before = await digest();
    const pos = (v) => v.find((b) => b.path === "positions");
    console.log(JSON.stringify({ before: pos(before) }));
    assert.equal(
      pos(before).sha256,
      "e78677c506a4a8e98711e68a91ab5f856eedfae7b153db0c57d7f3bf77659612",
    );
    const cursor = await history();
    await mutate("object_select", { entityId: target });
    await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
    await page
      .getByRole("button", { name: "Flip normals", exact: true })
      .click();
    for (let i = 0; i < 600 && (await history()) === cursor; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(await history(), cursor + 1, "GUI Flip did not commit");
    const gui = await digest();
    console.log(JSON.stringify({ gui: pos(gui) }));
    assert.equal(
      pos(gui).sha256,
      "ebd5c98c917d3d72a91233c602608d551792c82ec1e5b14a8b0937460c537ebf",
    );
    await page.screenshot({
      path: fileURLToPath(new URL("gui-flip.png", out)),
    });
    await mutate("history_undo", {});
    assert.deepEqual(await digest(), before);
    await job(
      await mutate("mesh_process", {
        entityId: target,
        operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
      }),
    );
    const mcp = await digest();
    assert.deepEqual(mcp, gui);
    assert.equal(await history(), cursor + 1);
    let guiMcpStl;
    if (process.env.SCANFORGE_M2_FLIP_EXPORT_PARITY === "1") {
      const exported = (
        await job(await call("project_export", { format: "stl" }))
      ).result;
      const parts = [];
      for (let offset = 0; offset < exported.bytes;) {
        const part = (
          await call("artifact_read", {
            artifactId: exported.artifactId,
            offset,
            length: 262144,
          })
        ).result;
        const bytes = Buffer.from(part.base64, "base64");
        assert(bytes.length > 0);
        parts.push(bytes);
        offset += bytes.length;
      }
      const mcpStl = Buffer.concat(parts);
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export visible", exact: true })
        .click();
      const download = await pending;
      const guiPath = fileURLToPath(new URL("gui-export.stl", out));
      let guiStl;
      try {
        await download.saveAs(guiPath);
        guiStl = await readFile(guiPath);
      } finally {
        await download.delete();
        await unlink(guiPath).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      assert.equal(download.suggestedFilename(), "scanforge.stl");
      assert(mcpStl.equals(guiStl), "GUI and MCP STL exports differ");
      assert.equal(guiStl.readUInt32LE(80), 273139);
      const normalDigest = createHash("sha256");
      for (let face = 0; face < 273139; face++)
        normalDigest.update(guiStl.subarray(84 + face * 50, 96 + face * 50));
      const normalSha256 = normalDigest.digest("hex");
      assert.equal(
        normalSha256,
        "0f562055b81f54e5bdfb3b9169df8e22d291844e21b4176e7e1586b34bacb984",
        "GUI/MCP export normal stream differs from the recorded native result",
      );
      await call("artifact_delete", { artifactId: exported.artifactId });
      guiMcpStl = {
        bytes: guiStl.length,
        sha256: createHash("sha256").update(guiStl).digest("hex"),
        normalSha256,
        identical: true,
      };
    }
    let stlComparison;
    if (process.env.SCANFORGE_M2_FLIP_NATIVE_STL) {
      const native = await readFile(process.env.SCANFORGE_M2_FLIP_NATIVE_STL);
      assert.equal(
        createHash("sha256").update(native).digest("hex"),
        "bb998c42328bdcc30d1ebd317d0af603213a0f9236e8307f8e6279a858a4133d",
      );
      const exported = (
        await job(await call("project_export", { format: "stl" }))
      ).result;
      const parts = [];
      for (let offset = 0; offset < exported.bytes;) {
        const part = (
          await call("artifact_read", {
            artifactId: exported.artifactId,
            offset,
            length: 262144,
          })
        ).result;
        const bytes = Buffer.from(part.base64, "base64");
        assert(bytes.length > 0);
        parts.push(bytes);
        offset += bytes.length;
      }
      const output = Buffer.concat(parts);
      assert.equal(output.length, native.length);
      const count = output.readUInt32LE(80);
      assert.equal(count, 273139);
      assert.equal(native.readUInt32LE(80), count);
      let exactNormals = 0,
        maxComponentDifference = 0,
        sumSquaredDifference = 0;
      const nativeNormals = createHash("sha256"),
        appNormals = createHash("sha256");
      for (let i = 0; i < count; i++) {
        const at = 84 + i * 50;
        assert(
          output
            .subarray(at + 12, at + 48)
            .equals(native.subarray(at + 12, at + 48)),
          `Coordinate mismatch at facet ${i}`,
        );
        const n = native.subarray(at, at + 12),
          a = output.subarray(at, at + 12);
        nativeNormals.update(n);
        appNormals.update(a);
        if (n.equals(a)) exactNormals++;
        for (let j = 0; j < 3; j++) {
          const delta = n.readFloatLE(j * 4) - a.readFloatLE(j * 4);
          assert(Number.isFinite(delta));
          maxComponentDifference = Math.max(
            maxComponentDifference,
            Math.abs(delta),
          );
          sumSquaredDifference += delta * delta;
        }
      }
      stlComparison = {
        facets: count,
        orderedCoordinatesIdentical: true,
        exactNormalRecords: exactNormals,
        maxComponentDifference,
        rmsComponentDifference: Math.sqrt(sumSquaredDifference / (count * 3)),
        nativeNormalSha256: nativeNormals.digest("hex"),
        appNormalSha256: appNormals.digest("hex"),
        appStlSha256: createHash("sha256").update(output).digest("hex"),
      };
      console.log(JSON.stringify({ stlComparison }));
    }
    const saved = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: saved.result.artifactId,
        replace: true,
      }),
    );
    const reopened = await digest();
    assert.deepEqual(reopened, gui);
    await mutate("history_undo", {});
    assert.deepEqual(await digest(), before);
    await mutate("history_redo", {});
    assert.deepEqual(await digest(), gui);
    assert.deepEqual(errors, []);
    ledger.result = {
      inputSha256:
        "6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9",
      nativeCoordinateSha256:
        "ebd5c98c917d3d72a91233c602608d551792c82ec1e5b14a8b0937460c537ebf",
      triangles: 273139,
      guiDigest: gui,
      mcpDigest: mcp,
      ...(guiMcpStl ? { guiMcpStl } : {}),
      ...(stlComparison ? { stlComparison } : {}),
      binaryReopen: true,
      undoRedo: true,
      pageErrors: errors,
    };
    console.log(JSON.stringify(ledger.result));
  }
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
    new URL("m2-original-flip-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
