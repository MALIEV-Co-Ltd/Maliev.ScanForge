import { expect, it, vi } from "vitest";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkState,
  prepareLandmarkRequest,
  editLandmarks,
} from "../src/landmark-alignment";
import type { Entity } from "../src/types";
import type { ProcessingResult } from "../src/processing-client";
const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "mesh",
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
  visible: true,
  color: "#aaa",
  opacity: 1,
};
const fixed: Entity = { ...moving, id: "fixed" };
function picked(count = 3) {
  let session = beginLandmarkAlignment(moving, fixed);
  for (let i = 0; i < count; i++) {
    session = pickLandmark(session, moving.id, [i * 10, i % 2, 0]);
    session = pickLandmark(session, fixed.id, [i * 10, i % 2, 0]);
  }
  return session;
}
const preview: ProcessingResult = {
  kind: "paired",
  diagnostics: {},
  positions: new Float32Array(moving.positions),
  registration: {
    transform: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    rms: 0,
    maxError: 0,
    pairs: 3,
    iterations: 1,
    converged: true,
  },
};
it("keeps a preview editable and invalidates it when a fourth pair is added", () => {
  const session = { ...picked(), preview };
  expect(landmarkState(session)).toMatchObject({
    canPreview: true,
    canRemove: true,
    candidateCount: 1,
  });
  const extra = pickLandmark(session, moving.id, [2, 3, 0]);
  expect(extra.preview).toBeUndefined();
  expect(landmarkState(extra)).toMatchObject({
    canPreview: false,
    preview: false,
  });
  const complete = pickLandmark(extra, fixed.id, [2, 3, 0]);
  expect(landmarkState(complete)).toMatchObject({
    canPreview: true,
    pairCount: 4,
  });
  expect(editLandmarks(session, { action: "remove-last" }).picks).toHaveLength(
    5,
  );
  expect(editLandmarks(session, { action: "clear" }).picks).toHaveLength(0);
});
it("supports repeated preview without an explicit reset", async () => {
  const acquire = vi.fn();
  await expect(
    prepareLandmarkRequest({ ...picked(), preview }, acquire),
  ).resolves.toMatchObject({ kind: "paired" });
  expect(acquire).not.toHaveBeenCalled();
});
it("does not cap the number of matched points", () => {
  expect(landmarkState(picked(128))).toMatchObject({
    pairCount: 128,
    canPreview: true,
  });
});
it("keeps preview unavailable for incomplete point groups", () => {
  expect(landmarkState(picked(2))).toMatchObject({
    canPreview: false,
    canReset: false,
    canRemove: true,
    candidateCount: 0,
  });
});

it("allows reset and continued editing while the automatic preview is pending", () => {
  const pending = { ...picked(), previewStatus: "pending" as const };
  expect(landmarkState(pending)).toMatchObject({
    canPreview: false,
    canReset: true,
    canRemove: true,
  });
  expect(editLandmarks(pending, { action: "reset" })).toMatchObject({
    previewStatus: "idle",
    picks: pending.picks,
  });
});

it("clamps shared GUI/MCP layout changes without invalidating picks or pending previews", () => {
  const pending = { ...picked(), previewStatus: "pending" as const };
  const wider = editLandmarks(pending, {
    action: "view-layout",
    referenceWidthPercent: 90,
  });
  expect(landmarkState(wider)).toMatchObject({
    previewStatus: "pending",
    layout: { referenceWidthPercent: 50, minPercent: 20, maxPercent: 50 },
  });
  expect(wider.picks).toBe(pending.picks);
  expect(
    editLandmarks(wider, { action: "view-layout", referenceWidthPercent: 5 })
      .referenceWidthPercent,
  ).toBe(20);
  expect(() =>
    editLandmarks(pending, {
      action: "view-layout",
      referenceWidthPercent: NaN,
    }),
  ).toThrow(/finite/i);
  expect(() => editLandmarks(pending, { action: "view-layout" })).toThrow(
    /finite/i,
  );
  expect(landmarkState(picked())).toMatchObject({
    layout: { referenceWidthPercent: 32 },
  });
});

it("removes a specific landmark or clears one canvas without affecting the other", () => {
  const session = { ...picked(4), preview };
  const removed = editLandmarks(session, {
    action: "remove-point",
    entityId: "fixed",
    pointIndex: 1,
  });
  expect(removed.picks.filter((pick) => pick.entityId === "fixed")).toEqual(
    session.picks
      .filter((pick) => pick.entityId === "fixed")
      .filter((_pick, index) => index !== 1),
  );
  expect(removed.picks.filter((pick) => pick.entityId === "moving")).toEqual(
    session.picks.filter((pick) => pick.entityId === "moving"),
  );
  expect(removed.preview).toBeUndefined();
  expect(
    editLandmarks(session, {
      action: "remove-last",
      entityId: "moving",
    }).picks.filter((pick) => pick.entityId === "fixed"),
  ).toHaveLength(4);
  expect(
    editLandmarks(session, { action: "clear", entityId: "moving" }).picks.map(
      (pick) => pick.entityId,
    ),
  ).toEqual(["fixed", "fixed", "fixed", "fixed"]);
  expect(() =>
    editLandmarks(session, {
      action: "remove-point",
      entityId: "fixed",
      pointIndex: 9,
    }),
  ).toThrow(/index/i);
  expect(() =>
    editLandmarks(session, {
      action: "remove-point",
      entityId: "fixed",
      pointIndex: -1,
    }),
  ).toThrow(/index/i);
  expect(() =>
    editLandmarks(session, { action: "remove-point", pointIndex: 0 }),
  ).toThrow(/entityId/i);
});
