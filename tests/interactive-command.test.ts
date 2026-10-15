import { expect, it } from "vitest";
import type { Entity } from "../src/types";
import {
  interactiveAlignmentTargetError,
  InteractiveAlignmentSession,
} from "../src/interactive-alignment-session";
import { getRibbonToolMetadata } from "../src/ui/ribbon-model";
import { ribbonVerification } from "../src/ui/ribbon-verification";
const mesh: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  color: "#aaa",
  opacity: 1,
  visible: true,
};
it("uses shared Interactive target admission for meshes and clouds while rejecting unavailable or exact-CAD targets", () => {
  const cloud = {
    ...mesh,
    id: "cloud",
    kind: "pointcloud" as const,
    positions: new Float32Array([0, 0, 0]),
  };
  expect(
    interactiveAlignmentTargetError([mesh, cloud], ["scan", "cloud"]),
  ).toBeNull();
  new InteractiveAlignmentSession([mesh, cloud], ["scan", "cloud"], [0, 0, 0]);
  for (const entity of [
    { ...mesh, locked: true },
    { ...mesh, visible: false },
    { ...mesh, selectable: false },
    { ...mesh, kernelId: "exact" },
    { ...mesh, positions: new Float32Array(8) },
  ]) {
    expect(interactiveAlignmentTargetError([entity], ["scan"])).toMatch(
      /unlocked visible/,
    );
    expect(
      () => new InteractiveAlignmentSession([entity], ["scan"], [0, 0, 0]),
    ).toThrow(/unlocked visible/);
  }
  expect(interactiveAlignmentTargetError([mesh], [])).not.toBeNull();
  expect(
    interactiveAlignmentTargetError([mesh], ["scan", "scan"]),
  ).not.toBeNull();
  expect(interactiveAlignmentTargetError([mesh], ["missing"])).not.toBeNull();
});
it("connects both Interactive ribbon locations to the same real action", () => {
  expect(ribbonVerification("alignInteractive", true).status).toBe("verified");
  expect(getRibbonToolMetadata("alignInteractive")).toMatchObject({
    action: "alignInteractive",
    requiresSelection: true,
  });
});
