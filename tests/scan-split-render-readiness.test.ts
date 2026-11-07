import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { scanDisplayBuffers } from "../src/scan-display-buffers";
import { prepareScanRenderData } from "../src/scan-render-data";
import {
  smoothDisplayNormals,
  smoothIndexedDisplayNormals,
} from "../src/viewport-display";

it("identifies expanded display fallback for an unprepared indexed Split result", () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const target = new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions,
    target,
  });
  const output = result.positions!,
    indexed = result.indexedMesh!;
  const unprepared = scanDisplayBuffers(output, indexed, undefined);
  expect(unprepared.indexed).toBe(false);
  expect(unprepared.positions).toBe(output);
  const prepared = prepareScanRenderData(output, indexed);
  const compact = scanDisplayBuffers(output, indexed, prepared);
  expect(compact.indexed).toBe(true);
  expect(compact.positions).toBe(indexed.vertices);
  expect(compact.index).toBe(indexed.triangles);
  expect(compact.normals).toHaveLength(indexed.vertices.length);
});

it.each([
  {
    name: "non-coplanar neighboring faces",
    positions: new Float32Array([
      0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3,
    ]),
    target: new Float32Array([1, -4, -4, 1, 8, -4, 1, -4, 8]),
  },
  {
    name: "large-coordinate seam",
    positions: new Float32Array([
      100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
    ]),
    target: [100000004, -100, -10, 100000004, 100, -10, 100000004, 0, 100],
  },
])(
  "keeps existing welded display normals on every compact Split corner: $name",
  ({ positions, target }) => {
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      target,
    });
    const expanded = smoothDisplayNormals(result.positions!);
    const indexed = result.indexedMesh!;
    const compact = smoothIndexedDisplayNormals(result.positions!, indexed);
    for (let slot = 0; slot < indexed.triangles.length; slot++)
      for (let axis = 0; axis < 3; axis++)
        expect(compact[indexed.triangles[slot] * 3 + axis]).toBe(
          expanded[slot * 3 + axis],
        );
  },
);
