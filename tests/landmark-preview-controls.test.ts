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
import native from "../docs/evidence/landmark-preview-controls-native.json";
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
it("matches original single-result controls and unlocks preview on reset", () => {
  for (const sample of native.cases.filter(
    (s) =>
      s.source &&
      s.moving === s.fixed &&
      s.moving >= 3 &&
      s.initialCount < 2 &&
      s.builderCount === 1,
  )) {
    const session = { ...picked(sample.moving), preview };
    const state = landmarkState(session);
    const enabled = Object.fromEntries(
      sample.events
        .filter((event) => event[0] === "enable")
        .map((event) => [event[1], !!event[2]]),
    );
    expect(state).toMatchObject({
      canPreview: enabled[0x452],
      canReset: enabled[0x1163],
      canRemove: enabled[0x1164],
      candidateCount: 1,
      candidateIndex: 0,
    });
    expect(
      landmarkState(editLandmarks(session, { action: "reset" })),
    ).toMatchObject({
      canPreview: true,
      canReset: false,
      canRemove: true,
      candidateCount: 0,
    });
  }
});
it("rejects a repeat preview before resolving CAD or allocating workers", async () => {
  const acquire = vi.fn();
  await expect(
    prepareLandmarkRequest({ ...picked(), preview }, acquire),
  ).rejects.toThrow(/reset/i);
  expect(acquire).not.toHaveBeenCalled();
});
it("keeps preview unavailable for incomplete point groups", () => {
  expect(landmarkState(picked(2))).toMatchObject({
    canPreview: false,
    canReset: false,
    canRemove: true,
    candidateCount: 0,
  });
});
