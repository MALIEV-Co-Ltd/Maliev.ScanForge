import { expect, it } from "vitest";
import {
  SelectionSession,
  hideRegion,
  indicesMask,
  maskIndices,
} from "../src/selection-session";
import { modelChanged, restoreModelDisplay } from "../src/history";
import type { Entity } from "../src/types";
const entity: Entity = {
  id: "mesh",
  name: "Part",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#a6a6a6",
  visible: true,
  opacity: 1,
};
it("groups a brush gesture, skips no-ops and separates undo/redo", () => {
  const s = new SelectionSession(3);
  s.begin();
  s.set({ mask: new Uint8Array([1, 0, 0]), hidden: [] });
  s.set({ mask: new Uint8Array([1, 1, 0]), hidden: [] });
  s.end();
  expect(s.canUndo).toBe(true);
  expect([...s.undo().mask]).toEqual([0, 0, 0]);
  expect(s.canUndo).toBe(false);
  expect([...s.redo().mask]).toEqual([1, 1, 0]);
  s.set(s.state);
  expect(s.canRedo).toBe(false);
  s.undo();
  s.set({ mask: new Uint8Array([0, 0, 1]), hidden: [] });
  expect(s.canRedo).toBe(false);
});
it("hide/isolate preserve positions and restore visibility through selection undo", () => {
  const s = new SelectionSession(3);
  s.set({ mask: new Uint8Array([1, 0, 1]), hidden: [] });
  s.set(hideRegion(s.state));
  expect(s.state.hidden).toEqual([0, 2]);
  expect([...s.state.mask]).toEqual([0, 0, 0]);
  expect(s.undo().hidden).toEqual([]);
  s.set(hideRegion(s.state, true));
  expect(s.state.hidden).toEqual([1]);
  expect(maskIndices(s.state.mask)).toEqual([0, 2]);
  s.set({ mask: s.state.mask, hidden: [] });
  expect(s.undo().hidden).toEqual([1]);
});
it("clones snapshots, roundtrips sparse masks and rejects invalid state", () => {
  const s = new SelectionSession(2);
  const mask = indicesMask(2, [1]);
  s.set({ mask, hidden: [] });
  mask[0] = 1;
  expect(maskIndices(s.state.mask)).toEqual([1]);
  expect(() => indicesMask(2, [2])).toThrow();
  expect(() => s.set({ mask: new Uint8Array(2), hidden: [1, 1] })).toThrow();
  expect(() => s.set({ mask: new Uint8Array([2, 0]), hidden: [] })).toThrow();
});
it("display, names and saved selections do not count as model modifications", () => {
  const display = {
    ...entity,
    opacity: 0.3,
    color: "#ffffff",
    visible: false,
    name: "Renamed",
    meshSelection: { hidden: [0], saved: [] },
  };
  expect(modelChanged([entity], [display])).toBe(false);
  expect(
    modelChanged([entity], [{ ...entity, positions: [...entity.positions] }]),
  ).toBe(true);
  expect(modelChanged([entity], [])).toBe(true);
  const restored = restoreModelDisplay([entity], [display])[0];
  expect(restored.opacity).toBe(0.3);
  expect(restored.visible).toBe(false);
  expect(restored.meshSelection?.hidden).toEqual([0]);
  expect(
    restoreModelDisplay(
      [{ ...entity, positions: [...entity.positions] }],
      [display],
    )[0].meshSelection,
  ).toBeUndefined();
});
