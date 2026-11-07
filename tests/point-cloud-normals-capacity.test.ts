import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { preparePointCloudNormals } from "../src/point-cloud-normals";

it.skipIf(process.env.SCANFORGE_NORMALS_CAPACITY !== "1")(
  "estimates all 500000 points without sampling the cloud",
  () => {
    const count = 500000,
      p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const z = 1 - (2 * (i + 0.5)) / count,
        r = Math.sqrt(1 - z * z),
        a = i * Math.PI * (3 - Math.sqrt(5));
      p.set([r * Math.cos(a), r * Math.sin(a), z], i * 3);
    }
    const start = performance.now();
    const result = preparePointCloudNormals(p, undefined, {
      mode: "estimate-outward",
    });
    let minimumDot = 1;
    for (let i = 0; i < count; i++) {
      const at = i * 3;
      minimumDot = Math.min(
        minimumDot,
        result.normals[at] * p[at] +
          result.normals[at + 1] * p[at + 1] +
          result.normals[at + 2] * p[at + 2],
      );
    }
    const receipt = {
      pointCount: count,
      minimumNormalDot: minimumDot,
      elapsedMs: performance.now() - start,
      arrayBufferBytes: process.memoryUsage().arrayBuffers,
      diagnostics: result.diagnostics,
      scope:
        "All 500000 analytical sphere samples processed; no sampling. Coordinates and normals are compared against the independently authored unit sphere.",
      preprocessorSha256: createHash("sha256")
        .update(readFileSync("src/point-cloud-normals.ts"))
        .digest("hex"),
      inputSha256: createHash("sha256")
        .update(new Uint8Array(p.buffer))
        .digest("hex"),
      outputNormalsSha256: createHash("sha256")
        .update(new Uint8Array(result.normals.buffer))
        .digest("hex"),
      settings: { mode: "estimate-outward", neighbors: 24 },
    };
    console.info(JSON.stringify(receipt));
    if (process.env.SCANFORGE_NORMALS_CAPACITY_RECEIPT)
      writeFileSync(
        process.env.SCANFORGE_NORMALS_CAPACITY_RECEIPT,
        JSON.stringify(receipt, null, 2) + "\n",
      );
    expect(result.normals.length).toBe(p.length);
    expect(minimumDot).toBeGreaterThan(0.995);
  },
  120000,
);
