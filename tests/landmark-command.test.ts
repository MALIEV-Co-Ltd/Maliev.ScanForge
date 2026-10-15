import { expect, it, vi } from "vitest";
import native from "./fixtures/alignment-command-enablement-native.json";
import {
  nativeLandmarkSourceIndex,
  landmarkCommandSource,
} from "../src/landmark-command";
import {
  getRibbonToolMetadata,
  ribbonToolAvailability,
} from "../src/ui/ribbon-model";
import type { Entity } from "../src/types";

it.each(native.cases.map((sample, index) => ({ ...sample, index })))(
  "resolves the original mesh command source for native scene $index",
  ({ objects, scanIndex }) => {
    expect(
      nativeLandmarkSourceIndex(
        objects.map((object) => ({
          scan: object.kind === "mesh",
          flags: object.flags,
        })),
      ),
    ).toBe(scanIndex);
  },
);
const a: Entity = {
  id: "a",
  name: "A",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  color: "#aaa",
  opacity: 1,
};
const b: Entity = { ...a, id: "b", name: "B" };
it("uses an active scan, unique selected scan or single scene scan without needing a fixed target", () => {
  expect(landmarkCommandSource([a], null, [])).toBe(a);
  expect(landmarkCommandSource([a, b], null, [])).toBeUndefined();
  expect(landmarkCommandSource([a, b], null, ["b"])).toBe(b);
  expect(landmarkCommandSource([a, b], "a", ["a", "b"])).toBe(a);
});
it("keeps lock/visibility/pickability guards and explicit point-cloud support outside the native type claim", () => {
  const cloud: Entity = { ...a, id: "cloud", kind: "pointcloud" };
  const cad: Entity = { ...a, id: "cad", kernelId: "brep" };
  expect(landmarkCommandSource([cad, a], "cad", ["cad"])).toBe(a);
  expect(landmarkCommandSource([cloud], null, [])).toBe(cloud);
  for (const excluded of [
    { ...a, locked: true },
    { ...a, visible: false },
    { ...a, selectable: false },
    { ...a, positions: [] },
    cad,
    { ...a, parametric: {} } as Entity,
    { ...a, surfacePatch: {} } as Entity,
  ])
    expect(
      landmarkCommandSource([excluded], excluded.id, [excluded.id]),
    ).toBeUndefined();
});
it("enables only an idle, source-resolved ordinary point-pair ribbon command", () => {
  const tool = getRibbonToolMetadata("alignNPoints")!;
  const actions = { alignNPoints: vi.fn() };
  const state = {
    disabled: false,
    hasSelection: false,
    canUndo: false,
    canRedo: false,
    landmarkSourceId: "a",
  };
  expect(ribbonToolAvailability(tool, state, actions).available).toBe(true);
  expect(
    ribbonToolAvailability(tool, { ...state, landmarkSourceId: null }, actions)
      .reason,
  ).toMatch(/scan/i);
  expect(
    ribbonToolAvailability(tool, { ...state, disabled: true }, actions)
      .available,
  ).toBe(false);
});
