import { describe, expect, it } from "vitest";
import {
  beginLandmarkAlignment,
  editLandmarks,
  landmarkState,
} from "../src/landmark-alignment";
import type { Entity, Vec3 } from "../src/types";
import native from "../docs/evidence/landmark-picking-native.json";

const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "pointcloud",
  positions: [0, 0, 0],
  color: "#aaa",
  opacity: 1,
  visible: true,
};
const fixed: Entity = { ...moving, id: "fixed", name: "Fixed" };
function doubleBits(point: readonly number[]) {
  const data = new DataView(new ArrayBuffer(24));
  point.forEach((value, index) => data.setFloat64(index * 8, value, true));
  return Array.from(new Uint8Array(data.buffer), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

describe("native picked-point storage", () => {
  for (const [index, capture] of native.cases.entries()) {
    if (!capture.appended) continue;
    it(`matches original point bytes and side for capture ${index}`, () => {
      const before = beginLandmarkAlignment(moving, fixed);
      const point = capture.input.xyz as Vec3;
      const original = [...point];
      const id = capture.fixedSide ? fixed.id : moving.id;
      const after = editLandmarks(before, {
        action: "pick",
        entityId: id,
        point,
      });
      expect(after.picks).toHaveLength(1);
      expect(doubleBits(after.picks[0].point)).toBe(capture.pointDoubleBits);
      expect(after.picks[0].entityId === fixed.id).toBe(!!capture.fixedSide);
      const state = landmarkState(after);
      expect("picks" in state && state.picks[0].point).toEqual(
        after.picks[0].point,
      );
      expect(before.picks).toEqual([]);
      expect(point).toEqual(original);
    });
  }
  it("rejects finite doubles that overflow native Float32 point storage", () => {
    const before = beginLandmarkAlignment(moving, fixed);
    expect(() =>
      editLandmarks(before, {
        action: "pick",
        entityId: moving.id,
        point: [Number.MAX_VALUE, 0, 0],
      }),
    ).toThrow(/range/i);
    expect(before.picks).toEqual([]);
  });
});
