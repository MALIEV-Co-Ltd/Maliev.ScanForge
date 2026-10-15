import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import capture from "../docs/evidence/owner-landmark-preparation-native.json";
import controllers from "../docs/evidence/owner-landmark-controller-native.json";
import { refineNativeLandmarkAfterCoarse } from "../src/native-landmark-refinement";
import { parsePlyTopology } from "../src/ply-topology";
import { prepareNativeLandmarkRegion } from "../src/native-landmark-region";
import {
  nativeAlignmentLandmarkCandidate,
  nativeAlignmentOriginalVertexIndices,
} from "../src/scan-native-alignment-landmarks";
import type { Vec3 } from "../src/types";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
it.skipIf(!folder).each(controllers.cases[0].registrations)(
  "matches original full owner coarse/refinement buffers: $sourceFile",
  async (row) => {
    const targetRecord = controllers.cases[0];
    const sourceBytes = readFileSync(join(folder!, row.sourceFile));
    const targetBytes = readFileSync(join(folder!, targetRecord.targetFile));
    expect(digest(sourceBytes)).toBe(row.sourceSha256);
    expect(digest(targetBytes)).toBe(targetRecord.targetSha256);
    const parse = (bytes: Buffer<ArrayBuffer>) =>
      parsePlyTopology(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
    const result = await refineNativeLandmarkAfterCoarse(
      parse(sourceBytes),
      [parse(targetBytes)],
      row.coarseMatrix,
      row.seeds,
      { workerCount: 2, parallel: false },
    );
    expect(result.refinement.parameters).toEqual(row.parameters);
    expect(result.refinement.matrix).toEqual(row.matrix);
    expect(result.refinement.initialError).toBe(row.initialError);
    expect(result.refinement.best).toBe(row.best);
    expect(result.diagnostics.refinementApplied).toBe(row.refinementApplied);
    expect(digest(new Uint8Array(result.indexedMesh.vertices.buffer))).toBe(
      row.finalPositionsSha256,
    );
    expect(digest(new Uint8Array(result.indexedMesh.normals.buffer))).toBe(
      row.finalNormalsSha256,
    );
    expect(result.selection.some(Boolean)).toBe(false);
  },
  120000,
);
it.skipIf(!folder).each(capture.cases)(
  "matches native coarse registration and full owner region: $file",
  (row) => {
    const raw = readFileSync(join(folder!, row.file));
    expect(digest(raw)).toBe(row.sha256);
    const source = parsePlyTopology(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );
    expect(source.vertices.length).toBe(row.vertices * 3);
    expect(source.triangles.length).toBe(row.triangles * 3);
    const landmarks = [
      ...row.movingLandmarks.map((point) => ({
        point: point as Vec3,
        fixed: false,
      })),
      ...row.fixedLandmarks.map((point) => ({
        point: point as Vec3,
        fixed: true,
      })),
    ];
    expect(
      Array.from(
        nativeAlignmentOriginalVertexIndices(source.vertices, landmarks),
      ),
    ).toEqual(row.seeds);
    const matrix = nativeAlignmentLandmarkCandidate(landmarks)!;
    expect(matrix).toEqual(row.coarseMatrix);
    expect(Buffer.from(Float64Array.from(matrix).buffer).toString("hex")).toBe(
      row.coarseMatrixBits,
    );
    const region = prepareNativeLandmarkRegion(
      row.vertices,
      source.triangles,
      row.seeds,
    );
    expect(region.passes).toBe(row.passes);
    expect(region.count).toBe(row.selectedFaces);
    expect(
      region.vertices.reduce((sum, flag) => sum + Number(!!(flag & 4)), 0),
    ).toBe(row.selectedVertices);
    expect(digest(new Uint8Array(region.vertices.buffer))).toBe(
      row.vertexFlagsSha256,
    );
    expect(digest(region.faceFlags)).toBe(row.faceFlagsSha256);
  },
  120000,
);
