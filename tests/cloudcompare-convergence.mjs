import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "docs/evidence/cloudcompare-20261029/alignment");
const executable = "C:/tools/CloudCompare-2.13.2/CloudCompare.exe";
const run = promisify(execFile);
const digest = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(out, { recursive: true });
const acceptance = {
  correspondingRmsMm: 0.00005,
  translationErrorMm: 0.0001,
  rotationFrobeniusError: 0.00001,
  rerunDisplacementRmsMm: 0.00001,
  reason:
    "Known rigid noiseless Float32 fixtures, coordinates below 30 mm. These are predeclared geometric and stability thresholds, independent of solver RMS/flags.",
};
await writeFile(
  join(out, "convergence-acceptance.json"),
  JSON.stringify(acceptance, null, 2) + "\n",
);

function multiply(a, b) {
  return Array.from({ length: 9 }, (_, i) =>
    [0, 1, 2].reduce(
      (sum, k) => sum + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + (i % 3)],
      0,
    ),
  );
}
function pose(x, y, z, translation) {
  [x, y, z] = [x, y, z].map((a) => (a * Math.PI) / 180);
  const sx = Math.sin(x),
    cx = Math.cos(x),
    sy = Math.sin(y),
    cy = Math.cos(y),
    sz = Math.sin(z),
    cz = Math.cos(z);
  return {
    rotation: multiply(
      [cz, -sz, 0, sz, cz, 0, 0, 0, 1],
      multiply(
        [cy, 0, sy, 0, 1, 0, -sy, 0, cy],
        [1, 0, 0, 0, cx, -sx, 0, sx, cx],
      ),
    ),
    translation,
  };
}
function inverse(t) {
  const r = t.rotation;
  const rotation = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  return {
    rotation,
    translation: [0, 1, 2].map(
      (a) =>
        -[0, 1, 2].reduce(
          (sum, k) => sum + rotation[a * 3 + k] * t.translation[k],
          0,
        ),
    ),
  };
}
function apply(points, t) {
  const result = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3)
    for (let a = 0; a < 3; a++)
      result[i + a] =
        t.translation[a] +
        t.rotation[a * 3] * points[i] +
        t.rotation[a * 3 + 1] * points[i + 1] +
        t.rotation[a * 3 + 2] * points[i + 2];
  return result;
}
function rms(a, b, points = b.length / 3) {
  let sum = 0;
  for (let i = 0; i < points * 3; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / points);
}
function error(t, truth) {
  return {
    translationErrorMm: Math.hypot(
      ...t.translation.map((v, i) => v - truth.translation[i]),
    ),
    rotationFrobeniusError: Math.hypot(
      ...t.rotation.map((v, i) => v - truth.rotation[i]),
    ),
  };
}
const fixed = Float32Array.from(
  Array.from({ length: 693 }, (_, i) => {
    const x = (i % 11) - 5,
      y = (Math.floor(i / 11) % 9) - 4,
      z = Math.floor(i / 99) - 3;
    return [
      2 * x + 0.19 * Math.sin(i * 1.31),
      2.3 * y + 0.17 * Math.cos(i * 2.13),
      3.1 * z + 0.23 * Math.sin(i * 0.71),
    ];
  }).flat(),
);
const noisyAcceptance = {
  correspondingRmsMm: 0.02,
  translationErrorMm: 0.002,
  rotationFrobeniusError: 0.001,
  rerunDisplacementRmsMm: 0.00001,
};
await writeFile(
  join(out, "noisy-acceptance.json"),
  JSON.stringify(noisyAcceptance, null, 2) + "\n",
);
const cases = [
  {
    name: "noisy-three-axis",
    authored: pose(-2, 1.5, 3, [0.4, -0.3, 0.2]),
    overlap: 100,
    noise: 0.01,
  },
  {
    name: "insufficient-overlap-control",
    authored: pose(0, 0, 2, [0.15, -0.12, 0.3]),
    overlap: 100,
    outliers: 693,
    expectedRefusal: true,
  },
  {
    name: "z-two-degrees",
    authored: pose(0, 0, 2, [0.15, -0.12, 0.3]),
    overlap: 100,
  },
  {
    name: "three-axis",
    authored: pose(-2, 1.5, 3, [0.4, -0.3, 0.2]),
    overlap: 100,
  },
  {
    name: "z-five-degrees",
    authored: pose(0, 0, 5, [-0.25, 0.2, -0.15]),
    overlap: 100,
  },
  {
    name: "partial-with-authored-outliers",
    authored: pose(0, 0, 2, [0.15, -0.12, 0.3]),
    overlap: 80,
    outliers: 173,
  },
];
const ply = (points) =>
  `ply\nformat ascii 1.0\nelement vertex ${points.length / 3}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${Array.from({ length: points.length / 3 }, (_, i) => Array.from(points.slice(i * 3, i * 3 + 3)).join(" ")).join("\n")}\n`;
