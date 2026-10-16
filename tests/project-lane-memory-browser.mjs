import assert from "node:assert/strict";
import { chromium } from "playwright";
import { freemem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";

if (freemem() < 3072 * 1048576)
  throw Error("Requires 3072 MiB free; do not lower admission");
const out = new URL("../.resources/project-lane-memory/", import.meta.url);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "project-lane-memory",
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
    args: ["--js-flags=--max-old-space-size=512"],
  });
  ledger.browserPid = server.process().pid;
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.route("**/project-lane-memory-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Project lane memory regression</title>",
    }),
  );
  await page.goto("http://127.0.0.1:5173/project-lane-memory-regression");
  const cdp = await page.context().newCDPSession(page);
  for (const kind of ["encode", "decode"]) {
    await page.evaluate(async (kind) => {
      const nativeWorker = globalThis.Worker;
      const session = () => ({
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "Memory",
          entities: [],
        },
        history: [],
        future: [],
      });
      globalThis.Worker = class {
        postMessage() {
          queueMicrotask(() => {
            this.onmessage({
              data:
                kind === "encode"
                  ? { file: new Blob([new Uint8Array(1048576)]) }
                  : {
                      packet: {
                        kind: "scanforge-numeric-transport-v1",
                        graph: {
                          snapshot: { session: session(), localClouds: [] },
                          displays: [],
                        },
                        numbers: [],
                      },
                    },
            });
          });
        }
        terminate() {}
      };
      try {
        const result =
          kind === "encode"
            ? await (
                await import("/src/project-encoding-client.ts")
              ).encodeProjectInBackground(session())
            : await (
                await import("/src/project-decoding-client.ts")
              ).decodeProjectInBackground(new Blob());
        globalThis.projectLaneResult = new WeakRef(result);
      } finally {
        globalThis.Worker = nativeWorker;
      }
    }, kind);
    await cdp.send("HeapProfiler.collectGarbage");
    const retained = await page.evaluate(
      () => globalThis.projectLaneResult.deref() !== undefined,
    );
    assert.equal(
      retained,
      false,
      `${kind} queue retained its completed result`,
    );
  }
  console.log(
    "Completed encoder and decoder results are collectable with queues idle.",
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await server?.close();
    clearTimeout(lease);
    ledger.closedAt = new Date().toISOString();
    await writeFile(
      new URL("ledger.json", out),
      JSON.stringify(ledger, null, 2),
    );
  }
}
