import { expect, it } from "vitest";
import { editPointCloud } from "../src/point-cloud-processing";

it("preserves the exact selected points' RGBA when extracting", () => {
  const result = editPointCloud({
    kind: "pointCloudEdit",
    action: "extract",
    positions: new Float32Array([1, 2, 3, 4, 5, 6]),
    pointColors: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
    selection: new Uint8Array([0, 1]),
  });
  expect(result.positions).toEqual(new Float32Array([4, 5, 6]));
  expect(result.pointColors).toEqual(new Uint8Array([4, 5, 6, 255]));
});
