import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import fixture from "./fixtures/global-fine-apply-stages-native.json";
import { parsePlyTopology } from "../src/ply-topology";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
import { composeCloudPose } from "../src/point-cloud-placement";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const hash = (v: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(v.buffer, v.byteOffset, v.byteLength))
    .digest("hex");
const doubles = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8));
};
it.skipIf(!directory)(
  "matches complete owner mesh streams at both native setter stages and cloud world bounds",
  async () => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Complete apply replay requires 3072 MiB free; do not lower admission.",
      );
    const executor = createDatumTransformExecutor({ parallel: false }),
      report = [];
    try {
      for (let source = 0; source < fixture.sources.length; source++) {
        const info = fixture.sources[source],
          raw = readFileSync(directory + "/" + info.name);
        expect(hash(raw)).toBe(info.fileSha256);
        const mesh = parsePlyTopology(
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        );
        expect(hash(mesh.vertices)).toBe(info.pointsSha256);
        expect(hash(mesh.normals!)).toBe(info.normalsSha256);
        const faceNormals = new Float32Array(mesh.triangles.length);
        for (let i = 0; i < mesh.triangles.length; i += 3)
          for (let axis = 0; axis < 3; axis++)
            faceNormals[i + axis] = mesh.normals![mesh.triangles[i] * 3 + axis];
        for (const c of fixture.meshCases.filter((c) => c.source === source)) {
          const start = performance.now();
          expect(hash(faceNormals)).toBe(c.sourceFaceNormalsSha256);
          let positions: Float32Array = mesh.vertices,
            normals: Float32Array = mesh.normals!,
            faces: Float32Array = faceNormals;
          const matrices = c.matrices.map(doubles);
          for (let stage = 0; stage < matrices.length; stage++) {
            positions = transformDatumCoordinates(positions, matrices[stage]);
            normals = transformDatumCoordinates(normals, matrices[stage], true);
            faces = transformDatumCoordinates(faces, matrices[stage], true);
            expect(hash(positions)).toBe(c.stages[stage].positionsSha256);
            expect(hash(normals)).toBe(c.stages[stage].normalsSha256);
            expect(hash(faces)).toBe(c.stages[stage].faceNormalsSha256);
          }
          expect(
            hash(
              (await executor.transformStages(mesh.vertices, matrices)).output,
            ),
          ).toBe(c.stages[1].positionsSha256);
          expect(
            hash(
              (await executor.transformStages(mesh.normals!, matrices, true))
                .output,
            ),
          ).toBe(c.stages[1].normalsSha256);
          expect(
            hash(
              (await executor.transformStages(faceNormals, matrices, true))
                .output,
            ),
          ).toBe(c.stages[1].faceNormalsSha256);
          const cloud = fixture.cloudCases.find(
            (value) =>
              value.source === source &&
              value.name === info.name + "-" + c.mode,
          )!;
          let pose = doubles(cloud.initialBits);
          for (const matrix of matrices) pose = composeCloudPose(matrix, pose);
          const bounds = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
          };
          transformDatumCoordinates(mesh.vertices, pose, false, bounds);
          expect(
            Buffer.from(
              Float32Array.from([...bounds.min, ...bounds.max]).buffer,
            ).toString("hex"),
          ).toBe(cloud.worldBoundsBits);
          expect(hash(mesh.vertices)).toBe(info.pointsSha256);
          expect(hash(mesh.normals!)).toBe(info.normalsSha256);
          report.push({
            name: info.name,
            mode: c.mode,
            elapsedMs: performance.now() - start,
            allStagesMatched: true,
            authoredBuffersIntact: true,
          });
        }
      }
      writeFileSync(
        ".resources/global-fine-apply-stages-owner-replay.json",
        JSON.stringify(report, null, 2),
      );
    } finally {
      executor.close();
    }
  },
  120000,
);
