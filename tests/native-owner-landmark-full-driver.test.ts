import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import capture from "../docs/evidence/owner-landmark-full-driver-native.json";
import { refineNativeLandmarkAfterCoarse } from "../src/native-landmark-refinement";
import { parsePlyTopology } from "../src/ply-topology";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
it.skipIf(!folder).each(capture.cases)(
  "matches complete native owner driver: $sourceFile",
  async (row) => {
    const parse = (name: string) => {
      const raw = readFileSync(join(folder!, name));
      return {
        digest: digest(raw),
        mesh: parsePlyTopology(
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        ),
      };
    };
    const source = parse(row.sourceFile),
      target = parse(capture.targetFile);
    expect(source.digest).toBe(row.sourceSha256);
    expect(target.digest).toBe(capture.targetSha256);
    const surface = prepareNativeAlignmentSurface(
      target.mesh.vertices,
      target.mesh.triangles,
      { minimumExtent: 0.5 },
    )!;
    expect(
      digest(new Uint8Array(surface.surface.normals.buffer)),
      "target normals",
    ).toBe(capture.targetCache.normalSha256);
    expect(digest(surface.surface.neighbors), "target neighbors").toBe(
      capture.targetCache.neighborSha256,
    );
    const result = await refineNativeLandmarkAfterCoarse(
      source.mesh,
      [target.mesh],
      row.coarseMatrix,
      row.seeds,
      { workerCount: 2, parallel: false },
    );
    expect(result.refinement.initialError).toBe(row.initialization.initialBest);
    expect(result.refinement.accepted).toBe(row.accepted);
    expect(result.refinement.best).toBe(row.best);
    expect(result.refinement.parameters).toEqual(row.parameters);
    expect(result.refinement.matrix).toEqual(row.matrix);
    expect(digest(new Uint8Array(result.indexedMesh.vertices.buffer))).toBe(
      row.finalPositionsSha256,
    );
    expect(
      digest(new Uint8Array(result.indexedMesh.geometryNormals.buffer)),
    ).toBe(row.finalNormalsSha256);
  },
  120000,
);
