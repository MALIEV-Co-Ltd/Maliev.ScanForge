/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parsePlyTopology, expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { combineFiniteSplitParts } from "../src/scan-split-single-candidate";

it.skipIf(!process.env.SCANFORGE_M2_ORIGINAL_PLY)(
  "runs the assembled candidate on one original indexed scan",
  () => {
    const bytes = readFileSync(process.env.SCANFORGE_M2_ORIGINAL_PLY!);
    const source = parsePlyTopology(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const positions = expandPlyTopology(source);
    const bounds = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (let i = 0; i < source.vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        bounds[k] = Math.min(bounds[k], source.vertices[i + k]);
        bounds[k + 3] = Math.max(bounds[k + 3], source.vertices[i + k]);
      }
    const x = (bounds[0] + bounds[3]) / 2,
      margin = Math.max(bounds[4] - bounds[1], bounds[5] - bounds[2], 1);
    const cutter = new Float32Array([
      x,
      bounds[1] - margin,
      bounds[2] - margin,
      x,
      bounds[1] - margin,
      bounds[5] + 3 * margin,
      x,
      bounds[4] + 3 * margin,
      bounds[2] - margin,
    ]);
    const hash = (a: Float32Array | Uint32Array) =>
      createHash("sha256")
        .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
        .digest("hex");
    const before = [
      hash(positions),
      hash(source.vertices),
      hash(source.triangles),
      hash(cutter),
    ];
    const precise = process.env.SCANFORGE_M2_PRECISE_CANDIDATE === "1";
    const result = precise
      ? runFiniteSplitCandidate(positions, cutter, source, {
          preciseCoordinates: true,
          maxTypedBytesPerStage: 1024 * 1024 * 1024,
        })
      : runFiniteSplitCandidate(positions, cutter, source, {
          maxTypedBytesPerStage: 512 * 1024 * 1024,
        });
    expect(result.diagnostics.cutEdges).toBeGreaterThan(0);
    expect(result.diagnostics.sourceIdentity).toBe("retained-indexed");
    for (let i = 0; i < result.segments.length; i++)
      expect(
        indexedMeshMatches(result.segmentIndexedMeshes[i], result.segments[i]),
      ).toBe(true);
    const area = (p: ArrayLike<number>) => {
      let sum = 0;
      for (let i = 0; i < p.length; i += 9) {
        const ax = p[i + 3] - p[i],
          ay = p[i + 4] - p[i + 1],
          az = p[i + 5] - p[i + 2];
        const bx = p[i + 6] - p[i],
          by = p[i + 7] - p[i + 1],
          bz = p[i + 8] - p[i + 2];
        sum +=
          Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) /
          2;
      }
      return sum;
    };
    const base = area(positions),
      output = result.segments.reduce((sum, p) => sum + area(p), 0);
    expect(Math.abs(output - base) / base).toBeLessThan(1e-6);
    const partX = result.segments.map((part) => {
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < part.length; i += 3) {
        min = Math.min(min, part[i]);
        max = Math.max(max, part[i]);
      }
      return { min, max };
    });
    if (precise) {
      expect(partX).toHaveLength(2);
      expect(
        partX.filter((range) => range.max <= cutter[0] + 1e-6),
      ).toHaveLength(1);
      expect(
        partX.filter((range) => range.min >= cutter[0] - 1e-6),
      ).toHaveLength(1);
    }
    if (!precise) {
      const combined = combineFiniteSplitParts(
        result.segments as Float32Array[],
        result.segmentIndexedMeshes as {
          vertices: Float32Array;
          triangles: Uint32Array;
        }[],
        { maxTypedBytes: 512 * 1024 * 1024 },
      );
      expect(indexedMeshMatches(combined.indexedMesh, combined.positions)).toBe(
        true,
      );
      expect(Math.abs(area(combined.positions) - base) / base).toBeLessThan(
        1e-6,
      );
    } else {
      expect(result.segments.every(Array.isArray)).toBe(true);
    }
    expect([
      hash(positions),
      hash(source.vertices),
      hash(source.triangles),
      hash(cutter),
    ]).toEqual(before);
    console.log(
      JSON.stringify({
        inputSha256: createHash("sha256").update(bytes).digest("hex"),
        ...result.diagnostics,
      }),
    );
    if (process.env.SCANFORGE_M2_CANDIDATE_RECEIPT)
      writeFileSync(
        process.env.SCANFORGE_M2_CANDIDATE_RECEIPT,
        JSON.stringify(
          {
            inputSha256: createHash("sha256").update(bytes).digest("hex"),
            sourceHashes: before,
            sourceFaces: source.triangles.length / 3,
            partFaces: result.segmentIndexedMeshes.map(
              (mesh) => mesh.triangles.length / 3,
            ),
            cutterX: cutter[0],
            partX,
            inputArea: base,
            outputArea: output,
            precise,
            diagnostics: result.diagnostics,
          },
          null,
          2,
        ),
      );
  },
  120_000,
);
