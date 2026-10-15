import { describe, expect, it } from "vitest";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkPairs,
  landmarkRequest,
  landmarkSceneUnchanged,
  acceptLandmarkAlignment,
  landmarkMarkers,
  editLandmarks,
  landmarkState,
} from "../src/landmark-alignment";
import { registerPairedPoints, applyRigidTransform } from "../src/registration";
import type { Entity, Vec3 } from "../src/types";
import nativePreview from "../docs/evidence/landmark-preview-native.json";
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
  it("rejects preview acceptance after lock or indexed geometry metadata changes", () => {
    const session = previewed();
    expect(() =>
      acceptLandmarkAlignment(session, [{ ...moving, locked: true }, fixed]),
    ).toThrow("changed");
    expect(() =>
      acceptLandmarkAlignment(session, [
        moving,
        {
          ...fixed,
          indexedMesh: { vertices: fixed.positions, triangles: [0, 1, 2] },
        },
      ]),
    ).toThrow("changed");
  });
  it("uses native seeded refinement for indexed source and fixed meshes", () => {
    const session = picked();
    if (!session.fixed)
      throw new Error("The paired fixture requires a fixed target.");
    session.moving = {
      ...session.moving,
      indexedMesh: { vertices: session.moving.positions, triangles: [0, 1, 2] },
    };
    session.fixed = {
      ...session.fixed,
      indexedMesh: { vertices: session.fixed.positions, triangles: [0, 1, 2] },
    };
    expect(landmarkRequest(session)).toMatchObject({
      refinementTargets: [
        {
          positions: session.fixed.positions,
          indexedMesh: session.fixed.indexedMesh,
        },
      ],
      workerCount: 2,
      parallel: true,
    });
    session.fixed = {
      ...session.fixed,
      meshSelection: { hidden: [0], saved: [] },
    };
    expect(() => landmarkRequest(session)).toThrow("Reveal hidden triangles");
  });
  it("matches every original preview point record without compounding transforms", () => {
    for (const capture of nativePreview.cases) {
      if (capture.operation !== "preview") continue;
      const matrix = capture.matrix!;
      const session = previewed();
      session.picks = capture.points!.map((p) => ({
        entityId: p.fixed ? fixed.id : moving.id,
        point: p.original as Vec3,
      }));
      session.preview.registration.transform = {
        rotation: [
          matrix[0],
          matrix[1],
          matrix[2],
          matrix[4],
          matrix[5],
          matrix[6],
          matrix[8],
          matrix[9],
          matrix[10],
        ],
        translation: [matrix[3], matrix[7], matrix[11]],
      };
      expect(landmarkMarkers(session).map((p) => p.point)).toEqual(
        capture.points!.map((p) => p.observed),
      );
      expect(landmarkState(session).preview).toBe(true);
    }
  });
  it("preserves locked preview points until Reset restores editing without changing geometry", () => {
    const session = previewed();
    expect(editLandmarks(session, { action: "remove-last" })).toBe(session);
    expect(editLandmarks(session, { action: "clear" })).toBe(session);
    const reset = editLandmarks(session, { action: "reset" });
    expect(reset.picks).toBe(session.picks);
    expect(reset.moving).toBe(session.moving);
    expect(reset.fixed).toBe(session.fixed);
    expect(reset.preview).toBeUndefined();
    expect(editLandmarks(reset, { action: "remove-last" }).picks).toHaveLength(
      5,
    );
    expect(editLandmarks(reset, { action: "clear" }).picks).toEqual([]);
    expect(
      editLandmarks(reset, {
        action: "pick",
        entityId: moving.id,
        point: [1, 2, 3],
      }).picks,
    ).toHaveLength(7);
    expect(() => editLandmarks(reset, { action: "pick" })).toThrow("entityId");
  });
  it("passes original topology into a picked-point preview and retains its transformed successor on acceptance", () => {
    const session: import("../src/landmark-alignment").LandmarkAlignment =
      previewed();
    const indexedMesh = {
      vertices: new Float32Array(moving.positions),
      triangles: new Uint32Array([0, 1, 2]),
    };
    session.moving = { ...moving, indexedMesh };
    expect(landmarkRequest(session).sourceIndexed).toBe(indexedMesh);
    const successor = {
      vertices: new Float32Array(session.preview!.positions!),
      triangles: indexedMesh.triangles,
    };
    session.preview = { ...session.preview!, indexedMesh: successor };
    const result = acceptLandmarkAlignment(session, [session.moving, fixed]);
    expect(result[0].indexedMesh).toBe(successor);
    expect(result[1]).toBe(fixed);
    expect(session.moving.indexedMesh).toBe(indexedMesh);
  });
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
  it("locks point picking after preview, and changed target geometry invalidates acceptance", () => {
    const session = previewed();
    expect(() => pickLandmark(session, moving.id, [1, 1, 0])).toThrow("Reset");
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
