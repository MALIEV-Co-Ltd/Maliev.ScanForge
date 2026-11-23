import { expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { preparePointCloudNormals } from "../src/point-cloud-normals";

it.skipIf(!process.env.SCANFORGE_NORMALS_REAL_PLY)(
  "estimates every owner scan point using supplied orientation anchors",
  () => {
    const path = process.env.SCANFORGE_NORMALS_REAL_PLY!,
      bytes = readFileSync(path),
      hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const geometry = new PLYLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const p = geometry.attributes.position.array as Float32Array,
      n = geometry.attributes.normal.array as Float32Array,
      start = performance.now();
    const result = preparePointCloudNormals(p, n, {
      mode: "estimate-provided",
    });
    if (process.env.SCANFORGE_NORMALS_OUTPUT_BIN) {
      mkdirSync(resolve(process.env.SCANFORGE_NORMALS_OUTPUT_BIN, ".."), {
        recursive: true,
      });
      writeFileSync(
        process.env.SCANFORGE_NORMALS_OUTPUT_BIN,
        new Uint8Array(result.normals.buffer),
      );
    }
    const dots: number[] = [],
      angles: number[] = [];
    let invalid = 0;
    for (let i = 0; i < p.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      if (!Number.isFinite(len) || len === 0) {
        invalid++;
        continue;
      }
      let dot = 0;
      for (let a = 0; a < 3; a++)
        dot += (result.normals[i + a] * n[i + a]) / len;
      dots.push(dot);
      angles.push(
        (Math.acos(Math.max(-1, Math.min(1, Math.abs(dot)))) * 180) / Math.PI,
      );
    }
    dots.sort((a, b) => a - b);
    angles.sort((a, b) => a - b);
    const receipt = {
      scope:
        "Every original PLY vertex processed without dropping or sampling. Supplied normal anchors determine graph-consistent component signs. Source normals are a scanner reference, not independent physical truth.",
      sourcePath: path,
      sourceSha256: hash(bytes),
      preprocessorSha256: hash(
        readFileSync(resolve("src/point-cloud-normals.ts")),
      ),
      outputNormalsSha256: hash(new Uint8Array(result.normals.buffer)),
      diagnostics: result.diagnostics,
      invalidSourceNormals: invalid,
      elapsedMs: performance.now() - start,
      processArrayBufferBytes: process.memoryUsage().arrayBuffers,
      normalAgreement: {
        validAnchorSamples: dots.length,
        minimumSignedDot: dots[0],
        p05SignedDot: dots[Math.floor(dots.length * 0.05)],
        medianSignedDot: dots[Math.floor(dots.length * 0.5)],
        opposedFraction: dots.filter((v) => v < 0).length / dots.length,
        medianUnsignedAngleDegrees: angles[Math.floor(angles.length * 0.5)],
        p95UnsignedAngleDegrees: angles[Math.floor(angles.length * 0.95)],
      },
      settings: { mode: "estimate-provided", neighbors: 24 },
      limitations: [
        "Local PCA changes valid source normals as well as estimating invalid ones.",
        "The spanning forest aligns nearby tangent estimates; complex touching sheets, outliers and inconsistent source anchors can remain ambiguous.",
        "A completed preprocessing run is not a reconstructed mesh quality certificate.",
      ],
    };
    console.info(JSON.stringify(receipt));
    if (process.env.SCANFORGE_NORMALS_RECEIPT) {
      mkdirSync(resolve(process.env.SCANFORGE_NORMALS_RECEIPT, ".."), {
        recursive: true,
      });
      writeFileSync(
        process.env.SCANFORGE_NORMALS_RECEIPT,
        JSON.stringify(receipt, null, 2) + "\n",
      );
    }
    expect(result.normals.length).toBe(p.length);
    expect(result.normals.every(Number.isFinite)).toBe(true);
    expect(result.diagnostics.orientationAnchors).toBe(dots.length);
    geometry.dispose();
  },
  120000,
);
