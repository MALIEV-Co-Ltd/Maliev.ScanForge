/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parsePlyTopology, expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { runScanEdit } from "../src/scan-edit";

it.skipIf(!process.env.SCANFORGE_M2_ORIGINAL_PLY)(
  "preserves one original scan as a single indexed cut mesh",
  () => {
    const bytes = readFileSync(process.env.SCANFORGE_M2_ORIGINAL_PLY!);
    const source = parsePlyTopology(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const positions = expandPlyTopology(source);
    const hash = (values: Float32Array | Uint32Array) =>
      createHash("sha256")
        .update(
          Buffer.from(values.buffer, values.byteOffset, values.byteLength),
        )
        .digest("hex");
    const before = [
      hash(positions),
      hash(source.vertices),
      hash(source.triangles),
    ];
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
    const x = (bounds[0] + bounds[3]) / 2;
    const margin = Math.max(bounds[4] - bounds[1], bounds[5] - bounds[2], 1);
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
    const useShared = process.env.SCANFORGE_M2_SHARED_SPLIT === "1";
    const result = useShared
      ? (() => {
          const edit = runScanEdit({
            kind: "scanEdit",
            action: "split",
            positions,
            target: cutter,
            sourceIndexed: source,
          });
          expect(edit.positions).toBeDefined();
          expect(edit.indexedMesh).toBeDefined();
          return {
            mesh: {
              positions: edit.positions!,
              indexedMesh: edit.indexedMesh!,
            },
            diagnostics: edit.diagnostics as {
              cutEdges: number;
              parts: number;
            },
          };
        })()
      : runFiniteSplitCandidate(positions, cutter, source, {
          preciseCoordinates: true,
          outputMode: "single-mesh",
          maxTypedBytesPerStage: 1024 * 1024 * 1024,
        });
    expect(result.diagnostics.cutEdges).toBeGreaterThan(0);
    expect(result.diagnostics.parts).toBeGreaterThan(1);
    expect(
      indexedMeshMatches(result.mesh.indexedMesh, result.mesh.positions),
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
    const inputArea = area(positions),
      outputArea = area(result.mesh.positions);
    expect(Math.abs(outputArea - inputArea) / inputArea).toBeLessThan(1e-6);
    expect([
      hash(positions),
      hash(source.vertices),
      hash(source.triangles),
    ]).toEqual(before);
    if (process.env.SCANFORGE_M2_CANDIDATE_RECEIPT)
      writeFileSync(
        process.env.SCANFORGE_M2_CANDIDATE_RECEIPT,
        JSON.stringify(
          {
            inputSha256: createHash("sha256").update(bytes).digest("hex"),
            sourceHashes: before,
            inputArea,
            outputArea,
            faces: result.mesh.indexedMesh.triangles.length / 3,
            route: useShared ? "shared scanEdit" : "finite candidate",
            diagnostics: result.diagnostics,
          },
          null,
          2,
        ),
      );
  },
  300_000,
);
