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
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/split-lifecycle/", import.meta.url);
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
    `Split replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "split-lifecycle-browser",
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
const fixturePath = fileURLToPath(new URL("split-lifecycle-panel.stl", out));
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
  client = new Client({ name: "split-lifecycle-validation", version: "1" });
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
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=768",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    ...(process.env.SCANFORGE_SPLIT_COMPARE_RENDER
      ? { reducedMotion: "reduce" }
      : {}),
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (window.__holdSplitResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingSplitResult = true;
            }
          });
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
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Workspace did not settle before split validation");
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
  const digest = (positions) =>
    createHash("sha256")
      .update(Buffer.from(new Float32Array(positions).buffer))
      .digest("hex");
  const rawEqual = (actual, expected, message) =>
    assert.equal(digest(actual), digest(expected), message);

  const planeMesh = [
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1,
  ];
  const planeFit = {
    kind: "plane",
    center: [0, 0, 0],
    axis: [1, 0, 0],
    rms: 0,
    maxError: 0,
  };
  const planeSource = [-1, 4, 0, 1, 4, 0, 0, 5, 0];
  const bigSource = [
    -1, -1, 0.5, 3, -1, 0.5, 3, 3, 0.5, -1, -1, 0.5, 3, 3, 0.5, -1, 3, 0.5,
  ];
  const cubeCells = (cells) => {
    const occupied = new Set(cells.map((c) => c.join(","))),
      out = [];
    const vertices = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const sides = [
      { d: [0, 0, -1], ids: [0, 2, 1, 0, 3, 2] },
      { d: [0, 0, 1], ids: [4, 5, 6, 4, 6, 7] },
      { d: [0, -1, 0], ids: [0, 1, 5, 0, 5, 4] },
      { d: [1, 0, 0], ids: [1, 2, 6, 1, 6, 5] },
      { d: [0, 1, 0], ids: [2, 3, 7, 2, 7, 6] },
      { d: [-1, 0, 0], ids: [3, 0, 4, 3, 4, 7] },
    ];
    for (const cell of cells)
      for (const side of sides)
        if (!occupied.has(cell.map((v, i) => v + side.d[i]).join(",")))
          for (const id of side.ids)
            out.push(...vertices[id].map((v, i) => v + cell[i]));
    return out;
  };
  const radiusDirectory = process.env.SCANFORGE_SPLIT_RADIUS_INPUT_DIR;
  const readStlPositions = async (file) => {
    const bytes = await readFile(`${radiusDirectory}/${file}`);
    const count = bytes.readUInt32LE(80),
      positions = [];
    assert.equal(bytes.length, 84 + count * 50);
    for (let i = 0; i < count; i++)
      for (let j = 0; j < 9; j++)
        positions.push(bytes.readFloatLE(84 + i * 50 + 12 + j * 4));
    return positions;
  };
  const radiusCases = radiusDirectory
    ? await Promise.all(
        ["below", "at", "above"].map(async (label) => ({
          name: `point-radius-${label}`,
          source: await readStlPositions("source-triangle.stl"),
          target: await readStlPositions(`cutter-${label}.stl`),
          kind: "mesh",
          parts: 2,
          method: "open surface signed nearest grouping",
        })),
      )
    : [];
  const cases = [
    ...radiusCases,
    {
      name: "original-scan-face-7207",
      source: [
        19.898012161254883, 47.31754684448242, -315.9837341308594,
        20.04651641845703, 47.50707244873047, -315.9645080566406,
        20.04990005493164, 47.18638610839844, -315.8510437011719,
      ],
      target: [
        19.9250431060791, -149.8528594970703, -442.96917724609375,
        19.9250431060791, -149.8528594970703, 72.22071838378906,
        19.9250431060791, 406.9168701171875, -442.96917724609375,
      ],
      kind: "mesh",
      parts: 2,
      method: "open surface signed nearest grouping",
      originalFaceWinding: true,
    },
    {
      name: "sloped-edge-crossing",
      source: [0, 0, 0, 1, 3, 0, 0, 4, 0],
      target: [0, 0, -1, 1, 3, -1, 0, 0, 2],
      kind: "mesh",
      parts: 1,
      method: "open surface signed nearest grouping",
      requiredPoint: [2 / 3, 2, 0],
    },
    {
      name: "finite-interior-cut",
      source: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      target: [0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1],
      kind: "mesh",
      parts: process.env.SCANFORGE_SPLIT_OBSERVE_CURRENT ? 2 : 1,
      method: "open surface signed nearest grouping",
      finiteInterior: true,
    },
    {
      name: "tilted-coplanar-identical",
      source: [0, 0, 0, 7, 5, 21, 2, 2, 17],
      target: [0, 0, 0, 7, 5, 21, 2, 2, 17],
      kind: "mesh",
      parts: 1,
      method: "open surface signed nearest grouping",
      unchangedPart: true,
    },
    {
      name: "coplanar-shared-edge",
      source: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0],
      target: [0, 0.1, -1, 0, 0.9, -1, 0, 0.5, 1],
      kind: "mesh",
      parts: 1,
      method: "open surface signed nearest grouping",
      coplanarSharedEdge: true,
    },
    {
      name: "tolerance-shared-edge",
      source: [
        -0.00000075, 0, 0, 0.00000075, 0, 0, 1, 1, 0, 0.00000075, 0, 0,
        -0.00000075, 0, 0, 0, -1, 0,
      ],
      target: [0, -2, -1, 0, 2, -1, 0, 2, 1, 0, -2, -1, 0, 2, 1, 0, -2, 1],
      kind: "mesh",
      parts: 1,
      method: "open surface signed nearest grouping",
      sharedEdge: true,
    },
    {
      name: "near-plane-crossing",
      source: [-0.0000005, 0, 0, 1, 0.4, 0, -0.000002, 1, 0],
      target: planeMesh,
      kind: "plane",
      fit: planeFit,
      parts: 2,
      method: "infinite planar surface",
      sourceYBounds: [0, 1],
    },
    {
      name: "infinite-plane",
      source: planeSource,
      target: planeMesh,
      kind: "plane",
      fit: planeFit,
      parts: 2,
      areas: [0.5, 0.5],
      method: "infinite planar surface",
    },
    {
      name: "finite-planar-mesh",
      source: planeSource,
      target: planeMesh,
      kind: "mesh",
      fit: planeFit,
      parts: 1,
      areas: [1],
      method: "open surface signed nearest grouping",
    },
    {
      name: "open-folded-surface",
      source: [
        -0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 1.5, 0, -0.5, -0.5, 0, 1.5, 1.5, 0,
        -0.5, 1.5, 0,
      ],
      target: [
        0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 1,
        1, -1, 1, 1, 1, 0, 1, -1, 1, 1, 1, 0, 1, 1,
      ],
      kind: "mesh",
      parts: 2,
      method: "open surface signed nearest grouping",
    },
    {
      name: "closed-convex",
      source: bigSource,
      target: cubeCells([[0, 0, 0]]),
      kind: "mesh",
      parts: 2,
      areas: [1, 15],
      method: "closed convex mesh",
    },
    {
      name: "closed-concave",
      source: bigSource,
      target: cubeCells([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ]),
      kind: "mesh",
      parts: 2,
      areas: [3, 13],
      method: "closed mesh ray parity",
    },
  ];
  const sourceNormal = (p) => {
    const u = [0, 1, 2].map((i) => p[i + 3] - p[i]);
    const v = [0, 1, 2].map((i) => p[i + 6] - p[i]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  const area = (positions, reference) => {
    let result = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const u = [0, 1, 2].map((a) => positions[i + 3 + a] - positions[i + a]),
        v = [0, 1, 2].map((a) => positions[i + 6 + a] - positions[i + a]);
      const z = u[0] * v[1] - u[1] * v[0];
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], z];
      if (reference)
        assert(
          normal.reduce(
            (sum, value, axis) => sum + value * reference[axis],
            0,
          ) > 0,
          "Split reversed source winding",
        );
      else assert(z >= -1e-8, "Split reversed source winding");
      result += Math.hypot(...normal) * 0.5;
    }
    return result;
  };
  let sourceId = "scan",
    cutterId = "cutter";
  const results = [];
  const inputDirectory =
    radiusDirectory ?? process.env.SCANFORGE_SPLIT_INPUT_DIR;
  const fileInputs = {
    ...Object.fromEntries(
      ["below", "at", "above"].map((label) => [
        `point-radius-${label}`,
        ["source-triangle.stl", `cutter-${label}.stl`],
      ]),
    ),
    "finite-interior-cut": ["source.stl", "cutter.stl"],
    "finite-planar-mesh": ["disjoint-source.stl", "finite-plane-cutter.stl"],
    "closed-convex": ["square-source.stl", "convex-cutter.stl"],
    "closed-concave": ["square-source.stl", "concave-cutter.stl"],
  };
  const inputManifest =
    inputDirectory &&
    JSON.parse(await readFile(`${inputDirectory}/manifest.json`, "utf8"));
  const expectedFileHashes = {
    "source-triangle.stl":
      "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
    "cutter-below.stl":
      "f1934caa75204704f3b1a37ad37d251689be2341b7899227c9510a9873f49ccf",
    "cutter-at.stl":
      "90694b7b19cde7b02bc71ea500c0213da4004142162855e66502350682be0323",
    "cutter-above.stl":
      "df8c162f55c96600c9f223c131d98b7ce7e3a43eb85136b8790c08a9487ea29f",
    "source.stl":
      "126431c2e8a871619b5bb055df2833fdb762f7a7dabd3f54fe8346446473a75d",
    "cutter.stl":
      "64fee32d99371d7f81a6c172a2309a1c5e6639ec5c9ee5840fa72ec006e572e6",
    "disjoint-source.stl":
      "86208348d2200cf78ad30ccd78b194a97aa10ba28b997a86ddcddffb125496f2",
    "finite-plane-cutter.stl":
      "6bc09b0c998bdd68883144fcd5157e0d2ccf0794603506f22361b7a09bd9566d",
    "square-source.stl":
      "2202c3e08785be8c7694ea4e72aefb7cd3f29460e17435410b1aa7d844d66d19",
    "convex-cutter.stl":
      "30994066b6e33d4d479c894405ffcec5e2350d4e42c89ade4e948a2443823612",
    "concave-cutter.stl":
      "0aa225313e6897518d77eddfee449f3cb61df8afabdb73eefb6da1373e42015d",
  };
  const load = async (c) => {
    if (inputDirectory) {
      await mutate("project_new", { discard: true });
      const importStl = async (filename) => {
        const bytes = await readFile(`${inputDirectory}/${filename}`);
        const entry = Object.values(
          inputManifest.files ?? [
            inputManifest.source,
            ...inputManifest.cutters,
          ],
        ).find((item) => item.file === filename);
        assert(entry, `Missing manifest entry for ${filename}`);
        assert.equal(entry.sha256, expectedFileHashes[filename]);
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          expectedFileHashes[filename],
        );
        const artifact = (
          await call("artifact_put", {
            name: filename,
            offset: 0,
            base64: bytes.toString("base64"),
          })
        ).result;
        const imported = await job(
          await mutate("project_import", {
            artifactId: artifact.artifactId,
            unit: "mm",
            placeAtOrigin: false,
          }),
        );
        await call("artifact_delete", { artifactId: artifact.artifactId });
        return imported.result.entityId;
      };
      [sourceId, cutterId] = [
        await importStl(fileInputs[c.name][0]),
        await importStl(fileInputs[c.name][1]),
      ];
      await mutate("object_update", {
        entityId: sourceId,
        patch: { name: "Split source" },
      });
      await mutate("object_update", {
        entityId: cutterId,
        patch: { name: `Cutter ${c.name}` },
      });
    } else {
      const project = {
        format: "maliev-scanforge",
        version: 1,
        name: `Split ${c.name}`,
        units: "mm",
        entities: [
          {
            id: sourceId,
            name: "Split source",
            source: "manufactured-split-control.stl",
            kind: "mesh",
            positions: c.source,
            color: "#d24d57",
            opacity: 0.4,
            visible: true,
          },
          {
            id: cutterId,
            name: `Cutter ${c.name}`,
            kind: c.kind,
            positions: c.target,
            color: "#728a99",
            opacity: 0.35,
            visible: true,
            ...(c.fit ? { fit: c.fit } : {}),
            ...(c.kind === "plane"
              ? {
                  planeFrame: {
                    center: c.planeCenter ?? [0, 0, 0],
                    normal: c.planeNormal ?? [1, 0, 0],
                    tangent: c.planeTangent ?? [0, 1, 0],
                  },
                }
              : {}),
          },
        ],
      };
      const upload = (
        await call("artifact_put", {
          name: "split-control.json",
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
    }
    await mutate("object_select", { entityId: sourceId });
    await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
    await mutate("viewport_control", {
      action: "camera",
      position: [0.5, 2, 20],
      target: [0.5, 2, 0],
      up: [0, 1, 0],
      zoom: 1,
    });
    rawEqual(await geometry(sourceId), c.source, "Import changed source");
    rawEqual(await geometry(cutterId), c.target, "Import changed cutter");
    return (await call("project_get")).result.undo;
  };
  const panel = page.getByRole("region", { name: "Split mesh", exact: true });
  const open = async (c) => {
    await mutate("command_run", { name: "ribbon:splitMesh" });
    await panel.waitFor();
    await panel.locator(".app-select > button").click();
    await page
      .getByRole("option", { name: `Cutter ${c.name}`, exact: true })
      .click();
  };
  const waitParts = async (count) => {
    for (let i = 0; i < 120; i++) {
      const state = (await call("project_get")).result;
      if (state.undo > 0 && state.objects.length > 2) {
        await idle();
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error(
      `GUI split did not publish expected parts: ${(await page.locator("body").innerText()).slice(-2000)}`,
    );
  };
  const stableObjects = (objects) =>
    objects.map(({ meshPreparation, ...object }) => object);
  const parts = async (state) => {
    const objects = state.objects.filter(
        (o) => o.id !== sourceId && o.id !== cutterId,
      ),
      out = [];
    for (const object of objects)
      out.push({ metadata: object, positions: await geometry(object.id) });
    return out;
  };
  const verifyState = async (state, c) => {
    assert.equal(
      state.objects.find((o) => o.id === sourceId).visible,
      false,
      "Split source remains visible",
    );
    assert.equal(
      state.objects.find((o) => o.id === cutterId).visible,
      true,
      "Split changed cutter visibility",
    );
    rawEqual(
      await geometry(sourceId),
      c.source,
      "Split changed retained source",
    );
    rawEqual(
      await geometry(cutterId),
      c.target,
      "Split changed cutter geometry",
    );
    const output = await parts(state);
    assert.equal(
      output.length,
      c.parts,
      "Split did not honor the requested cutter class",
    );
    if (c.unchangedPart)
      rawEqual(
        output[0].positions,
        c.source,
        "Coplanar split changed the source facet",
      );
    assert.equal(
      (await call("application_inspect")).result.selectedId,
      output[0].metadata.id,
      "Split did not select its first result",
    );
    for (const p of output) {
      assert.equal(p.metadata.visible, true);
      assert.equal(p.metadata.opacity, 1);
      assert.equal(
        p.metadata.source,
        inputDirectory
          ? fileInputs[c.name][0]
          : "manufactured-split-control.stl",
      );
      assert.equal(p.metadata.kind, "mesh");
      assert(p.positions.length > 0);
      if (c.sourceYBounds)
        for (let i = 1; i < p.positions.length; i += 3) {
          assert(p.positions[i] >= c.sourceYBounds[0] - 1e-6);
          assert(p.positions[i] <= c.sourceYBounds[1] + 1e-6);
        }
    }
    if (c.requiredPoint) {
      assert(
        output.some((part) => {
          for (let i = 0; i < part.positions.length; i += 3)
            if (
              c.requiredPoint.every(
                (value, axis) =>
                  Math.abs(part.positions[i + axis] - value) < 1e-6,
              )
            )
              return true;
          return false;
        }),
        "Split omitted the finite sloped-edge crossing",
      );
    }
    const reference = c.originalFaceWinding
      ? sourceNormal(c.source)
      : undefined;
    const areas = output.map((p) => area(p.positions, reference));
    if (c.finiteInterior && process.env.SCANFORGE_SPLIT_OBSERVE_CURRENT) {
      const intervals = output.map((part) => {
        const found = [];
        for (let i = 0; i < part.positions.length; i += 9)
          for (let j = 0; j < 3; j++) {
            const a = i + 3 * j,
              b = i + 3 * ((j + 1) % 3);
            if (
              Math.abs(part.positions[a] - 0.5) < 1e-6 &&
              Math.abs(part.positions[b] - 0.5) < 1e-6
            )
              found.push(
                [part.positions[a + 1], part.positions[b + 1]].sort(
                  (x, y) => x - y,
                ),
              );
          }
        return found;
      });
      assert(
        intervals[0].some(([a, b]) =>
          intervals[1].some(([c, d]) => {
            const lo = Math.max(a, c),
              hi = Math.min(b, d);
            return hi - lo > 1e-6 && (lo < 0.1 - 1e-5 || hi > 0.2 + 1e-5);
          }),
        ),
        "Expected current output to expose the false boundary",
      );
    }
    if (c.sharedEdge) {
      const edges = new Map();
      for (const part of output)
        for (let i = 0; i < part.positions.length; i += 9)
          for (let j = 0; j < 3; j++) {
            const a = i + j * 3,
              b = i + ((j + 1) % 3) * 3;
            if (part.positions[a + 1] === 0 && part.positions[b + 1] === 0) {
              const key = [part.positions[a], part.positions[b]]
                .sort((x, y) => x - y)
                .join(",");
              edges.set(key, (edges.get(key) ?? 0) + 1);
            }
          }
      assert(edges.size > 0);
      assert(
        [...edges.values()].every((count) => count === 2),
        `Shared edge has a T-junction: ${JSON.stringify([...edges])}`,
      );
    }
    if (c.coplanarSharedEdge) {
      const edges = new Map();
      for (const part of output)
        for (let i = 0; i < part.positions.length; i += 9)
          for (let j = 0; j < 3; j++) {
            const a = i + 3 * j,
              b = i + 3 * ((j + 1) % 3);
            if (
              part.positions[a] === 0 &&
              part.positions[b] === 0 &&
              part.positions[a + 2] === 0 &&
              part.positions[b + 2] === 0
            ) {
              const key = [part.positions[a + 1], part.positions[b + 1]]
                .sort((x, y) => x - y)
                .join(",");
              edges.set(key, (edges.get(key) ?? 0) + 1);
            }
          }
      assert.equal(edges.size, 3);
      assert(
        [...edges.values()].every((count) => count === 2),
        `Coplanar shared edge has a T-junction: ${JSON.stringify([...edges])}`,
      );
      const endpoints = [...edges.keys()].flatMap((key) =>
        key.split(",").map(Number),
      );
      assert(endpoints.some((value) => Math.abs(value - 0.3) < 1e-6));
      assert(endpoints.some((value) => Math.abs(value - 0.7) < 1e-6));
    }
    assert(
      Math.abs(areas.reduce((a, b) => a + b, 0) - area(c.source, reference)) <=
        1e-5,
      "Split does not conserve independent triangle area",
    );
    if (c.areas)
      assert.deepEqual(
        areas.map((v) => Math.round(v * 1e5) / 1e5),
        c.areas,
      );
    return output;
  };
  const readParts = async (c) => {
    const state = (await call("project_get")).result;
    return verifyState(state, c);
  };
  for (const c of cases) {
    if (radiusDirectory && !c.name.startsWith("point-radius-")) continue;
    if (
      process.env.SCANFORGE_SPLIT_CASE &&
      c.name !== process.env.SCANFORGE_SPLIT_CASE
    )
      continue;
    if (inputDirectory && !fileInputs[c.name]) continue;
    const baseline = await load(c);
    if (radiusDirectory)
      await mutate("viewport_control", {
        action: "camera",
        position: [0.5, 0.5, 3],
        target: [0.5, 0.5, 0],
        up: [0, 1, 0],
        zoom: 1,
      });
    await open(c);
    await panel
      .getByRole("button", { name: "Split mesh", exact: true })
      .click();
    if (radiusDirectory) {
      let state;
      for (let i = 0; i < 120; i++) {
        state = (await call("project_get")).result;
        if (state.undo > baseline) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(state.undo, baseline + 1, "GUI Split did not commit");
      assert.equal(state.objects.length, 2);
      assert.equal(
        state.objects.find((object) => object.id === sourceId).visible,
        true,
      );
      const geometryDigest = async (entityId) =>
        (
          await job(await call("object_geometry_digest", { entityId }))
        ).result.buffers
          .filter(({ path }) =>
            [
              "positions",
              "indexedMesh.vertices",
              "indexedMesh.triangles",
            ].includes(path),
          )
          .map(({ path, encoding, elements, sha256 }) => ({
            path,
            encoding,
            elements,
            sha256,
          }));
      const guiDigest = await geometryDigest(sourceId);
      const guiPositions = await geometry(sourceId);
      const normalState = async () => {
        const data = await artifactJson(
          (
            await call("object_get", {
              entityId: sourceId,
              includeGeometry: true,
            })
          ).result.geometry,
        );
        const mesh = data.indexedMesh;
        const result = {};
        for (const [key, count] of [
          ["geometryNormals", mesh.vertices.length],
          ["facetNormals", mesh.triangles.length],
        ]) {
          const values = mesh[key];
          if (values === undefined) {
            result[key] = null;
            continue;
          }
          assert.equal(values.length, count);
          for (let i = 0; i < values.length; i += 3) {
            assert(
              Math.abs(values[i]) < 1e-6 &&
                Math.abs(values[i + 1]) < 1e-6 &&
                Math.abs(values[i + 2] - 1) < 1e-6,
              `${key} differs from the plane normal`,
            );
          }
          result[key] = digest(values);
        }
        return result;
      };
      const initialNormals = await normalState();
      const render = async (label) => {
        if (!process.env.SCANFORGE_SPLIT_COMPARE_RENDER) return undefined;
        await idle();
        await page.waitForTimeout(250);
        return page
          .locator("canvas")
          .first()
          .screenshot({
            path: fileURLToPath(new URL(`${c.name}-${label}.png`, out)),
          });
      };
      const initialImage = await render("initial");
      assert(Math.abs(area(guiPositions) - area(c.source)) <= 1e-7);
      rawEqual(await geometry(cutterId), c.target, "GUI changed cutter");
      await mutate("history_undo", {});
      rawEqual(await geometry(sourceId), c.source, "GUI Undo changed source");
      await mutate("history_redo", {});
      assert.deepEqual(
        await geometryDigest(sourceId),
        guiDigest,
        "GUI Redo changed output",
      );
      const guiRedoNormals = await normalState();
      assert(guiRedoNormals.geometryNormals && guiRedoNormals.facetNormals);
      const redoImage = await render("redo");
      if (initialImage)
        assert(
          initialImage.equals(redoImage),
          "Rendered canvas differs after GUI Redo",
        );
      await load(c);
      const done = await job(
        await mutate("mesh_process", {
          entityId: sourceId,
          targetId: cutterId,
          operation: { kind: "scanEdit", action: "split" },
        }),
      );
      assert.equal(done.result.diagnostics.changed, true);
      assert.deepEqual(
        await geometryDigest(sourceId),
        guiDigest,
        "GUI/MCP output differs",
      );
      rawEqual(await geometry(cutterId), c.target, "MCP changed cutter");
      await mutate("history_undo", {});
      rawEqual(await geometry(sourceId), c.source, "MCP Undo changed source");
      await mutate("history_redo", {});
      assert.deepEqual(
        await geometryDigest(sourceId),
        guiDigest,
        "MCP Redo changed output",
      );
      const mcpRedoNormals = await normalState();
      assert.deepEqual(
        mcpRedoNormals,
        guiRedoNormals,
        "GUI/MCP computed normals differ",
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
      assert.deepEqual(
        await geometryDigest(sourceId),
        guiDigest,
        "Reopen changed output",
      );
      assert.deepEqual(
        await normalState(),
        guiRedoNormals,
        "Reopen changed computed normals",
      );
      rawEqual(await geometry(cutterId), c.target, "Reopen changed cutter");
      await load(c);
      const beforeCancel = (await call("project_get")).result;
      await page.evaluate(() => {
        window.__holdSplitResult = true;
        window.__pendingSplitResult = false;
      });
      const cancelled = await mutate("mesh_process", {
        entityId: sourceId,
        targetId: cutterId,
        operation: { kind: "scanEdit", action: "split" },
      });
      await page.waitForFunction(() => window.__pendingSplitResult);
      await call("job_cancel", { jobId: cancelled.result.jobId });
      await job(cancelled, "cancelled");
      await page.evaluate(() => {
        window.__holdSplitResult = false;
      });
      assert.deepEqual(
        stableObjects((await call("project_get")).result.objects),
        stableObjects(beforeCancel.objects),
      );
      assert.equal((await call("project_get")).result.undo, beforeCancel.undo);
      rawEqual(
        await geometry(sourceId),
        c.source,
        "MCP cancellation changed source",
      );
      rawEqual(
        await geometry(cutterId),
        c.target,
        "MCP cancellation changed cutter",
      );
      await open(c);
      await page.evaluate(() => {
        window.__holdSplitResult = true;
        window.__pendingSplitResult = false;
      });
      await panel
        .getByRole("button", { name: "Split mesh", exact: true })
        .click();
      await page.waitForFunction(() => window.__pendingSplitResult);
      await panel
        .getByRole("button", { name: "Close Split mesh", exact: true })
        .click();
      await page.evaluate(() => {
        window.__holdSplitResult = false;
      });
      assert.deepEqual(
        stableObjects((await call("project_get")).result.objects),
        stableObjects(beforeCancel.objects),
      );
      assert.equal((await call("project_get")).result.undo, beforeCancel.undo);
      rawEqual(
        await geometry(sourceId),
        c.source,
        "GUI cancellation changed source",
      );
      rawEqual(
        await geometry(cutterId),
        c.target,
        "GUI cancellation changed cutter",
      );
      results.push({
        name: c.name,
        sourceFileSha256: expectedFileHashes[fileInputs[c.name][0]],
        cutterFileSha256: expectedFileHashes[fileInputs[c.name][1]],
        outputDigest: guiDigest,
        outputArea: area(guiPositions),
        diagnostics: done.result.diagnostics,
        guiMcpGeometry: true,
        undoRedo: true,
        binaryReopen: true,
        mcpHeldResultCancellation: true,
        guiCloseCancellation: true,
        ...(initialImage ? { guiRedoCanvasPngIdentical: true } : {}),
        normalCaches: {
          initial: initialNormals,
          guiRedo: guiRedoNormals,
          mcpRedo: mcpRedoNormals,
          reopened: guiRedoNormals,
        },
      });
      continue;
    }
    const guiState = await waitParts(c.parts),
      gui = await verifyState(guiState, c);
    assert.equal(guiState.undo, baseline + 1);
    await page.screenshot({
      path: fileURLToPath(new URL(`${c.name}-gui.png`, out)),
    });
    // Reimport for a fresh equivalent MCP run; GUI Undo/Redo is checked below.
    await load(c);
    const receipt = await mutate("mesh_process", {
        entityId: sourceId,
        targetId: cutterId,
        operation: { kind: "scanEdit", action: "split" },
      }),
      done = await job(receipt);
    assert.equal(
      done.result.entityIds.length,
      c.parts,
      "GUI/MCP split part count differs",
    );
    const mcp = await readParts(c);
    assert.deepEqual(
      mcp.map((p) => digest(p.positions)),
      gui.map((p) => digest(p.positions)),
      "GUI/MCP split facets differ",
    );
    assert.deepEqual(
      mcp.map((p) => ({
        name: p.metadata.name,
        color: p.metadata.color,
        opacity: p.metadata.opacity,
      })),
      gui.map((p) => ({
        name: p.metadata.name,
        color: p.metadata.color,
        opacity: p.metadata.opacity,
      })),
      "GUI/MCP part metadata differs",
    );
    assert.equal(done.result.diagnostics.capped, false);
    assert.equal(done.result.diagnostics.cutter, c.method);
    await mutate("history_undo", {});
    let state = (await call("project_get")).result;
    assert.equal(state.objects.length, 2);
    assert.equal(
      state.objects.find((o) => o.id === sourceId).visible,
      true,
      "MCP Undo left the source hidden",
    );
    await mutate("history_redo", {});
    state = (await call("project_get")).result;
    assert.equal(state.objects.find((o) => o.id === sourceId).visible, false);
    assert.deepEqual(
      (await parts(state)).map((p) => digest(p.positions)),
      mcp.map((p) => digest(p.positions)),
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
    state = (await call("project_get")).result;
    assert.equal(state.objects.find((o) => o.id === sourceId).visible, false);
    assert.equal(state.objects.find((o) => o.id === cutterId).visible, true);
    assert.deepEqual(
      (await parts(state)).map((p) => digest(p.positions)),
      mcp.map((p) => digest(p.positions)),
    );
    rawEqual(await geometry(sourceId), c.source, "Reopen changed source");
    rawEqual(await geometry(cutterId), c.target, "Reopen changed cutter");
    await load(c);
    await open(c);
    await panel
      .getByRole("button", { name: "Split mesh", exact: true })
      .click();
    await waitParts(c.parts);
    await mutate("history_undo", {});
    state = (await call("project_get")).result;
    assert.equal(state.objects.length, 2);
    assert.equal(
      state.objects.find((o) => o.id === sourceId).visible,
      true,
      "GUI Undo left source hidden",
    );
    await mutate("history_redo", {});
    state = (await call("project_get")).result;
    assert.equal(state.objects.find((o) => o.id === sourceId).visible, false);
    assert.deepEqual(
      (await parts(state)).map((p) => digest(p.positions)),
      gui.map((p) => digest(p.positions)),
    );
    await load(c);
    const beforeCancel = (await call("project_get")).result;
    await page.evaluate(() => {
      window.__holdSplitResult = true;
      window.__pendingSplitResult = false;
    });
    const cancelled = await mutate("mesh_process", {
      entityId: sourceId,
      targetId: cutterId,
      operation: { kind: "scanEdit", action: "split" },
    });
    await page.waitForFunction(() => window.__pendingSplitResult);
    await call("job_cancel", { jobId: cancelled.result.jobId });
    await job(cancelled, "cancelled");
    await page.evaluate(() => {
      window.__holdSplitResult = false;
    });
    state = (await call("project_get")).result;
    assert.deepEqual(
      stableObjects(state.objects),
      stableObjects(beforeCancel.objects),
    );
    assert.equal(state.undo, beforeCancel.undo);
    await open(c);
    await page.evaluate(() => {
      window.__holdSplitResult = true;
      window.__pendingSplitResult = false;
    });
    await panel
      .getByRole("button", { name: "Split mesh", exact: true })
      .click();
    await page.waitForFunction(() => window.__pendingSplitResult);
    await panel
      .getByRole("button", { name: "Close Split mesh", exact: true })
      .click();
    await page.evaluate(() => {
      window.__holdSplitResult = false;
    });
    state = (await call("project_get")).result;
    assert.deepEqual(
      stableObjects(state.objects),
      stableObjects(beforeCancel.objects),
    );
    assert.equal(state.undo, beforeCancel.undo);
    rawEqual(
      await geometry(sourceId),
      c.source,
      "Cancelled split changed source",
    );
    rawEqual(
      await geometry(cutterId),
      c.target,
      "Cancelled split changed cutter",
    );
    results.push({
      name: c.name,
      sourceMode: inputDirectory ? "pinned STL import" : "project fixture",
      ...(inputDirectory
        ? {
            sourceFileSha256: expectedFileHashes[fileInputs[c.name][0]],
            cutterFileSha256: expectedFileHashes[fileInputs[c.name][1]],
          }
        : {}),
      inputCoordinateSha256: digest(c.source),
      cutterCoordinateSha256: digest(c.target),
      parts: c.parts,
      ...(c.finiteInterior && process.env.SCANFORGE_SPLIT_OBSERVE_CURRENT
        ? { observedFalseBoundaryOutsideCutter: true, acceptancePassed: false }
        : {}),
      outputCoordinateSha256: mcp.map((p) => digest(p.positions)),
      areas: mcp.map((p) =>
        area(
          p.positions,
          c.originalFaceWinding ? sourceNormal(c.source) : undefined,
        ),
      ),
      sourceArea: area(
        c.source,
        c.originalFaceWinding ? sourceNormal(c.source) : undefined,
      ),
      method: done.result.diagnostics.cutter,
      guiMcpGeometryAndMetadata: true,
      sourceAndCutterRetained: true,
      sourceVisibilityAndSelection: true,
      guiAndMcpUndoRedo: true,
      binaryReopen: true,
      mcpHeldResultCancellation: true,
      guiCloseCancellation: true,
    });
  }
  if (!inputDirectory) {
    const precision = {
      name: "float32-precision",
      source: [100000000, 2, 0, 100000008, 0, 0, 100000008, 8, 0],
      target: [100000000, 0, -10, 100000008, 80, -10, 100000000, 0, 10],
      kind: "plane",
      planeCenter: [100000000, 0, 0],
      planeNormal: [10 / Math.sqrt(101), -1 / Math.sqrt(101), 0],
      planeTangent: [0, 0, 1],
      fit: {
        ...planeFit,
        center: [100000000, 0, 0],
        axis: [10 / Math.sqrt(101), -1 / Math.sqrt(101), 0],
      },
    };
    await load(precision);
    const before = await call("project_get");
    await open(precision);
    await panel
      .getByRole("button", { name: "Split mesh", exact: true })
      .click();
    await page
      .getByText(/Float32 precision/)
      .first()
      .waitFor();
    await idle();
    const afterGui = await call("project_get");
    assert.equal(afterGui.revision, before.revision);
    assert.equal(afterGui.result.undo, before.result.undo);
    assert.deepEqual(
      stableObjects(afterGui.result.objects),
      stableObjects(before.result.objects),
    );
    rawEqual(
      await geometry(sourceId),
      precision.source,
      "GUI failure changed source",
    );
    rawEqual(
      await geometry(cutterId),
      precision.target,
      "GUI failure changed cutter",
    );
    const failedJob = await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        targetId: cutterId,
        operation: { kind: "scanEdit", action: "split" },
      }),
      "failed",
    );
    assert.match(JSON.stringify(failedJob.error), /Float32 precision/);
    const afterMcp = await call("project_get");
    assert.equal(afterMcp.revision, before.revision);
    assert.equal(afterMcp.result.undo, before.result.undo);
    assert.deepEqual(
      stableObjects(afterMcp.result.objects),
      stableObjects(before.result.objects),
    );
    rawEqual(
      await geometry(sourceId),
      precision.source,
      "MCP failure changed source",
    );
    rawEqual(
      await geometry(cutterId),
      precision.target,
      "MCP failure changed cutter",
    );
    await load(cases.find((c) => c.name === "infinite-plane"));
    await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        targetId: cutterId,
        operation: { kind: "scanEdit", action: "split" },
      }),
    );
    results.push({
      name: precision.name,
      guiAndMcpFailure: true,
      unchangedGeometryAndHistory: true,
      retry: true,
    });
  }
  assert.deepEqual(errors, []);
  ledger.result = { cases: results, pageErrors: errors };
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
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}
