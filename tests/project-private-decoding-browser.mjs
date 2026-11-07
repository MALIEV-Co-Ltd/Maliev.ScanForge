import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { chromium } from "playwright";

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "ignore", windowsHide: true },
);
let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null)
      throw Error("Isolated Vite exited before becoming ready");
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "Isolated Vite did not start");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/private-decoding-worker-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      body: "<title>Private decoding worker test</title>",
    }),
  );
  await page.goto(`${origin}/private-decoding-worker-test`);
  const result = await page.evaluate(async () => {
    if (!crossOriginIsolated) throw Error("Cross-origin isolation missing");
    const { encodeProjectFileLocally } =
      await import("/src/project-file-codec.ts");
    const { decodeProjectInBackground } =
      await import("/src/project-decoding-client.ts");
    const { scanRenderData } = await import("/src/scan-render-data.ts");
    const NativeWorker = window.Worker;
    const records = [];
    let abortOnPacket;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes("project-decoding-worker")) return;
        const record = { terminated: false, numericBytes: [] };
        records.push(record);
        const originalTerminate = this.terminate.bind(this);
        this.terminate = () => {
          record.terminated = true;
          originalTerminate();
        };
        this.addEventListener("message", (event) => {
          if (!event.data?.packet) return;
          record.numericBytes = event.data.packet.numbers.map(
            (entry) => entry.values.byteLength,
          );
          abortOnPacket?.abort();
        });
      }
    };
    try {
      const positions = Array.from({ length: 9 * 8192 }, (_, index) => {
        const i = index % 9;
        return i === 3 ? 1 + 2 ** -45 : i === 7 ? 1 : i === 0 ? -0 : 0;
      });
      const entity = {
        id: "mesh",
        name: "mesh",
        kind: "mesh",
        color: "#ffffff",
        visible: true,
        opacity: 1,
        positions,
      };
      const session = {
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "worker",
          entities: [entity],
        },
        history: [{ label: "before", entities: [entity] }],
        future: [],
      };
      const file = await encodeProjectFileLocally(session);
      const decoded = await decodeProjectInBackground(file);
      const restored = decoded.project.entities[0].positions;
      if (
        !Array.isArray(restored) ||
        restored.length !== positions.length ||
        restored.some((value, i) => !Object.is(value, positions[i]))
      )
        throw Error("Public positions changed");
      if (decoded.history[0].entities[0].positions !== restored)
        throw Error("History lost geometry alias");
      positions[3] = 17;
      if (restored[3] !== 1 + 2 ** -45)
        throw Error("Restored geometry aliases an earlier project owner");
      positions[3] = 1 + 2 ** -45;
      const display = scanRenderData(restored);
      if (!display?.normals || display.normals.length !== restored.length)
        throw Error("Prepared display cache missing");
      if (
        !records[0]?.terminated ||
        !records[0].numericBytes.includes(positions.length * 8)
      )
        throw Error("Worker transport or cleanup missing");
      const controller = new AbortController();
      abortOnPacket = controller;
      let cancelled = false;
      try {
        await decodeProjectInBackground(file, controller.signal);
      } catch (error) {
        cancelled = error?.name === "AbortError";
      }
      if (!cancelled || !records[1]?.terminated)
        throw Error("Worker cancellation did not clean up");
      if (scanRenderData(restored) !== display)
        throw Error("Cancelled restore changed live display cache");
      return {
        numericBytes: records[0].numericBytes,
        workerTerminated: records[0].terminated,
        cancelledWorkerTerminated: records[1].terminated,
        count: restored.length,
      };
    } finally {
      window.Worker = NativeWorker;
    }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (vite.exitCode === null) {
    vite.kill();
    await once(vite, "exit");
  }
}
