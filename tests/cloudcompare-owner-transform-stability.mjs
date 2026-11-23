import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { resolve, join } from "node:path";
const root = resolve("."),
  out = join(root, "docs/evidence/cloudcompare-20261029/alignment");
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { parsePackedBinaryPly } = await server.ssrLoadModule(
    "/src/ply-binary-topology.ts",
  );
  const bytes = await readFile(resolve("../alignment-example-files/ply-2.ply"));
  const mesh = parsePackedBinaryPly(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const matrix = async (name, file = "moving_REGISTRATION_MATRIX.txt") =>
    (await readFile(join(out, "owner-native-convergence", name, file), "utf8"))
      .trim()
      .split(/\s+/)
      .map(Number);
  const point = (p, m) =>
    [0, 1, 2].map((a) =>
      Math.fround(
        m[a * 4] * p[0] +
          m[a * 4 + 1] * p[1] +
          m[a * 4 + 2] * p[2] +
          m[a * 4 + 3],
      ),
    );
  const displace = (first, second, incremental = false) => {
    let sum = 0,
      max = 0;
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const p = mesh.vertices.subarray(i, i + 3),
        a = point(p, first),
        b = point(incremental ? a : p, second);
      const d2 = a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0);
      sum += d2;
      max = Math.max(max, d2);
    }
    return {
      evaluatedPoints: mesh.vertices.length / 3,
      rmsDisplacementMm: Math.sqrt(sum / (mesh.vertices.length / 3)),
      maximumDisplacementMm: Math.sqrt(max),
    };
  };
  const twenty = await matrix("20"),
    twoHundred = await matrix("200"),
    adaptive = await matrix("adaptive");
  const report = {
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    precision:
      "Each application of native saved matrix is rounded to Float32; restart delta is applied to Float32 base points.",
    physicalTruth:
      "Unknown; no accuracy or global-convergence certificate is inferred from stability.",
    twentyToTwoHundred: displace(twenty, twoHundred),
    twoHundredToAdaptive: displace(twoHundred, adaptive),
    twoHundredRestartTwenty: displace(
      twoHundred,
      await matrix("rerun200", "moving_TRANSFORMED_REGISTRATION_MATRIX.txt"),
      true,
    ),
    adaptiveRestartAdaptive: displace(
      adaptive,
      await matrix(
        "rerun-adaptive",
        "moving_TRANSFORMED_REGISTRATION_MATRIX.txt",
      ),
      true,
    ),
  };
  await writeFile(
    join(out, "owner-transform-stability.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
