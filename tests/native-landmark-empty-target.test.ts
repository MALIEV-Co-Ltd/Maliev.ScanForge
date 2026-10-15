import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeRefineAlignmentMeshes,
  nativeRefineAlignmentMeshesAsync,
} from "../src/scan-native-alignment-surface-controller";
import { refineNativeLandmarkAfterCoarse } from "../src/native-landmark-refinement";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkRequest,
  prepareLandmarkRequest,
} from "../src/landmark-alignment";
import { nativeSurfaceRefinementRequest } from "../src/native-surface-refinement";
import { expandPlyTopology } from "../src/ply-topology";
import type { Entity, Vec3 } from "../src/types";
interface NativeCase {
  logicalLanes: number;
  selectedFlag: number;
  source: {
    vertices: number;
    positionBits: string;
    normalBits: string;
    triangleIds: number[];
  };
  accepted: boolean;
  best: number;
  parameters: number[];
  matrix: number[];
}
const capture = JSON.parse(
  readFileSync(
    new URL(
      "../docs/evidence/landmark-empty-target-driver-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: NativeCase[] };
const floats = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
it.each(capture.cases)(
  "matches original empty-target driver with $logicalLanes lanes and source flag $selectedFlag",
  async (row) => {
    const source = {
      vertices: floats(row.source.positionBits),
      triangles: row.source.triangleIds,
      normals: floats(row.source.normalBits),
      flags: new Uint8Array(row.source.vertices).fill(row.selectedFlag),
    };
    const options = {
      selectionOnly: true,
      workerCount: row.logicalLanes,
      initialRadius: 3,
      minimumExtent: 0.5,
    };
    for (const result of [
      nativeRefineAlignmentMeshes([source], [], 0x7fffffff, options),
      await nativeRefineAlignmentMeshesAsync([source], [], 0x7fffffff, options),
    ]) {
      expect(result.accepted).toBe(row.accepted);
      expect(result.best).toBe(row.best);
      expect(result.parameters).toEqual(row.parameters);
      expect(result.matrix).toEqual(row.matrix);
      expect(result.flags.flat().every((flag) => flag === 0)).toBe(true);
    }
  },
);
const indexed = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  triangles: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};
const moving: Entity = {
  id: "moving",
  name: "Moving scan",
  kind: "mesh",
  positions: expandPlyTopology(indexed),
  indexedMesh: indexed,
  color: "#aaa",
  visible: true,
  opacity: 1,
};
const fixed: Entity = {
  id: "fixed",
  name: "Fixed cloud",
  kind: "pointcloud",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#aaa",
  visible: true,
  opacity: 1,
};
it("retains native grown faces when no eligible surface remains", async () => {
  const result = await refineNativeLandmarkAfterCoarse(
    indexed,
    [],
    identity,
    [0],
    { workerCount: 2, parallel: true },
  );
  expect(result.refinement.accepted).toBe(true);
  expect(result.refinement.matrix).toEqual(identity);
  expect(result.selection).toEqual(new Uint8Array([1, 1, 1, 1]));
  expect(result.indexedMesh.vertices).toEqual(indexed.vertices);
  expect(result.diagnostics).toMatchObject({
    refinementApplied: false,
    selectedTriangles: 4,
    logicalLanes: 2,
    physicalWorkers: 1,
    fallbackReason: "no refinement surfaces",
  });
});
it("preserves the explicit empty target list through GUI/MCP session preparation", async () => {
  let session = beginLandmarkAlignment(moving, fixed, {
    scene: [moving, fixed],
  });
  for (const point of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ] as Vec3[]) {
    session = pickLandmark(session, moving.id, point);
    session = pickLandmark(session, fixed.id, point);
  }
  const acquire = vi.fn();
  expect(landmarkRequest(session).refinementTargets).toEqual([]);
  expect(
    (await prepareLandmarkRequest(session, acquire)).refinementTargets,
  ).toEqual([]);
  expect(acquire).not.toHaveBeenCalled();
  expect(() => nativeSurfaceRefinementRequest(moving, [], 1, 3)).toThrow(
    "distinct fixed targets",
  );
});
it("still rejects hidden source facets without fixed surfaces", () => {
  const hidden = { ...moving, meshSelection: { hidden: [0], saved: [] } };
  let session = beginLandmarkAlignment(hidden, fixed, {
    scene: [hidden, fixed],
  });
  for (const point of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ] as Vec3[]) {
    session = pickLandmark(session, hidden.id, point);
    session = pickLandmark(session, fixed.id, point);
  }
  expect(() => landmarkRequest(session)).toThrow("Reveal hidden triangles");
});
