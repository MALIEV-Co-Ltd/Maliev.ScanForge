import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

// Diagnostic source only. Coordinator admission is required before execution.
// Uses the actual unchanged classic worker/WASM, with a 12-second inner cap.
const root = new URL("../", import.meta.url);
const out = new URL(
  process.env.SCANFORGE_BOOLEAN_BREP_OUT ??
    ".resources/m5/boolean-brep-diagnostic/",
  root,
);
if (!out.pathname.endsWith("/")) out.pathname += "/";
mkdirSync(new URL("../", out), { recursive: true });
mkdirSync(out); // A fresh destination preserves all earlier diagnostic receipts.
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const requests = new Map();
let sequence = 0;
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) return;
      const pending = requests.get(reply.id);
      requests.delete(reply.id);
      if (reply.error) pending.reject(Error(reply.error));
      else pending.resolve(reply.result);
    },
  },
});
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context, {
    filename: "opencascade.js",
  });
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
const workerBytes = readFileSync(new URL("public/cad-worker.js", root));
vm.runInContext(workerBytes.toString("utf8"), context, {
  filename: "cad-worker.js",
});
const request = (operation, payload) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    requests.set(id, { resolve, reject });
    context.self.onmessage({ data: { id, operation, payload } });
  });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  scope:
    "Focused actual-worker diagnostic; no browser/native-application parity or complete matrix acceptance claim.",
  workerSha256: sha(workerBytes),
  snapshots: [],
  fences: [],
  results: [],
  completed: false,
};
const save = () =>
  writeFileSync(
    new URL("diagnostic.json", out),
    JSON.stringify(report, null, 2),
  );
const expiry = setTimeout(() => {
  report.failure = "Boolean BREP diagnostic exceeded 12 seconds.";
  save();
  process.exit(124);
}, 12_000);
const owners = [];
const create = async (operation, payload) => {
  const result = await request(operation, payload);
  owners.push(result.kernelId);
  return result;
};
const difference = (a, b) => {
  const limit = Math.min(a.length, b.length);
  let offset = 0;
  while (offset < limit && a[offset] === b[offset]) offset++;
  if (offset === limit && a.length === b.length) return null;
  const linesA = a.split("\n"),
    linesB = b.split("\n");
  const line = a.slice(0, offset).split("\n").length - 1;
  return {
    offset,
    line: line + 1,
    bytesA: Buffer.byteLength(a),
    bytesB: Buffer.byteLength(b),
    contextA: linesA.slice(Math.max(0, line - 3), line + 5),
    contextB: linesB.slice(Math.max(0, line - 3), line + 5),
  };
};
let oc;
const snapshot = (label, kernelId, value) => {
  const brep = value ?? context.serializeBrep(oc, context.getShape(kernelId));
  const file = `${label}.brep`;
  writeFileSync(new URL(file, out), brep);
  report.snapshots.push({
    label,
    kernelId,
    file,
    bytes: Buffer.byteLength(brep),
    sha256: sha(brep),
  });
  return brep;
};
const fence = (label, expected, actual) => {
  const diff = difference(expected, actual);
  report.fences.push({ label, equal: diff === null, difference: diff });
};
const geometry = (shape) =>
  Object.fromEntries(
    ["positions", "normals", "edgePositions"].map((key) => {
      const values = new Float32Array(shape[key] ?? []);
      return [
        key,
        { elements: values.length, sha256: sha(Buffer.from(values.buffer)) },
      ];
    }),
  );
