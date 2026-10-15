import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { freemem } from "node:os";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";
if (freemem() < 3072 * 1048576)
  throw Error(
    "Interactive owner bounds validation requires 3072 MiB available",
  );
const root = new URL("../", import.meta.url),
  out = new URL(".resources/interactive-bounds-browser/", root);
await mkdir(out, { recursive: true });
const origin = process.env.SCANFORGE_APP_ORIGIN ?? "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const sourceRoot = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(
  sourceRoot,
  "Set SCANFORGE_ALIGNMENT_EXAMPLES to the supplied scan folder",
);
const fixture = await readFile(
  new URL("tests/fixtures/interactive-owner-bounds-native.json", root),
  "utf8",
);
const native = JSON.parse(fixture);
const kernelFixture = await readFile(
  new URL("tests/fixtures/interactive-world-bounds-native.json", root),
  "utf8",
);
const mirrorFixture = await readFile(
  new URL(
    "tests/fixtures/interactive-mirror-point-selection-native.json",
    root,
  ),
  "utf8",
);
const ownerMirrorFixture = await readFile(
  new URL("tests/fixtures/interactive-owner-mirror-points-native.json", root),
  "utf8",
);
const ownerFaceFixture = await readFile(
  new URL("tests/fixtures/interactive-owner-face-state-native.json", root),
  "utf8",
);
const ledger = {
  owner: "interactive-bounds-browser",
  pid: process.pid,
  executable: process.execPath,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
};
let browserServer, browser, inputServer;
const save = () =>
  writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
