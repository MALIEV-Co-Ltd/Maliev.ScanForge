import { expect, it } from "vitest";
import capture from "../docs/evidence/landmark-original-solid-provider-native.json";
import { prepareNativeLandmarkTarget } from "../src/native-landmark-target";

function floats(hex: string) {
  const buffer = Buffer.from(hex, "hex");
  return Float32Array.from({ length: buffer.length / 4 }, (_, index) =>
    buffer.readFloatLE(index * 4),
  );
}
const bits = (values: Float32Array) =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString(
    "hex",
  );

it.each(capture.cases)(
  "matches complete native $kind provider with $logicalLanes lanes at $tolerance mm",
  (row) => {
    for (const repeat of row.repeats) {
      const targets = repeat.parts.map((part) => ({
        vertices: floats(part.positionBits),
        triangles: Uint32Array.from(part.triangleIds),
        normals: floats(part.normalBits),
      }));
      const before = targets.map((target) => bits(target.normals));
      const output = prepareNativeLandmarkTarget(targets);
      expect(bits(output.vertices)).toBe(repeat.merged.positionBits);
      expect(bits(output.normals)).toBe(repeat.merged.normalBits);
      expect(Array.from(output.triangles)).toEqual(repeat.merged.triangleIds);
      expect(targets.map((target) => bits(target.normals))).toEqual(before);
      expect(repeat.merged.faceIds).toEqual(
        repeat.parts.flatMap((part, index) =>
          Array.from({ length: part.triangles }, () => index),
        ),
      );
    }
    expect(row.repeats[0]).toEqual(row.repeats[1]);
    expect(row.notifications).toEqual(
      row.repeats.map((repeat) => repeat.merged),
    );
  },
);

it("native multicore scheduling preserves complete ordered provider output", () => {
  const serial = capture.cases.filter((row) => row.logicalLanes === 1);
  const parallel = capture.cases.filter((row) => row.logicalLanes === 2);
  expect(serial).toHaveLength(6);
  expect(parallel).toHaveLength(6);
  for (const [index, row] of serial.entries()) {
    expect(parallel[index].kind).toBe(row.kind);
    expect(parallel[index].tolerance).toBe(row.tolerance);
    expect(parallel[index].repeats).toEqual(row.repeats);
    expect(row.allocationThreadIds).toHaveLength(1);
    expect(parallel[index].allocationThreadIds.length).toBeGreaterThan(1);
  }
  expect(capture.provenance.remainingTrackedAllocations).toBe(0);
  expect(capture.provenance.unknownFreeCalls).toBe(0);
});