const parseAsc = (text) =>
  Float32Array.from(
    text
      .trim()
      .split(/\r?\n/)
      .flatMap((line) => line.trim().split(/\s+/).slice(0, 3).map(Number)),
  );
const parseMatrix = (text) => {
  const m = text.trim().split(/\s+/).map(Number);
  assert.equal(m.length, 16);
  return {
    rotation: [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
    translation: [m[3], m[7], m[11]],
  };
};
async function native(name, points, target, overlap, tolerance) {
  const folder = join(out, name);
  await mkdir(folder, { recursive: true });
  const movingText = ply(points),
    fixedText = ply(target);
  await writeFile(join(folder, "moving.ply"), movingText);
  await writeFile(join(folder, "fixed.ply"), fixedText);
  const args = [
    "-SILENT",
    "-LOG_FILE",
    join(folder, "native.log"),
    "-AUTO_SAVE",
    "OFF",
    "-C_EXPORT_FMT",
    "ASC",
    "-NO_TIMESTAMP",
    "-O",
    join(folder, "moving.ply"),
    "-O",
    join(folder, "fixed.ply"),
    "-ICP",
    "-OVERLAP",
    String(overlap),
    "-MIN_ERROR_DIFF",
    String(tolerance),
    "-RANDOM_SAMPLING_LIMIT",
    String(points.length / 3),
    "-MAX_TCOUNT",
    "2",
    "-SAVE_CLOUDS",
  ];
  const started = performance.now();
  const stdout = await run(executable, args, {
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  await writeFile(
    join(folder, "process-output.json"),
    JSON.stringify(stdout, null, 2) + "\n",
  );
  const output = parseAsc(
    await readFile(join(folder, "moving_REGISTERED.asc"), "utf8"),
  );
  assert.equal(output.length, points.length);
  const transform = parseMatrix(
    await readFile(join(folder, "moving_REGISTRATION_MATRIX.txt"), "utf8"),
  );
  const receipt = {
    arguments: args,
    durationMs: performance.now() - started,
    deadlineMs: 120000,
    movingSha256: digest(movingText),
    fixedSha256: digest(fixedText),
    transform,
  };
  await writeFile(
    join(folder, "invocation.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return { output, transform, receipt };
}
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const results = [];
try {
  const { registerFineAlignment } = await server.ssrLoadModule(
    "/src/fine-registration.ts",
  );
  for (const sample of cases) {
    const truth = inverse(sample.authored);
    let moving = apply(fixed, sample.authored);
    if (sample.noise)
      moving = Float32Array.from(
        moving,
        (v, i) => v + sample.noise * Math.sin(i * 1.618),
      );
    if (sample.outliers)
      moving = Float32Array.from([
        ...moving,
        ...Array.from({ length: sample.outliers }, (_, i) => [
          55 + i * 0.2,
          45 + Math.sin(i),
          40 + Math.cos(i),
        ]).flat(),
      ]);
    const before = digest(moving);
    const nativeFit = await native(
      `${sample.name}/native-first`,
      moving,
      fixed,
      sample.overlap,
      1e-7,
    );
    const nativeRepeat = await native(
      `${sample.name}/native-stricter-rerun`,
      nativeFit.output,
      fixed,
      sample.overlap,
      1e-8,
    );
    const options = {
      targetRms: 1e-12,
      tolerance: 1e-7,
      overlapPercent: sample.overlap,
      sampleSize: moving.length / 3,
      maxDistance: 10,
      maxIterations: 200,
    };
    const fit = registerFineAlignment(moving, fixed, options);
    const output = apply(moving, fit.transform);
    const repeat = registerFineAlignment(output, fixed, {
      ...options,
      tolerance: 1e-8,
    });
    const repeatOutput = apply(output, repeat.transform);
    assert.equal(digest(moving), before);
    const nativeMetrics = {
      ...error(nativeFit.transform, truth),
      correspondingRmsMm: rms(nativeFit.output, fixed),
      rerunDisplacementRmsMm: rms(
        nativeRepeat.output,
        nativeFit.output,
        fixed.length / 3,
      ),
    };
    const scanforgeMetrics = {
      proposedTransform: fit.transform,
      ...error(fit.transform, truth),
      correspondingRmsMm: rms(output, fixed),
      rerunDisplacementRmsMm: rms(repeatOutput, output, fixed.length / 3),
      applicationCorrespondingRmsMm: rms(fit.applied ? output : moving, fixed),
      metricScope:
        "Transform metrics evaluate proposed transform; application metric preserves source when applied is false.",
      reportedRms: fit.rms,
      reportedOverlapRms: fit.overlapRms,
      iterations: fit.iterations,
      terminationReason: fit.terminationReason,
      targetReached: fit.targetReached,
      converged: fit.converged,
      applied: fit.applied,
    };
    const pass = (metrics) =>
      Object.entries(sample.noise ? noisyAcceptance : acceptance)
        .filter(([key]) => key !== "reason")
        .every(([key, limit]) => metrics[key] <= limit);
    const result = {
      name: sample.name,
      sourcePoints: moving.length / 3,
      knownCorrespondences: fixed.length / 3,
      movingSha256: before,
      truth,
      initialCorrespondingRmsMm: rms(moving, fixed),
      commonFittingOptions: {
        overlapPercent: sample.overlap,
        sampleSize: moving.length / 3,
        adjustScale: false,
        normals: "none",
        constraints: "none",
      },
      stopping: {
        native: "RMS decrease1e-7, stricter rerun1e-8, external120s deadline",
        scanforge: options,
        limitation:
          "Native RMS decrease and ScanForge combined motion/stagnation tests are different stopping rules; acceptance uses independent geometry and rerun stability.",
      },
      native: nativeMetrics,
      scanforge: scanforgeMetrics,
      expectedRefusal: Boolean(sample.expectedRefusal),
      expectedRefusalScope: sample.expectedRefusal
        ? "ScanForge has a 10 mm gate absent from native CLI; independent accuracy rejection of native stable wrong fit, and correct ScanForge no-application are separate controls."
        : undefined,
      acceptance: sample.noise ? noisyAcceptance : acceptance,
      accepted: {
        native: pass(nativeMetrics),
        scanforge: pass(scanforgeMetrics),
      },
    };
    results.push(result);
    await writeFile(
      join(out, "convergence-results.json"),
      JSON.stringify(
        {
          acceptance,
          executableSha256: digest(await readFile(executable)),
          results,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify(result));
  }
  assert(
    results.every((r) =>
      r.expectedRefusal
        ? !r.accepted.native &&
          r.accepted.scanforge &&
          r.scanforge.applicationCorrespondingRmsMm ===
            r.initialCorrespondingRmsMm &&
          !r.scanforge.applied &&
          !r.scanforge.converged &&
          r.scanforge.terminationReason === "insufficientOverlap"
        : r.accepted.native && r.accepted.scanforge,
    ),
    "Independent convergence acceptance failed; retained failed metrics must be investigated.",
  );
} finally {
  await server.close();
}