await save();
const lease = setTimeout(() => void browserServer?.close(), 180000);
try {
  // Compile the gated worker independently: this check also runs before the GUI entry is enabled.
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: "esbuild",
      target: "es2022",
      lib: {
        entry: fileURLToPath(new URL("src/interactive-bounds-worker.ts", root)),
        formats: ["es"],
        fileName: "interactive-bounds-worker",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const chunks = (Array.isArray(bundle) ? bundle : [bundle])
    .flatMap((item) => item.output)
    .filter((item) => item.type === "chunk");
  assert.equal(chunks.length, 1);
  const workerSource = chunks[0].code;
  ledger.workerSha256 = createHash("sha256").update(workerSource).digest("hex");
  await save();
  browserServer = await chromium.launchServer({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--js-flags=--max-old-space-size=1792"],
  });
  ledger.browserPid = browserServer.process().pid;
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  await page.route("**/interactive-bounds-worker-bundle.mjs", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
      body: workerSource,
    }),
  );
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  page.on("requestfailed", (request) =>
    console.error(request.url(), request.failure()?.errorText),
  );
  page.on("crash", () => errors.push("Validation renderer crashed"));
  page.on("pageerror", (e) => errors.push(e.message));
  await writeFile(
    new URL("harness.html", out),
    "<!doctype html><title>Isolated Interactive bounds validation</title>",
  );
  for (const row of new Map(native.cases.map((c) => [c.name, c])).values()) {
    const bytes = await readFile(sourceRoot + "/" + row.name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
  }
  inputServer = createServer(async (req, res) => {
    const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (req.method !== "GET" || !native.cases.some((c) => c.name === name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const path = sourceRoot + "/" + name;
      const info = await stat(path);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size,
        "Access-Control-Allow-Origin": origin,
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      createReadStream(path)
        .on("error", (error) => res.destroy(error))
        .pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => inputServer.listen(0, "127.0.0.1", resolve));
  ledger.inputPort = inputServer.address().port;
  await save();
  await page.goto(
    origin + "/.resources/interactive-bounds-browser/harness.html",
  );
  const result = await page.evaluate(
    async ({
      fixture,
      kernelFixture,
      mirrorFixture,
      ownerMirrorFixture,
      ownerFaceFixture,
      workerUrl,
      inputOrigin,
    }) => {
      const native = JSON.parse(fixture),
        kernels = JSON.parse(kernelFixture),
        mirrorNative = JSON.parse(mirrorFixture),
        ownerMirror = JSON.parse(ownerMirrorFixture),
        ownerFace = JSON.parse(ownerFaceFixture);
      const { InteractiveBoundsPool } =
        await import("/src/interactive-bounds-pool.ts");
      const OriginalWorker = globalThis.Worker;
      let created = 0,
        live = 0,
        preparations = 0,
        maximumLive = 0,
        sourceDerivations = 0;
      Object.defineProperty(navigator, "hardwareConcurrency", {
        configurable: true,
        value: 8,
      });
      globalThis.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(
            String(url).includes("interactive-bounds-worker.ts")
              ? workerUrl
              : url,
            options,
          );
          created++;
          live++;
          maximumLive = Math.max(maximumLive, live);
          this.released = false;
        }
        postMessage(message, transfer) {
          if (message.action === "prepare") preparations++;
          if (message.action === "deriveMesh") sourceDerivations++;
          super.postMessage(message, transfer);
        }
        terminate() {
          if (!this.released) {
            live--;
            this.released = true;
          }
          return super.terminate();
        }
      };
      const hex = (values) =>
        Array.from(
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
      const assert = (condition, message) => {
        if (!condition) throw Error(message);
      };
      let pool, display, renderer;
      try {
        pool = new InteractiveBoundsPool(
          new Map(
            kernels.cases.map((c, i) => [
              String(i),
              {
                positions: Float32Array.from(c.points.flat()),
                flags: Uint32Array.from(c.flags),
              },
            ]),
          ),
          { threshold: 0 },
        );
        for (let i = 0; i < kernels.cases.length; i++) {
          const c = kernels.cases[i],
            r = await pool.measure(String(i), kernels.transforms[c.transform]);
          assert(
            hex(r.values) === c.boundsBits && r.valid === !!c.valid,
            "Native kernel mismatch " + i,
          );
          assert(
            r.execution.physicalWorkers === 2,
            "Expected two physical workers",
          );
        }
        pool.close();
        assert(live === 0, "Kernel worker leak");
        const mirrorSettings = (c) => ({
          direction: c.direction,
          stride: c.stride,
          onlySelected: c.onlySelected,
          backfaces: c.backfaces,
          baseColor: [0.8, 0.8, 0],
          selectedColor: [0.3, 0.4, 0.5],
          allowanceMilliseconds: c.allowanceMilliseconds,
          elapsedMilliseconds: c.elapsedMilliseconds,
        });
        const compactColors = (colors, indices) => {
          const out = new Float32Array(indices.length * 3);
          for (let i = 0; i < indices.length; i++)
            for (let a = 0; a < 3; a++)
              out[i * 3 + a] = colors[indices[i] * 3 + a];
          return out;
        };
        pool = new InteractiveBoundsPool(
          new Map(
            [0, 16, 32].map((n) => [
              String(n),
              {
                positions: new Float32Array(n * 3),
                normals: Float32Array.from(
                  mirrorNative.normals.slice(0, n).flat(),
                ),
                flags: Uint32Array.from(mirrorNative.flags.slice(0, n)),
              },
            ]),
          ),
          { threshold: 0 },
        );
        for (const c of mirrorNative.cases) {
          const r = await pool.mirror(String(c.count), mirrorSettings(c));
          assert(
            hex(r.indices) === hex(Uint32Array.from(c.indices)),
            "Native mirror indices mismatch",
          );
          assert(
            hex(compactColors(r.colors, r.indices)) ===
              hex(Float32Array.from(c.colors.flat())),
            "Native mirror color mismatch",
          );
          assert(
            r.complete === c.complete && r.execution.physicalWorkers === 2,
            "Native mirror completion/worker mismatch",
          );
        }
        pool.close();
        assert(live === 0, "Mirror kernel worker leak");
        const { parsePlyTopology } = await import("/src/ply-topology.ts");
        const { readAscPointCloud } = await import("/src/asc-import.ts");
        const sources = new Map(),
          plySources = new Map();
        for (const c of native.cases)
          if (!sources.has(c.pointsFile)) {
            const bytes = await (
              await fetch(inputOrigin + "/" + c.name)
            ).arrayBuffer();
            const topology = c.name.endsWith(".ply")
              ? parsePlyTopology(bytes)
              : undefined;
            const points = topology
              ? topology.vertices
              : (await readAscPointCloud(new Blob([bytes]))).positions;
            if (topology)
              plySources.set(c.name, {
                positions: topology.vertices,
                normals: topology.normals,
                triangles: topology.triangles,
              });
            assert(points.length === c.count * 3, "Source count mismatch");
            const digest = Array.from(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", points.buffer),
              ),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            assert(
              digest === c.pointsSha256,
              "Imported point-buffer digest mismatch " + c.name,
            );
            sources.set(c.pointsFile, { positions: points });
          }
        const digest = async (a) =>
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
              ),
            ),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("");
        for (const c of ownerMirror.cases) {
          const source = plySources.get(c.name);
          assert(source?.normals, "Owner mirror needs imported normals");
          const flags = new Uint32Array(c.count);
          for (let i = 0; i < c.count; i++)
            flags[i] =
              i < c.selectedPrefixCount
                ? 2
                : ownerMirror.flagsPattern[
                    (i - c.selectedPrefixCount) %
                      ownerMirror.flagsPattern.length
                  ];
          assert(
            (await digest(source.positions)) === c.positionsSha256 &&
              (await digest(source.normals)) === c.normalsSha256 &&
              (await digest(flags)) === c.flagsSha256,
            "Owner mirror input digest mismatch",
          );
          sources.set("mirror:" + c.name, { ...source, flags });
        }
        pool = new InteractiveBoundsPool(sources);
        const rows = [];
        const prepareStart = preparations;
        for (const c of native.cases) {
          const start = performance.now(),
            r = await pool.measure(
              c.pointsFile,
              native.transforms[c.transform],
            );
          assert(
            hex(r.values) === c.boundsBits && r.valid === !!c.valid,
            "Owner native mismatch " + c.name + " pose " + c.transform,
          );
          assert(r.execution.physicalWorkers === 2, "Owner multicore fallback");
          rows.push({
            name: c.name,
            pose: c.transform,
            points: c.count,
            milliseconds: performance.now() - start,
            execution: r.execution,
          });
        }
        const coldPreparations = preparations - prepareStart;
        const before = preparations;
        const start = performance.now();
        await pool.measure(native.cases[0].pointsFile, native.transforms[1]);
        const warmMilliseconds = performance.now() - start;
        assert(before === preparations, "Warm query retransferred source");
        const displayModule =
          await import("/src/interactive-mirror-display.ts");
        const displaySource = await (
          await fetch("/src/interactive-mirror-display.ts")
        ).text();
        const threePath = /import \* as THREE from "([^"]+)"/.exec(
          displaySource,
        );
        assert(threePath, "Unable to resolve the application's Three runtime");
        const THREE = await import(threePath[1]);
        display = new displayModule.InteractiveMirrorDisplay(sources, () => {});
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
        const displayPoses = ownerMirror.cases.map((c) => ({
          entityId: "mirror:" + c.name,
          matrix: identity,
        }));
        display.show(displayPoses, 1);
        const displayBounds = new THREE.Box3();
        const ownerMirrorRows = [];
        for (const c of ownerMirror.cases) {
          const key = "mirror:" + c.name;
          const measured = await pool.measure(key, identity);
          displayBounds.union(
            new THREE.Box3(
              new THREE.Vector3(...measured.values.slice(0, 3)),
              new THREE.Vector3(...measured.values.slice(3, 6)),
            ),
          );
          const before = preparations;
          const r = await pool.mirror(key, c.settings);
          assert(
            preparations === before,
            "Mirror retransferred cached bounds data",
          );
          assert(
            r.execution.physicalWorkers === 2,
            "Owner mirror did not share two workers",
          );
          assert(
            r.indices.length === c.drawn &&
              (await digest(r.indices)) === c.indicesSha256,
            "Owner native mirror index digest mismatch",
          );
          const colors = compactColors(r.colors, r.indices);
          assert(
            (await digest(colors)) === c.colorsSha256,
            "Owner native mirror color digest mismatch",
          );
          const positions = new Float32Array(r.indices.length * 3),
            source = sources.get(key);
          for (let i = 0; i < r.indices.length; i++)
            for (let a = 0; a < 3; a++)
              positions[i * 3 + a] = source.positions[r.indices[i] * 3 + a];
          assert(
            (await digest(positions)) === c.drawnPositionsSha256,
            "Owner native point-submission digest mismatch",
          );
          assert(
            source.positions.length === c.count * 3 &&
              source.normals.length === c.count * 3,
            "Owner source buffers detached",
          );
          display.publish(key, r);
          const object = display.group.children.find((o) => o.name === key);
          assert(
            object.geometry.getAttribute("position").array ===
              source.positions &&
              object.geometry.getAttribute("normal").array === source.normals,
            "GPU presenter copied or replaced source buffers",
          );
          assert(
            (await digest(
              object.geometry.index.array.subarray(
                0,
                object.geometry.drawRange.count,
              ),
            )) === c.indicesSha256,
            "GPU index digest differs from native submission",
          );
          assert(
            (await digest(
              compactColors(
                object.geometry.getAttribute("color").array,
                r.indices,
              ),
            )) === c.colorsSha256,
            "GPU color attribute differs from native color bytes",
          );
          ownerMirrorRows.push({
            name: c.name,
            points: c.count,
            drawn: r.indices.length,
            execution: r.execution,
            nativeDigestsMatched: true,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        const coldLongTasks = [];
        const coldObserver = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) coldLongTasks.push(e.duration);
        });
        coldObserver.observe({ type: "longtask" });
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(920, 720);
        renderer.setClearColor(0x000000);
        document.body.append(renderer.domElement);
        const scene = new THREE.Scene();
        scene.add(display.group);
        displayBounds.applyMatrix4(display.group.matrix);
        const center = displayBounds.getCenter(new THREE.Vector3());
        const radius = Math.max(
          1,
          displayBounds.getSize(new THREE.Vector3()).length() * 0.6,
        );
        const camera = new THREE.OrthographicCamera(
          (-radius * 920) / 720,
          (radius * 920) / 720,
          radius,
          -radius,
          0.1,
          radius * 100,
        );
        const gl = renderer.getContext();
        camera.position.copy(center).add(new THREE.Vector3(0, 0, radius * 3));
        camera.lookAt(center);
        camera.updateMatrixWorld(true);
        const previousTarget = new THREE.WebGLRenderTarget(8, 8);
        previousTarget.texture.colorSpace = renderer.outputColorSpace;
        previousTarget.viewport.set(1, 2, 5, 6);
        previousTarget.scissor.set(2, 1, 3, 4);
        previousTarget.scissorTest = true;
        renderer.setRenderTarget(previousTarget);
        const shaderStart = performance.now();
        assert(
          await display.prepare(renderer, camera),
          "GPU mirror shader preparation was cancelled",
        );
        assert(
          renderer.getRenderTarget() === previousTarget &&
            renderer
              .getCurrentViewport(new THREE.Vector4())
              .equals(previousTarget.viewport),
          "Mirror preparation changed the active offscreen viewport",
        );
        assert(
          gl.isEnabled(gl.SCISSOR_TEST) &&
            Array.from(gl.getParameter(gl.SCISSOR_BOX)).join(",") === "2,1,3,4",
          "Mirror preparation changed offscreen scissor state",
        );
        renderer.setRenderTarget(null);
        previousTarget.dispose();
        const shaderPreparationMilliseconds = performance.now() - shaderStart;
        const firstFrameStart = performance.now();
        renderer.render(scene, camera);
        gl.finish();
        const firstFrameMilliseconds = performance.now() - firstFrameStart;
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const entry of coldObserver.takeRecords())
          coldLongTasks.push(entry.duration);
        coldObserver.disconnect();
        const objects = display.group.children.map((object) => ({
          object,
          geometry: object.geometry,
          position: object.geometry.getAttribute("position"),
          normal: object.geometry.getAttribute("normal"),
          color: object.geometry.getAttribute("color"),
          colorVersion: object.geometry.getAttribute("color").version,
          index: object.geometry.index,
        }));
        const expectedPoints = ownerMirror.cases.reduce(
            (n, c) => n + c.drawn,
            0,
          ),
          gpuFrames = [];
        for (let frame = 0; frame < 20; frame++) {
          display.show(
            displayPoses.map((p) => ({
              ...p,
              matrix: identity.map((v, i) => (i === 3 ? frame * 0.01 : v)),
            })),
            1,
          );
          camera.position.x = center.x + Math.sin(frame * 0.03) * radius;
          camera.lookAt(center);
          camera.updateMatrixWorld(true);
          const start = performance.now();
          renderer.render(scene, camera);
          gl.finish();
          gpuFrames.push(performance.now() - start);
          assert(
            renderer.info.render.points === expectedPoints,
            "GPU submitted the wrong number of native-filtered points",
          );
        }
        const pixels = new Uint8Array(920 * 720 * 4);
        const readbackStart = performance.now();
        gl.readPixels(0, 0, 920, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const pixelReadbackMilliseconds = performance.now() - readbackStart;
        let coloredPixels = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] || pixels[i + 1] || pixels[i + 2]) coloredPixels++;
        assert(
          coloredPixels > 0,
          "GPU mirror frame contains no visible points",
        );
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        const gpuDisplay = {
          offscreenStateRestored: true,
          shaderPreparationMilliseconds,
          firstFrameMilliseconds,
          pixelReadbackMilliseconds,
          coldLongTasks,
          parallelShaderCompile: !!gl.getExtension(
            "KHR_parallel_shader_compile",
          ),
          points: expectedPoints,
          objects: objects.length,
          geometryCount: renderer.info.memory.geometries,
          coloredPixels,
          gpu: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          frames: gpuFrames,
        };
        // Hold the actual Three program's readiness poll across Cancel, independently of driver timing.
        const cancelledDisplay = new displayModule.InteractiveMirrorDisplay(
          sources,
          () => {},
        );
        cancelledDisplay.show([displayPoses[0]], 1);
        cancelledDisplay.publish(displayPoses[0].entityId, {
          indices: new Uint32Array([0]),
          colors: objects[0].color.array,
        });
        const cancelledMaterial = cancelledDisplay.group.children[0].material;
        renderer.compile(cancelledDisplay.group, camera);
        const program =
          renderer.properties.get(cancelledMaterial).currentProgram;
        const originalReady = program.isReady;
        let ready = false,
          releasedMaterial = 0;
        cancelledMaterial.addEventListener("dispose", () => releasedMaterial++);
        program.isReady = () => ready;
        try {
          const pending = cancelledDisplay.prepare(renderer, camera);
          cancelledDisplay.clear();
          assert(
            releasedMaterial === 0,
            "Cancelled shader material was released while Three still reads it",
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
          ready = true;
          assert(
            (await pending) === false &&
              !cancelledDisplay.group.visible &&
              releasedMaterial === 1,
            "Shader cancellation leaked or revealed the old display",
          );
          gpuDisplay.shaderCancelReleased = true;
        } finally {
          ready = true;
          program.isReady = originalReady;
          cancelledDisplay.dispose();
        }
        // End GPU setup/readback's task before sampling warm worker publication.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const warmMirror = [],
          intervals = [],
          longTasks = [];
        let sampling = true,
          last;
        const frame = (now) => {
          if (!sampling) return;
          if (last !== undefined) intervals.push(now - last);
          last = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        const observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) longTasks.push(e.duration);
        });
        observer.observe({ type: "longtask" });
        try {
          for (const c of ownerMirror.cases)
            for (let repeat = 0; repeat < 5; repeat++) {
              const before = preparations;
              const r = await pool.mirror(
                "mirror:" + c.name,
                {
                  ...c.settings,
                  stride: 1,
                  direction: [1 + repeat * 0.01, -0.5, 0.25],
                },
                { includeColors: false },
              );
              assert(
                r.colors === undefined && preparations === before,
                "Warm mirror rebuilt source/color buffers",
              );
              display.publish("mirror:" + c.name, r);
              warmMirror.push({ name: c.name, ...r.execution });
            }
        } finally {
          sampling = false;
          for (const e of observer.takeRecords()) longTasks.push(e.duration);
          observer.disconnect();
        }
        for (const saved of objects)
          assert(
            saved.object.geometry === saved.geometry &&
              saved.geometry.index === saved.index &&
              saved.geometry.getAttribute("position") === saved.position &&
              saved.position.version === 0 &&
              saved.geometry.getAttribute("normal") === saved.normal &&
              saved.normal.version === 0 &&
              saved.geometry.getAttribute("color") === saved.color &&
              saved.color.version === saved.colorVersion,
            "Warm/pose updates rebuilt GPU source or color attributes",
          );
        display.clear();
        assert(
          renderer.info.memory.geometries === 0,
          "GPU geometry leak after mirror close",
        );
        gpuDisplay.geometryCountAfterClear = renderer.info.memory.geometries;
        pool.close();
        assert(live === 0, "Owner worker leak");
        const { createInteractiveOperations, releaseInteractiveSession } =
          await import("/src/automation/interactive-alignment-operations.ts");
        const { expandPlyTopology } = await import("/src/ply-topology.ts");
        const { InteractiveMirrorController } =
          await import("/src/interactive-mirror-controller.ts");
        const entities = ownerFace.vertexState.cases.map((c) => {
          const source = plySources.get(c.name);
          return {
            id: c.name,
            name: c.name,
            kind: "mesh",
            color: "#aaa",
            opacity: 1,
            visible: true,
            positions: expandPlyTopology({
              vertices: source.positions,
              triangles: source.triangles,
            }),
            indexedMesh: {
              vertices: source.positions,
              triangles: source.triangles,
              normals: source.normals,
            },
            meshSelection: {
              hidden: Array.from(
                {
                  length: Math.ceil(
                    c.faces / ownerFace.vertexState.hiddenRule.modulus,
                  ),
                },
                (_, i) => i * ownerFace.vertexState.hiddenRule.modulus,
              ),
              saved: [],
            },
          };
        });
        const factoryMirrorRows = [];
        for (const c of ownerFace.vertexState.cases) {
          const source = plySources.get(c.name),
            expected = ownerFace.mirror.cases.find((r) => r.name === c.name);
          assert(
            (await digest(source.triangles)) === c.trianglesSha256,
            "Owner face-order hash mismatch",
          );
          const selection = new Uint8Array(c.faces);
          for (let i = 0; i < selection.length; i++)
            selection[i] = +(
              i % ownerFace.vertexState.selectionRule.modulus <
              ownerFace.vertexState.selectionRule.lessThan
            );
          let state = null,
            backend = null,
            currentDisplay,
            controller;
          const commits = [];
          const snapshot = () => ({
            entities,
            selectedId: c.name,
            selectedIds: [c.name],
            selection,
            history: [],
            future: [],
            name: "owner",
            authoring: [],
            settings: {},
          });
          const host = {
            snapshot,
            commit: (...args) => commits.push(args),
            inspectApplication: () => ({ previews: {} }),
            publishInteractive: (next) => {
              state = next;
            },
            inspectInteractive: () => state,
            installInteractiveMirror: (next) => {
              backend = next;
              if (!next) currentDisplay?.clear();
            },
          };
          const operations = createInteractiveOperations(host),
            abort = new AbortController();
          const context = {
            signal: abort.signal,
            check: () => abort.signal.throwIfAborted(),
            progress: () => {},
            mutate: (write) => write(),
          };
          const beforeDerive = sourceDerivations,
            beforePrepare = preparations;
          try {
            const start = performance.now();
            const begun = await operations.interactive_alignment_edit(
              { action: "begin", parallel: true },
              context,
            );
            const configure = await operations.interactive_alignment_edit(
              {
                action: "configure",
                sessionId: state.sessionId,
                expectedSessionVersion: state.version,
                mirror: true,
              },
              context,
            );
            const prepared = await backend.source(c.name);
            assert(
              (await digest(prepared.flags)) === c.flagsSha256,
              "Session provider vertex flags differ from original owner refresh",
            );
            const summary = configure.displaySources[0];
            assert(
              summary.selected === c.summary.selected &&
                summary.hidden === c.summary.hidden &&
                summary.visibleFaces === c.summary.visibleFaces,
              "Session source summary differs from original",
            );
            const points = await backend.prepare(c.name, expected.settings);
            assert(
              (await digest(points.indices)) === expected.indicesSha256 &&
                (await digest(compactColors(points.colors, points.indices))) ===
                  expected.colorsSha256,
              "Session provider mirror output differs from original owner draw loop",
            );
            const submitted = new Float32Array(points.indices.length * 3);
            for (let i = 0; i < points.indices.length; i++)
              for (let a = 0; a < 3; a++)
                submitted[i * 3 + a] =
                  prepared.positions[points.indices[i] * 3 + a];
            assert(
              (await digest(submitted)) === expected.drawnPositionsSha256,
              "Session provider submitted points differ from original",
            );
            currentDisplay = new displayModule.InteractiveMirrorDisplay(
              new Map([[c.name, prepared]]),
              () => {},
            );
            scene.add(currentDisplay.group);
            currentDisplay.show(state.targets, state.mirrorPlane);
            currentDisplay.publish(c.name, points);
            assert(
              await currentDisplay.prepare(renderer, camera),
              "Session mirror GPU preparation cancelled",
            );
            renderer.render(scene, camera);
            gl.finish();
            assert(
              renderer.info.render.points === expected.drawn,
              "Session provider GPU point count mismatch",
            );
            const positions = source.positions,
              normals = source.normals;
            await operations.interactive_alignment_edit(
              {
                action: "step",
                sessionId: state.sessionId,
                expectedSessionVersion: state.version,
                kind: "translatePositive",
                axis: 0,
                value: 1,
              },
              context,
            );
            currentDisplay.show(state.targets, state.mirrorPlane);
            assert(
              source.positions === positions &&
                source.normals === normals &&
                commits.length === 0,
              "Session preview changed source geometry/history",
            );
            assert(
              sourceDerivations - beforeDerive === 1 &&
                preparations - beforePrepare === 2,
              "Session repeated mesh setup or allocated extra source copies",
            );
            // Drive the real GPU sink through the production coalescing controller and the SAME session pool.
            currentDisplay.dispose();
            scene.remove(currentDisplay.group);
            let lastPublication,
              calls = 0,
              colorCalls = 0,
              activeCalls = 0,
              maxActiveCalls = 0;
            const controllerErrors = [];
            controller = new InteractiveMirrorController(
              {
                entityIds: backend.entityIds,
                source: (...args) => backend.source(...args),
                prepare: async (...args) => {
                  calls++;
                  if (args[2]) colorCalls++;
                  activeCalls++;
                  maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
                  try {
                    return await backend.prepare(...args);
                  } finally {
                    activeCalls--;
                  }
                },
              },
              {
                create: (sources) => {
                  currentDisplay = new displayModule.InteractiveMirrorDisplay(
                    sources,
                    () => {},
                  );
                  scene.add(currentDisplay.group);
                  return {
                    show: (poses, plane) => currentDisplay.show(poses, plane),
                    publish: (id, p) => {
                      lastPublication = p;
                      currentDisplay.publish(id, p);
                    },
                    prepare: () => currentDisplay.prepare(renderer, camera),
                    dispose: () => {
                      currentDisplay.dispose();
                      scene.remove(currentDisplay.group);
                    },
                  };
                },
                onError: (error) => controllerErrors.push(String(error)),
              },
            );
            const controllerRequest = {
              poses: state.targets,
              plane: state.mirrorPlane,
              settings: expected.settings,
            };
            controller.update(controllerRequest);
            await controller.settled();
            assert(
              controller.inspect().ready && !controllerErrors.length,
              "Controller failed to prepare owner source",
            );
            assert(
              (await digest(lastPublication.indices)) ===
                expected.indicesSha256 &&
                (await digest(
                  compactColors(
                    lastPublication.colors,
                    lastPublication.indices,
                  ),
                )) === expected.colorsSha256,
              "Controller publication differs from original owner point output",
            );
            renderer.render(scene, camera);
            gl.finish();
            assert(
              renderer.info.render.points === expected.drawn,
              "Controller GPU point count differs from original",
            );
            const gpuObject = currentDisplay.group.children[0],
              gpuGeometry = gpuObject.geometry,
              gpuPosition = gpuGeometry.getAttribute("position"),
              gpuColor = gpuGeometry.getAttribute("color"),
              colorVersion = gpuColor.version;
            const beforePoseCalls = calls;
            for (let i = 0; i < 100; i++)
              controller.update({
                ...controllerRequest,
                poses: state.targets.map((p) => ({
                  ...p,
                  matrix: p.matrix.map((v, j) => (j === 3 ? i : v)),
                })),
                plane: i % 3,
              });
            assert(
              calls === beforePoseCalls &&
                gpuObject.geometry === gpuGeometry &&
                gpuGeometry.getAttribute("position") === gpuPosition &&
                gpuPosition.array === prepared.positions,
              "Pose-only controller updates rebuilt source/GPU buffers",
            );
            const beforeViews = calls;
            for (let i = 0; i < 100; i++)
              controller.update({
                ...controllerRequest,
                settings: {
                  ...expected.settings,
                  direction: [1 + i / 100, 0, -1],
                },
              });
            controller.update(controllerRequest);
            await controller.settled();
            assert(
              calls - beforeViews <= 2 &&
                colorCalls === 1 &&
                maxActiveCalls === 1,
              "Controller queued redundant parallel/color work during orbit",
            );
            assert(
              gpuGeometry.getAttribute("color") === gpuColor &&
                gpuColor.version === colorVersion &&
                !controllerErrors.length,
              "Controller rebuilt warm colors or failed",
            );
            const controllerStatus = controller.inspect();
            assert(
              controllerStatus.ready,
              "Controller did not settle on the latest requested view",
            );
            controller.dispose();
            controller = undefined;
            assert(
              renderer.info.memory.geometries === 0,
              "Controller retained GPU geometry after close",
            );
            factoryMirrorRows.push({
              controllerNativeDrawDigestsMatched: true,
              controllerRequests: calls,
              controllerColorRequests: colorCalls,
              controllerMaximumActiveRequests: maxActiveCalls,
              controllerStatus,
              controllerSourceBuffersReused: true,
              name: c.name,
              vertices: c.vertices,
              faces: c.faces,
              points: expected.drawn,
              nativeFlagsMatched: true,
              nativeDrawDigestsMatched: true,
              sourceDerivations: sourceDerivations - beforeDerive,
              sourcePreparations: preparations - beforePrepare,
              verticesAttached: positions.length === c.vertices * 3,
              normalsAttached: normals.length === c.vertices * 3,
              beginPivot: begun.pivot,
              milliseconds: performance.now() - start,
              execution: points.execution,
            });
          } finally {
            controller?.dispose();
            releaseInteractiveSession(host);
            currentDisplay?.dispose();
            if (currentDisplay) scene.remove(currentDisplay.group);
            assert(
              live === 0 && renderer.info.memory.geometries === 0,
              "Shared session cleanup left workers or GPU geometries",
            );
          }
        }
        const { Viewport } = await import("/src/viewport.ts");
        const { renderSceneWithGrid } = await import("/src/viewport-grid.ts");
        const clipSource = {
          positions: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1]),
          normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
          flags: new Uint32Array(3),
        };
        const clipPool = new InteractiveBoundsPool(
          new Map([["clip", clipSource]]),
          { parallel: false },
        );
        const clipGeometry = new THREE.BufferGeometry();
        clipGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(clipSource.positions, 3),
        );
        clipGeometry.computeBoundingBox();
        const clipMesh = new THREE.Mesh(
          clipGeometry,
          new THREE.MeshStandardMaterial(),
        );
        scene.add(clipMesh);
        const clipCamera = new THREE.OrthographicCamera(
          -2,
          2,
          2,
          -2,
          -10000,
          10000,
        );
        clipCamera.position.set(20010, 0, 0);
        clipCamera.up.set(0, 0, 1);
        clipCamera.lookAt(20000, 0, 0);
        clipCamera.updateMatrixWorld();
        const view = Object.create(Viewport.prototype);
        Object.assign(view, {
          scene,
          renderer,
          camera: clipCamera,
          objects: new Map([["clip", { mesh: clipMesh }]]),
          bounds: clipGeometry.boundingBox.clone(),
          controls: { target: new THREE.Vector3(20000, 0, 0) },
          container: { clientWidth: 920, clientHeight: 720 },
          invalidate: () => {},
          advanceViewTransition: () => {},
        });
        let viewportClipReplay;
        try {
          view.installInteractiveMirror({
            entityIds: ["clip"],
            source: (id) => clipPool.preparedSource(id, { normals: true }),
            prepare: (id, settings, includeColors) =>
              clipPool.mirror(id, settings, { includeColors }),
          });
          view.setInteractivePreview({
            targets: [
              {
                entityId: "clip",
                matrix: identity.map((v, i) => (i === 3 ? 20000 : v)),
              },
            ],
            bounds: [{ min: [20000, 0, 0], max: [20000, 1, 1] }],
            mirror: true,
            mirrorPlane: 1,
          });
          const ready = await view.settleInteractiveMirror();
          assert(
            ready.ready && !ready.error,
            "Viewport mirror did not become ready",
          );
          const depth = new THREE.Vector3(-20000, 0.5, 0.5).project(
            clipCamera,
          ).z;
          assert(
            depth >= -1 && depth <= 1,
            "Reflected scan is outside the viewport depth range",
          );
          clipMesh.visible = false;
          renderSceneWithGrid(
            renderer,
            scene,
            new THREE.Scene(),
            clipCamera,
            view.interactiveMirrorClipBounds,
          );
          gl.finish();
          const bytes = new Uint8Array(
            renderer.domElement.width * renderer.domElement.height * 4,
          );
          gl.readPixels(
            0,
            0,
            renderer.domElement.width,
            renderer.domElement.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            bytes,
          );
          let pixels = 0;
          for (let i = 0; i < bytes.length; i += 4)
            if (bytes[i] || bytes[i + 1] || bytes[i + 2]) pixels++;
          assert(
            pixels > 0 && renderer.info.render.points === 3,
            "Viewport did not rasterize the reflected points",
          );
          const observation = view.inspectAgentView();
          assert(
            observation.bounds.min[0] === 20000 &&
              observation.bounds.max[0] === 20000 &&
              observation.interactiveMirror.ready,
            "Viewport changed native alignment bounds or omitted agent diagnostics",
          );
          viewportClipReplay = {
            offsetMm: 20000,
            depth,
            drawnPoints: renderer.info.render.points,
            coloredPixels: pixels,
            nativeBoundsPreserved: true,
            agentDiagnostics: observation.interactiveMirror,
          };
        } finally {
          view.setInteractivePreview(null);
          view.installInteractiveMirror(null);
          clipPool.close();
          scene.remove(clipMesh);
          clipGeometry.dispose();
          clipMesh.material.dispose();
        }
        assert(
          renderer.info.memory.geometries === 0 && live === 0,
          "Viewport mirror replay cleanup leaked GPU geometry/workers",
        );
        return {
          viewportClipReplay,
          mirrorKernelCases: mirrorNative.cases.length,
          ownerMirrorRows,
          warmMirror,
          gpuDisplay,
          factoryMirrorRows,
          sourceDerivations,
          mainFrameIntervals: intervals,
          mainLongTasks: longTasks,
          maximumLiveWorkers: maximumLive,
          kernelCases: kernels.cases.length,
          ownerCases: rows.length,
          rows,
          createdWorkers: created,
          coldPreparations,
          warmMilliseconds,
          liveWorkers: live,
        };
      } finally {
        display?.dispose();
        renderer?.dispose();
        renderer?.forceContextLoss();
        renderer?.domElement.remove();
        pool?.close();
        globalThis.Worker = OriginalWorker;
      }
    },
    {
      fixture,
      kernelFixture,
      mirrorFixture,
      ownerMirrorFixture,
      ownerFaceFixture,
      workerUrl: origin + "/interactive-bounds-worker-bundle.mjs",
      inputOrigin: "http://127.0.0.1:" + ledger.inputPort,
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(lease);
  try {
    await browser?.close();
  } finally {
    try {
      await browserServer?.close();
    } finally {
      if (inputServer) {
        inputServer.closeAllConnections();
        await new Promise((resolve) => inputServer.close(resolve));
      }
      await unlink(new URL("harness.html", out)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      ledger.closedAt = new Date().toISOString();
      await save();
    }
  }
}
