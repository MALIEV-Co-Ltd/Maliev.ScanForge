import assert from "node:assert/strict";
import { chromium } from "playwright";
import { freemem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

if (freemem() < 3072 * 1048576) throw Error("Requires 3072 MiB free");
const out = new URL(
  `../.resources/project-encoding-disk-${randomUUID()}/`,
  import.meta.url,
);
await mkdir(out, { recursive: true });
const ledger = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 180000).toISOString(),
};
let context;
const lease = setTimeout(() => void context?.close(), 180000);
try {
  context = await chromium.launchPersistentContext(
    fileURLToPath(new URL("profile/", out)),
    {
      channel: "chrome",
      headless: true,
      args: ["--js-flags=--max-old-space-size=768"],
    },
  );
  const page = context.pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/project-encoding-disk-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Encoding checkpoints</title>",
    }),
  );
  await page.goto("http://127.0.0.1:5173/project-encoding-disk-regression");
  const result = await page.evaluate(async () => {
    const { encodeProjectFile, encodeProjectFileLocally, decodeProjectFile } =
      await import("/tests/helpers/project-worker-browser.ts");
    const checkpointSizes = [];
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "blobs" && value.file instanceof Blob)
        checkpointSizes.push(value.file.size);
      return originalPut.call(this, value, ...args);
    };
    try {
      let seed = 123456789;
      const entities = Array.from({ length: 4 }, (_, i) => {
        const bits = new Uint32Array(8388612);
        for (let n = 0; n < bits.length; n++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          bits[n] = 0x3f000000 | (seed & 0x7fffff);
        }
        return {
          id: String(i),
          name: String(i),
          kind: "mesh",
          positions: new Float32Array(bits.buffer),
          color: "#ffffff",
          visible: true,
          opacity: 1,
        };
      });
      const session = {
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "Checkpoint parity",
          entities,
        },
        history: [{ label: "Import", entities }],
        future: [],
      };
      const digest = async (file) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
          ),
          (n) => n.toString(16).padStart(2, "0"),
        ).join("");
      const local = await encodeProjectFileLocally(session);
      const localSha256 = await digest(local);
      const checkpoints = checkpointSizes.slice();
      if (
        !checkpoints.some((size) => size >= 64 * 1048576 && size < local.size)
      )
        throw Error("No incremental checkpoint");
      const worker = await encodeProjectFile(session);
      if (worker.size !== local.size || (await digest(worker)) !== localSha256)
        throw Error("Worker bytes differ");
      const restored = await decodeProjectFile(worker);
      for (let i = 0; i < entities.length; i++) {
        const expected = entities[i].positions,
          actual = restored.project.entities[i].positions;
        if (
          expected.length !== actual.length ||
          expected.some((n, j) => !Object.is(n, actual[j]))
        )
          throw Error("Geometry differs");
        if (restored.history[0].entities[i].positions !== actual)
          throw Error("History backing duplicated");
      }
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("scanforge-transient-blobs", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const remainingRecords = await new Promise((resolve, reject) => {
        const tx = db.transaction("blobs"),
          request = tx.objectStore("blobs").count();
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      if (remainingRecords) throw Error("Checkpoint record leaked");
      return {
        bytes: local.size,
        sourceBytes: entities.reduce((n, e) => n + e.positions.byteLength, 0),
        sha256: localSha256,
        checkpoints,
        remainingRecords,
        byteExact: true,
        historyPreserved: true,
      };
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
  });
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ ...result, outputDirectory: fileURLToPath(out) }),
  );
} finally {
  clearTimeout(lease);
  await context?.close();
  await writeFile(
    new URL("ledger.json", out),
    JSON.stringify({ ...ledger, closedAt: new Date().toISOString() }, null, 2),
  );
}