let primaryFailure;
try {
  oc = await vm.runInContext("kernel()", context);
  const fixture = JSON.parse(
    readFileSync(
      new URL("docs/evidence/m5-20261025/sketch-surface-real-scan.json", root),
      "utf8",
    ),
  );
  const sketch = fixture.authoredGuiProfile;
  const points = new Map(
    sketch.points.map((point) => [point.id, [point.x, point.y]]),
  );
  const edges = sketch.segments.map((edge) => ({
    kind: "line",
    start: points.get(edge.a),
    end: points.get(edge.b),
  }));
  report.source = {
    scanSha256: fixture.sha256,
    retainedProfile: sketch,
    heightMm: 1.8,
    toolTranslationMm: [0, 0, 0.9],
  };
  const face = await create("sketchSurface", { edges, frame: sketch.frame });
  const faceBefore = snapshot("face-before-thicken", face.kernelId);
  const base = await create("thicken", {
    kernelId: face.kernelId,
    thickness: 1.8,
  });
  snapshot("base-returned", base.kernelId, base.brep);
  fence(
    "face unchanged after thicken",
    faceBefore,
    snapshot("face-after-thicken", face.kernelId),
  );
  const baseBeforeTool = snapshot("base-before-tool-transform", base.kernelId);
  fence(
    "base returned versus live before tool transform",
    base.brep,
    baseBeforeTool,
  );
  const tool = await create("transform", {
    kernelId: base.kernelId,
    translation: [0, 0, 0.9],
    rotation: [0, 0, 0],
    scale: 1,
  });
  fence(
    "base unchanged after tool transform",
    baseBeforeTool,
    snapshot("base-after-tool-transform", base.kernelId),
  );
  const sourceBefore = {
    base: snapshot("base-before-boolean-1", base.kernelId),
    tool: snapshot("tool-before-boolean-1", tool.kernelId),
  };
  snapshot("tool-returned", tool.kernelId, tool.brep);
  fence(
    "tool returned versus live before subtract",
    tool.brep,
    sourceBefore.tool,
  );
  fence(
    "same live base serialization repeated",
    sourceBefore.base,
    snapshot("base-before-boolean-1-repeat", base.kernelId),
  );
  fence(
    "same live tool serialization repeated",
    sourceBefore.tool,
    snapshot("tool-before-boolean-1-repeat", tool.kernelId),
  );
  const first = await create("boolean", {
    operation: "subtract",
    firstId: base.kernelId,
    secondId: tool.kernelId,
  });
  const firstBrep = snapshot("subtract-1-returned", first.kernelId, first.brep);
  const afterFirst = {
    base: snapshot("base-after-boolean-1", base.kernelId),
    tool: snapshot("tool-after-boolean-1", tool.kernelId),
  };
  fence(
    "base unchanged after first subtract",
    sourceBefore.base,
    afterFirst.base,
  );
  fence(
    "tool unchanged after first subtract",
    sourceBefore.tool,
    afterFirst.tool,
  );
  fence(
    "first result returned versus same live shape",
    firstBrep,
    snapshot("subtract-1-live-before-repeat", first.kernelId),
  );
  const second = await create("boolean", {
    operation: "subtract",
    firstId: base.kernelId,
    secondId: tool.kernelId,
  });
  const secondBrep = snapshot(
    "subtract-2-returned",
    second.kernelId,
    second.brep,
  );
  fence(
    "base unchanged after second subtract",
    sourceBefore.base,
    snapshot("base-after-boolean-2", base.kernelId),
  );
  fence(
    "tool unchanged after second subtract",
    sourceBefore.tool,
    snapshot("tool-after-boolean-2", tool.kernelId),
  );
  fence(
    "first live result unchanged after second subtract",
    firstBrep,
    snapshot("subtract-1-live-after-repeat", first.kernelId),
  );
  fence(
    "same first live result serialization repeated",
    snapshot("subtract-1-live-repeat-a", first.kernelId),
    snapshot("subtract-1-live-repeat-b", first.kernelId),
  );
  fence(
    "same second live result serialization repeated",
    snapshot("subtract-2-live-repeat-a", second.kernelId),
    snapshot("subtract-2-live-repeat-b", second.kernelId),
  );
  report.firstVersusSecond = {
    equal: firstBrep === secondBrep,
    difference: difference(firstBrep, secondBrep),
  };
  report.firstVersusSecondGeometry = {
    first: geometry(first),
    second: geometry(second),
  };
  // Public protocol inspection of saved strings does not stand in for the live
  // serialization fences above. Both are retained to distinguish these layers.
  for (const [label, result] of [
    ["first", first],
    ["second", second],
  ]) {
    const inspected = await request("inspectBrep", {
      brep: result.brep,
      edgeOffset: 0,
      edgeLimit: 128,
    });
    report.results.push({ label, report: inspected });
    assert(
      inspected.valid &&
        inspected.solids === 1 &&
        inspected.signedVolumeMm3 > 0,
    );
    assert(Math.abs(inspected.volumeMm3 - 84.28827382618772 * 0.9) <= 1e-6);
  }
  const beforeRecovery = {
    base: snapshot("base-before-recovery-transform", base.kernelId),
    tool: snapshot("tool-before-recovery-transform", tool.kernelId),
  };
  for (const [label, source] of [
    ["base", base],
    ["tool", tool],
  ]) {
    const moved = await create("transform", {
      kernelId: source.kernelId,
      translation: [10, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
    });
    snapshot(
      `${label}-recovery-transform-returned`,
      moved.kernelId,
      moved.brep,
    );
    fence(
      `${label} unchanged after recovery transform`,
      beforeRecovery[label],
      snapshot(`${label}-after-recovery-transform`, source.kernelId),
    );
  }
  report.completed = true;
  save();
  // Mandatory ownership fences may produce the focused RED. Output-to-output
  // BREP equality remains a recorded diagnostic, not a guessed root cause.
  assert(
    report.fences.every((item) => item.equal),
    "Live source/result BREP changed: inspect diagnostic.json and retained raw files.",
  );
} catch (failure) {
  primaryFailure = failure;
  report.failure = failure instanceof Error ? failure.stack : String(failure);
  save();
} finally {
  try {
    assert.equal(await request("release", owners.reverse()), true);
    assert.equal(vm.runInContext("shapes.size", context), 0);
    report.releasedAllHandles = true;
  } catch (failure) {
    report.cleanupFailure =
      failure instanceof Error ? failure.stack : String(failure);
    primaryFailure ??= failure;
  }
  clearTimeout(expiry);
  save();
}
console.log(
  JSON.stringify(
    {
      completed: report.completed,
      releasedAllHandles: report.releasedAllHandles,
      firstVersusSecond: report.firstVersusSecond,
      fences: report.fences,
      failure: report.failure,
      cleanupFailure: report.cleanupFailure,
      receipt: new URL("diagnostic.json", out).href,
    },
    null,
    2,
  ),
);
if (primaryFailure) process.exitCode = 1;
