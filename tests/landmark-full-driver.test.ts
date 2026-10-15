import { expect, it } from "vitest";
import capture from "../docs/evidence/landmark-full-driver-native.json";
import {
  nativeRefineAlignmentMeshes,
  nativeRefineAlignmentMeshesAsync,
} from "../src/scan-native-alignment-surface-controller";
const floats = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
};
it.each(capture.cases)(
  "matches complete original selected refinement driver with $logicalLanes lanes",
  async (sample) => {
    const source = {
      vertices: floats(sample.source.positionBits),
      triangles: sample.source.triangleIds,
      normals: floats(sample.source.normalBits),
      flags: new Uint8Array(sample.source.vertices).fill(4),
    };
    const target = {
      vertices: floats(sample.target.positionBits),
      triangles: sample.target.triangleIds,
      normals: floats(sample.target.normalBits),
    };
    const options = {
      selectionOnly: true,
      initialRadius: 3,
      minimumExtent: 0.5,
      workerCount: sample.logicalLanes,
    };
    const serial = nativeRefineAlignmentMeshes(
      [source],
      target,
      0x7fffffff,
      options,
    );
    expect(serial.accepted).toBe(sample.accepted);
    expect(serial.best).toBe(sample.best);
    expect(serial.parameters).toEqual(sample.parameters);
    expect(serial.matrix).toEqual(sample.matrix);
    const parallel = await nativeRefineAlignmentMeshesAsync(
      [source],
      target,
      0x7fffffff,
      options,
    );
    expect(parallel.accepted).toBe(sample.accepted);
    expect(parallel.best).toBe(sample.best);
    expect(parallel.parameters).toEqual(sample.parameters);
    expect(parallel.matrix).toEqual(sample.matrix);
  },
);
