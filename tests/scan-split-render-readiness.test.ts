import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { scanDisplayBuffers } from "../src/scan-display-buffers";
import { prepareScanRenderData } from "../src/scan-render-data";

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
