import { expect, it } from "vitest";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkPairs,
  landmarkState,
  landmarkSceneUnchanged,
  landmarkTargetEntities,
  editLandmarks,
} from "../src/landmark-alignment";
import type { Entity } from "../src/types";
const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  color: "#aaa",
  opacity: 1,
};
const a: Entity = { ...moving, id: "a" };
const b: Entity = { ...moving, id: "b" };
it("opens with only a moving scan, as native command admission permits", () => {
  const session = beginLandmarkAlignment(moving);
  expect(session.fixed).toBeUndefined();
  expect(landmarkState(session)).toMatchObject({ active: true, fixedId: null });
  expect(landmarkTargetEntities(session)).toEqual([]);
  expect(landmarkSceneUnchanged(session, [moving])).toBe(true);
});
it("classifies every admitted nonmoving reference as a fixed point", () => {
  let session = beginLandmarkAlignment(moving, undefined, {
    scene: [moving, a, b],
  });
  session = pickLandmark(session, a.id, [1, 2, 3]);
  session = pickLandmark(session, moving.id, [4, 5, 6]);
  session = pickLandmark(session, b.id, [7, 8, 9]);
  expect(landmarkPairs(session)).toEqual({
    moving: [[4, 5, 6]],
    fixed: [
      [1, 2, 3],
      [7, 8, 9],
    ],
  });
  expect(landmarkSceneUnchanged(session, [moving, a, b])).toBe(true);
  expect(
    landmarkSceneUnchanged(session, [
      moving,
      a,
      { ...b, positions: [1, 2, 3] },
    ]),
  ).toBe(false);
});
it("keeps hidden and unrelated objects outside the reference set", () => {
  const session = beginLandmarkAlignment(moving, undefined, {
    scene: [moving, { ...a, visible: false }],
  });
  expect(() => pickLandmark(session, a.id, [0, 0, 0])).toThrow();
  expect(() => pickLandmark(session, b.id, [0, 0, 0])).toThrow();
});
it("requires a bound reference for fixed-only refinement", () => {
  expect(() =>
    beginLandmarkAlignment(moving, undefined, { targetScope: "fixed" }),
  ).toThrow(/fixed/i);
});
it("shares reference filter changes and clearing without retaining stale picks", () => {
  let session = beginLandmarkAlignment(moving, a, {
    scene: [moving, a, b],
    targetScope: "fixed",
  });
  session = pickLandmark(session, moving.id, [0, 0, 0]);
  session = editLandmarks(session, { action: "reference-target" });
  expect(session.fixed).toBeUndefined();
  expect(session.targetScope).toBe("visibleScene");
  expect(session.picks).toEqual([]);
  session = editLandmarks(session, {
    action: "reference-target",
    fixedId: b.id,
  });
  expect(session.fixed).toBe(b);
});

it("keeps isolated reference markers consistent with the displayed object and rejects foreign bound picks", () => {
  let unbound = beginLandmarkAlignment(moving, undefined, {
    scene: [moving, a, b],
  });
  unbound = pickLandmark(unbound, b.id, [2, 3, 4]);
  unbound = pickLandmark(unbound, a.id, [1, 2, 3]);
  expect(landmarkState(unbound)).toMatchObject({
    views: {
      fixed: { entityIds: ["a"], markers: [{ label: "F2", point: [1, 2, 3] }] },
    },
  });
  const bound = beginLandmarkAlignment(moving, a, { scene: [moving, a, b] });
  expect(() => pickLandmark(bound, b.id, [0, 0, 0])).toThrow(/fixed/i);
});
