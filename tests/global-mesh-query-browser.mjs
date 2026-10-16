import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
if (freemem() < 3072 * 1048576)
  throw Error("Mesh correspondence replay requires 3072 MiB free.");
const out = new URL(
  "../.resources/global-mesh-query-browser/",
  import.meta.url,
);
await mkdir(out, { recursive: true });
function identity(pid) {
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-Process -Id ${pid} | Select-Object Id,@{Name='startedUtc';Expression={$_.StartTime.ToUniversalTime().ToString('o')}},Path | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    ),
  );
}
const ledger = {
  owner: "global-mesh-query-browser",
  identity: identity(process.pid),
  expiresUtc: new Date(Date.now() + 120000).toISOString(),
  persistentData: false,
  ports: [],
};
let server, browser, lease;
try {
  server = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    timeout: 30000,
  });
  ledger.browser = identity(server.process().pid);
  await writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
  lease = setTimeout(() => void server.close().catch(() => {}), 110000);
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__meshWorkers = [];
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.record = {
          terminated: false,
          initializations: 0,
          preparedInitializations: 0,
          sharedPreparedBuffers: true,
          evaluatorOnlyInputs: 0,
          queryWorker: String(url).includes("scan-global-query-worker"),
        };
        window.__meshWorkers.push(this.record);
      }
      postMessage(value, ...rest) {
        if (value.initialize) {
          this.record.initializations++;
          for (const scan of value.initialize.scans)
            if (
              scan.geometry.points.length &&
              scan.geometry.rawTargetIds?.length === 0
            )
              this.record.evaluatorOnlyInputs++;
          if (value.initialize.preparedMeshes) {
            this.record.preparedInitializations++;
            for (const target of value.initialize.preparedMeshes.flatMap(
              (s) => s.targets,
            ))
              for (const array of [
                target.surface.normals,
                target.surface.bounds,
                target.neighbours,
                target.degenerate,
              ])
                this.record.sharedPreparedBuffers &&=
                  array.buffer instanceof SharedArrayBuffer;
          }
        }
        return super.postMessage(value, ...rest);
      }
      terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
  await page.route("http://127.0.0.1:5173/mesh-query-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      body: "<!doctype html><title>Mesh correspondence verification</title>",
    }),
  );
  await page.goto("http://127.0.0.1:5173/mesh-query-regression");
  const result = await page.evaluate(async () => {
    const { createGlobalQueryPool } =
      await import("/src/scan-global-query-pool.ts");
    const { meshCorrespondenceFixture } =
      await import("/tests/helpers/global-mesh-correspondence-fixture.ts");
    const fixture = await fetch(
      "/tests/fixtures/global-fine-mesh-correspondence-native.json",
    ).then((r) => r.json());
    const bits = (v) =>
      Array.from(new Uint8Array(Float64Array.from(v).buffer), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join("");
    let comparisons = 0,
      poseComparisons = 0,
      fallbackComparisons = 0;
    const verify = (r, c) => {
      const actual = r.pairs.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: bits([...p.source, ...p.target, p.distance]),
      }));
      const expected = c.results.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: p.numericBits,
      }));
      if (
        r.count !== c.count ||
        JSON.stringify(actual) !== JSON.stringify(expected)
      )
        throw Error("Native cached-pose mismatch: " + c.name);
    };
    const physical = new Set();
    for (const c of fixture.cases) {
      const { scans, job } = meshCorrespondenceFixture(c),
        source = scans[0].geometry;
      for (const scan of scans.slice(1))
        if (!scan.geometry.points.length && scan.geometry.targetMeshes?.length)
          Object.assign(scan.geometry, {
            points: source.points,
            normals: source.normals,
            labels: undefined,
            flags: undefined,
            rawTargetIds: new Uint32Array(),
          });
      const pool = await createGlobalQueryPool({ scans });
      try {
        physical.add(pool.physicalWorkers);
        for (let repeat = 0; repeat < 2; repeat++) {
          const r = await pool.execute(job),
            actual = r.pairs.map((p) => ({
              id: p.id,
              active: p.active,
              numericBits: bits([...p.source, ...p.target, p.distance]),
            })),
            expected = c.results.map((p) => ({
              id: p.id,
              active: p.active,
              numericBits: p.numericBits,
            }));
          if (
            r.count !== c.count ||
            JSON.stringify(actual) !== JSON.stringify(expected)
          )
            throw Error(
              "Native mesh worker mismatch: " + c.name + " " + c.mode,
            );
          comparisons++;
        }
        if (c.name === "shared-raw-False" && c.mode === "target-average") {
          for (const name of ["posed-mesh", "shared-raw-False"]) {
            const posed = fixture.cases.find(
              (p) => p.name === name && p.mode === c.mode,
            );
            verify(
              await pool.execute(meshCorrespondenceFixture(posed).job),
              posed,
            );
            poseComparisons++;
          }
        }
      } finally {
        pool.close();
      }
    }
    const fallbackWorkers = new Set();
    for (const mode of ["pooled-plane", "target-average"]) {
      const c = fixture.cases.find(
        (c) => c.name === "shared-raw-False" && c.mode === mode,
      );
      const { scans, job } = meshCorrespondenceFixture(c),
        source = scans[0].geometry;
      for (const scan of scans.slice(1))
        if (!scan.geometry.points.length && scan.geometry.targetMeshes?.length)
          Object.assign(scan.geometry, {
            points: source.points,
            normals: source.normals,
            labels: undefined,
            flags: undefined,
            rawTargetIds: new Uint32Array(),
          });
      const pool = await createGlobalQueryPool({ scans }, { parallel: false });
      try {
        fallbackWorkers.add(pool.physicalWorkers);
        verify(await pool.execute(job), c);
        fallbackComparisons++;
      } finally {
        pool.close();
      }
    }
    const { refineGlobalScanSet } =
      await import("/src/scan-global-registration.ts");
    const scans = [],
      entities = [];
    for (let index = 0; index < 2; index++) {
      const side = 12;
      const points = new Float32Array(side * side * 3),
        normals = new Float32Array(points.length),
        ids = [];
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const id = (y * side + x) * 3;
          points.set([x, y, index * 0.05], id);
          normals[id + 2] = 1;
          if (x < side - 1 && y < side - 1) {
            const a = y * side + x;
            ids.push(a, a + 1, a + side, a + side, a + 1, a + side + 1);
          }
        }
      const triangles = Uint32Array.from(ids),
        positions = new Float32Array(triangles.length * 3);
      for (let slot = 0; slot < triangles.length; slot++)
        positions.set(
          points.subarray(triangles[slot] * 3, triangles[slot] * 3 + 3),
          slot * 3,
        );
      const id = "grid-" + index;
      entities.push({
        id,
        name: id,
        kind: "mesh",
        positions,
        visible: true,
        color: "#aaa",
        opacity: 1,
      });
      scans.push({
        id,
        geometry: {
          points,
          normals,
          targetMeshes: [{ vertices: points, triangles }],
        },
      });
    }
    const initial = entities.map((e) => e.positions.slice());
    const registered = await refineGlobalScanSet({ scans }, entities, {
      clock: () => 17,
      mode: "target-average",
    });
    const gap = Math.abs(
      registered.entities[0].positions[2] - registered.entities[1].positions[2],
    );
    if (
      !(gap < 1e-5) ||
      registered.diagnostics.queryWorkers !== 2 ||
      !registered.diagnostics.queries
    )
      throw Error(
        "Evaluator-only full registration did not align the offset mesh planes.",
      );
    if (
      entities.some((e, i) =>
        e.positions.some((v, j) => v !== initial[i][j]),
      ) ||
      scans.some((s) => s.geometry.rawTargetIds !== undefined)
    )
      throw Error("Registration mutated authored source records.");
    return {
      registration: {
        gap,
        queries: registered.diagnostics.queries,
        queryWorkers: registered.diagnostics.queryWorkers,
      },
      cases: fixture.cases.length,
      comparisons,
      poseComparisons,
      fallbackComparisons,
      fallbackWorkers: [...fallbackWorkers],
      physicalWorkers: [...physical],
      shared: crossOriginIsolated,
      workers: window.__meshWorkers,
    };
  });
  assert.equal(result.comparisons, 64);
  assert.equal(result.poseComparisons, 2);
  assert.equal(result.fallbackComparisons, 2);
  assert.deepEqual(result.fallbackWorkers, [1]);
  assert.deepEqual(result.physicalWorkers, [2]);
  assert.equal(result.shared, true);
  assert(
    result.workers.every(
      (w) => w.terminated && (!w.queryWorker || w.initializations === 1),
    ),
  );
  assert.equal(
    result.workers.reduce((n, w) => n + w.preparedInitializations, 0),
    33,
  );
  assert(result.workers.every((w) => w.sharedPreparedBuffers));
  assert(result.workers.some((w) => w.evaluatorOnlyInputs > 0));
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      cases: result.cases,
      comparisons: result.comparisons,
      poseComparisons: result.poseComparisons,
      fallbackComparisons: result.fallbackComparisons,
      fallbackWorkers: result.fallbackWorkers,
      physicalWorkers: result.physicalWorkers,
      shared: result.shared,
      workers: result.workers.length,
      registration: result.registration,
      errors,
    }),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await server?.close();
    } finally {
      clearTimeout(lease);
      await writeFile(
        new URL("cleanup.json", out),
        JSON.stringify(
          {
            browserClosed: !server || server.process().exitCode !== null,
            pid: server?.process().pid,
          },
          null,
          2,
        ),
      );
    }
  }
}
