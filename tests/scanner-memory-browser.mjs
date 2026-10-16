import { chromium } from "playwright";
import { freemem } from "node:os";
import assert from "node:assert/strict";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const sourceRoot = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(sourceRoot, "Set SCANFORGE_ALIGNMENT_EXAMPLES");
const legacy = process.env.SCANFORGE_SCANNER_NORMAL_STORAGE === "legacy";
const ids = (process.env.SCANFORGE_SCANNER_IDS ?? "1,2").split(",").map(Number);
assert(
  ids.length > 0 && ids.every((id) => id === 1 || id === 2),
  "Use scan IDs 1 and/or 2",
);
import { mkdir, writeFile } from "node:fs/promises";
const requiredMiB = legacy && ids.includes(2) ? 6144 : 4096;
if (freemem() < requiredMiB * 1048576)
  throw Error(`Requires ${requiredMiB} MiB free`);
const out = new URL(
  "../.resources/scanner-memory-" +
    (legacy ? "legacy" : "typed") +
    "-" +
    ids.join("-") +
    "/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
let server, browser, timer, lease;
const report = {
  normalStorage: legacy ? "legacy-number-array" : "transferred-float32",
  originalSourceIdentityRechecked: false,
  samples: [],
  phases: [],
};
const ledger = {
  owner: "scanner-memory-browser",
  pid: process.pid,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  executable: process.execPath,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
};
let sampling = false;
try {
  server = await chromium.launchServer({
    channel: "chrome",
    args: [
      "--enable-precise-memory-info",
      "--js-flags=--max-old-space-size=1536",
    ],
  });
  ledger.browserPid = server.process().pid;
  const identity = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${ledger.browserPid}) | Select-Object @{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='executable';e={$_.Path}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(identity.status, 0, identity.stderr);
  ledger.browserIdentity = JSON.parse(identity.stdout);
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  lease = setTimeout(() => void server.close(), 180000);
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1183, height: 944 },
  });
  await page.route("**/load-memory-profile", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="canvas" style="width:1000px;height:700px"></div>',
    }),
  );
  for (const id of ids)
    await page.route(`**/profile-ply-${id}`, (r) =>
      r.fulfill({
        path: join(sourceRoot, `ply-${id}.ply`),
        contentType: "application/octet-stream",
      }),
    );
  await page.goto("http://127.0.0.1:5173/load-memory-profile");
  const cdp = await page.context().newCDPSession(page);
  page.on("console", (m) => {
    if (m.text().startsWith("PHASE ")) {
      report.phases.push({ phase: m.text().slice(6), time: Date.now() });
      console.log(m.text());
    }
  });
  timer = setInterval(async () => {
    if (freemem() < 1024 * 1048576) {
      report.memoryAbort = true;
      void server.close();
      return;
    }
    if (sampling) return;
    sampling = true;
    try {
      report.samples.push({
        time: Date.now(),
        ...(await cdp.send("Runtime.getHeapUsage")),
      });
    } catch {
    } finally {
      sampling = false;
    }
  }, 100);
  report.result = await page.evaluate(
    async ({ ids, legacy }) => {
      const { importScan, Viewport, encodeProjectFile, decodeProjectFile } =
        await import("/tests/helpers/scanner-memory-browser.ts");
      const phase = (s) => console.log("PHASE " + s);
      const viewport = new Viewport(
        document.getElementById("canvas"),
        () => {},
        () => {},
      );
      const entities = [];
      try {
        for (const id of ids) {
          phase("import-" + id);
          const file = new File(
            [await (await fetch("/profile-ply-" + id)).blob()],
            `ply-${id}.ply`,
          );
          let normals, indexedMesh;
          const positions = await importScan(file, {
            unit: "mm",
            placeAtOrigin: true,
            onMeshNormals: (v) => (normals = legacy ? Array.from(v) : v),
            onIndexedMesh: (v) => (indexedMesh = v),
          });
          entities.push({
            id: String(id),
            name: file.name,
            kind: "mesh",
            positions,
            normals,
            indexedMesh,
            color: "#aaaaaa",
            visible: true,
            opacity: 1,
          });
          phase("render-" + id);
          viewport.setEntities(entities, String(id));
          viewport.fitView();
          await viewport.present();
        }
        phase("encode");
        const session = {
          project: {
            format: "maliev-scanforge",
            version: 1,
            units: "mm",
            name: "Profile",
            entities,
          },
          history: [{ label: "First import", entities: [entities[0]] }],
          future: [],
        };
        const file = await encodeProjectFile(session);
        phase("decode");
        const restored = await decodeProjectFile(file);
        phase("restore-render");
        viewport.setEntities(restored.project.entities, "1");
        await viewport.present();
        phase("settle");
        await new Promise((r) => setTimeout(r, 2000));
        return {
          triangles: entities.map((e) => e.positions.length / 9),
          normals: entities.map((e) => e.normals?.length),
          projectBytes: file.size,
          restoredTriangles: restored.project.entities.map(
            (e) => e.positions.length / 9,
          ),
          normalValuesExact: restored.project.entities.every(
            (e, i) =>
              e.normals.length === entities[i].normals.length &&
              e.normals.every((v, j) => Object.is(v, entities[i].normals[j])),
          ),
        };
      } finally {
        viewport.dispose();
      }
    },
    { ids, legacy },
  );
  assert.equal(report.result.normalValuesExact, true);
  assert.deepEqual(report.result.restoredTriangles, report.result.triangles);
  report.passed = true;
} catch (e) {
  report.error = String(e);
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  clearTimeout(lease);
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
  ledger.closedAt = new Date().toISOString();
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  const summary = report.phases.map((p, i) => {
    const end = report.phases[i + 1]?.time ?? Date.now();
    const s = report.samples.filter((s) => s.time >= p.time && s.time < end);
    return {
      phase: p.phase,
      peakHeapMiB: Math.max(0, ...s.map((s) => s.usedSize / 1048576)),
      peakBackingMiB: Math.max(
        0,
        ...s.map((s) => (s.backingStorageSize ?? 0) / 1048576),
      ),
    };
  });
  report.summary = summary;
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      error: report.error,
      summary,
      result: report.result,
    }),
  );
}
