import { describe, expect, it } from "vitest";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkPairs,
  landmarkRequest,
  landmarkSceneUnchanged,
  acceptLandmarkAlignment,
  landmarkMarkers,
} from "../src/landmark-alignment";
import { registerPairedPoints, applyRigidTransform } from "../src/registration";
import type { Entity, Vec3 } from "../src/types";
const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "mesh",
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
  color: "#aaa",
  opacity: 0.6,
  visible: true,
  meshSelection: {
    hidden: [],
    saved: [{ id: "saved", name: "Region", triangles: [0] }],
  },
};
const fixed: Entity = {
  ...moving,
  id: "fixed",
  name: "Fixed",
  positions: [5, -2, 3, 15, -2, 3, 5, 8, 3],
};
function picked() {
  let session = beginLandmarkAlignment(moving, fixed);
  for (let i = 0; i < 3; i++) {
    session = pickLandmark(
      session,
      fixed.id,
      fixed.positions.slice(i * 3, i * 3 + 3) as Vec3,
    );
    session = pickLandmark(
      session,
      moving.id,
      moving.positions.slice(i * 3, i * 3 + 3) as Vec3,
    );
  }
  return session;
}
function previewed() {
  const session = picked(),
    request = landmarkRequest(session);
  const registration = registerPairedPoints(
    request.sourceLandmarks,
    request.targetLandmarks,
  );
  return {
    ...session,
    preview: {
      kind: "paired" as const,
      registration,
      positions: applyRigidTransform(request.positions, registration.transform),
      diagnostics: {},
    },
  };
}
describe("landmark alignment session", () => {
  it("keeps per-object order when picks are interleaved and labels corresponding pairs", () => {
    const session = picked(),
      request = landmarkRequest(session);
    expect(request.sourceLandmarks).toEqual(moving.positions);
    expect(request.targetLandmarks).toEqual(fixed.positions);
    expect(landmarkMarkers(session).map((m) => m.label)).toEqual([
      "F1",
      "M1",
      "F2",
      "M2",
      "F3",
      "M3",
    ]);
    expect(landmarkPairs(session).moving).toHaveLength(3);
  });
  it("previews without changing source or target and accepts only the moving scan", () => {
    const session = previewed();
    expect(moving.positions[0]).toBe(0);
    const accepted = acceptLandmarkAlignment(session, [moving, fixed]);
    expect(accepted[1]).toBe(fixed);
    expect(accepted[0].positions).toEqual(session.preview.positions);
    expect(accepted[0].meshSelection).toBe(moving.meshSelection);
    expect(accepted[0].color).toBe(moving.color);
    expect(accepted[0].opacity).toBe(0.6);
    expect(landmarkMarkers(session)[1].point[0]).toBeCloseTo(5, 8);
    expect(moving.positions[0]).toBe(0);
  });
  it("new picks discard a preview, and changed target geometry invalidates acceptance", () => {
    const session = previewed();
    const changed = pickLandmark(session, moving.id, [1, 1, 0]);
    expect(changed.preview).toBeUndefined();
    expect(() => landmarkRequest(changed)).toThrow("corresponding");
    const scene = [moving, { ...fixed, positions: [...fixed.positions] }];
    expect(landmarkSceneUnchanged(session, scene)).toBe(false);
    expect(() => acceptLandmarkAlignment(session, scene)).toThrow(
      "Preview alignment again",
    );
  });
  it("rejects insufficient, degenerate, unrelated or nonfinite landmarks", () => {
    expect(() =>
      landmarkRequest(beginLandmarkAlignment(moving, fixed)),
    ).toThrow("at least three");
    expect(() => pickLandmark(picked(), "other", [0, 0, 0])).toThrow(
      "moving scan",
    );
    expect(() => pickLandmark(picked(), moving.id, [NaN, 0, 0])).toThrow(
      "finite",
    );
    expect(() =>
      beginLandmarkAlignment({ ...moving, kind: "cad" }, fixed),
    ).toThrow("moving scan");
    let session = beginLandmarkAlignment(moving, fixed);
    for (let i = 0; i < 3; i++) {
      session = pickLandmark(session, moving.id, [i, 0, 0]);
      session = pickLandmark(session, fixed.id, [i + 5, 0, 0]);
    }
    const request = landmarkRequest(session);
    expect(() =>
      registerPairedPoints(request.sourceLandmarks, request.targetLandmarks),
    ).toThrow();
  });
});
