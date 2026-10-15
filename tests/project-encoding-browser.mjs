import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
if (freemem() < 3072 * 1048576)
  throw Error("Requires 3072 MiB free; do not lower admission");
const out = new URL("../.resources/project-encoding-browser/", import.meta.url);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "project-encoding-browser",
  pid: process.pid,
  executable: process.execPath,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  persistentData: false,
};
let server, browser;
const lease = setTimeout(() => void server?.close(), 120000);
try {
  server = await chromium.launchServer({
    channel: "chrome",
    args: ["--js-flags=--max-old-space-size=768"],
  });
  ledger.browserPid = server.process().pid;
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/");
  const result = await page.evaluate(async () => {
    const { encodeProjectFile, encodeProjectFileLocally, decodeProjectFile } =
      await import("/src/project-file.ts");
    const { placedCloud, cloudPoseBits, cloudPlacement } =
      await import("/src/point-cloud-placement.ts");
    const mesh = {
      id: "mesh",
      name: "Mesh",
      kind: "mesh",
      positions: new Float32Array([-0, 0, 0, 1, 0, 0, 0, 1, 0]),
      visible: true,
      opacity: 1,
      color: "#ffffff",
    };
    const base = {
      ...mesh,
      id: "cloud",
      kind: "pointcloud",
      positions: new Float32Array([-0, 2, 3, 4, 5, 6]),
    };
    const cloud = placedCloud(base, {
      sourcePositions: base.positions,
      matrixBits: cloudPoseBits([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]),
    });
    const session = {
      project: {
        format: "maliev-scanforge",
        version: 1,
        name: "Worker parity",
        units: "mm",
        entities: [mesh, cloud],
      },
      history: [{ label: "Import", entities: [mesh] }],
      future: [{ label: "Cloud", entities: [mesh, cloud] }],
    };
    const before = mesh.positions.slice();
    const local = new Uint8Array(
      await (await encodeProjectFileLocally(session)).arrayBuffer(),
    );
    const background = await encodeProjectFile(session),
      bytes = new Uint8Array(await background.arrayBuffer());
    if (local.length !== bytes.length || local.some((n, i) => n !== bytes[i]))
      throw Error("Worker changed lossless project bytes");
    if (
      mesh.positions.byteLength !== before.byteLength ||
      mesh.positions.some((n, i) => !Object.is(n, before[i]))
    )
      throw Error("Authored buffer moved or changed");
    const decoded = await decodeProjectFile(background);
    if (!cloudPlacement(decoded.project.entities[1]))
      throw Error("Native cloud pose lost");
    let rejected = false;
    try {
      await encodeProjectFile({
        ...session,
        project: {
          ...session.project,
          entities: [{ ...mesh, positions: new Float32Array([NaN, 0, 0]) }],
        },
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Invalid geometry accepted");
    const controller = new AbortController();
    const cancelled = encodeProjectFile(session, controller.signal).then(
      () => false,
      (e) => e.name === "AbortError",
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    if (!(await cancelled)) throw Error("Cancelled encoding was not rejected");
    await encodeProjectFile(session);
    return {
      byteExact: true,
      bytes: bytes.length,
      authoredBuffersIntact: true,
      cloudPoseRetained: true,
      invalidGeometryRejected: true,
      queueRecovered: true,
      cancellationReleased: true,
    };
  });
  await page.waitForTimeout(100);
  assert(
    !page.workers().some((w) => w.url().includes("project-encoding-worker")),
    "Encoding worker leaked",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify({ ...result, errors, workersReleased: true }, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(lease);
  await browser?.close();
  await server?.close();
  await writeFile(
    new URL("ledger.json", out),
    JSON.stringify({ ...ledger, closedAt: new Date().toISOString() }, null, 2),
  );
}
