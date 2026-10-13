import { expect, it } from "vitest";
import { seekModelRevision, type Revision } from "../src/history";
import type { Entity } from "../src/types";
const mesh = (n: number): Entity => ({
  id: "mesh",
  name: "Mesh",
  kind: "mesh",
  positions: [n, 0, 0],
  color: "#aaa",
  opacity: 1,
  visible: true,
});
const states = [[], [mesh(1)], [mesh(2)], [mesh(3)]] as Entity[][];
const labels = ["Open mesh", "Edit mesh", "Smooth mesh"];
const past: Revision[] = labels.map((label, i) => ({
  label,
  entities: states[i],
}));
it("seeks every retained state from every cursor and preserves complete redo history", () => {
  for (let cursor = 0; cursor <= 3; cursor++) {
    const split = seekModelRevision(past, states[3], [], cursor);
    for (let target = 0; target <= 3; target++) {
      const next = seekModelRevision(
        split.history,
        split.entities,
        split.future,
        target,
      );
      expect(next.entities.map((e) => e.positions)).toEqual(
        states[target].map((e) => e.positions),
      );
      expect(next.history.map((r) => r.label)).toEqual(labels.slice(0, target));
      expect(next.future.map((r) => r.label)).toEqual(labels.slice(target));
      const end = seekModelRevision(
        next.history,
        next.entities,
        next.future,
        3,
      );
      expect(end.entities[0].positions).toEqual(states[3][0].positions);
    }
  }
});
it("preserves live appearance while restoring geometry and avoids mutation", () => {
  const current = [
    { ...mesh(3), name: "Renamed", color: "#123", visible: false },
  ];
  const result = seekModelRevision(past, current, [], 1);
  expect(result.entities[0]).toMatchObject({
    name: "Renamed",
    color: "#123",
    visible: false,
    positions: [1, 0, 0],
  });
  expect(past).toHaveLength(3);
  expect(current[0].positions).toEqual([3, 0, 0]);
});
it("rejects invalid cursors and handles an empty timeline", () => {
  for (const i of [-1, 4, 1.5, NaN])
    expect(() => seekModelRevision(past, states[3], [], i)).toThrow(RangeError);
  expect(seekModelRevision([], [], [], 0)).toEqual({
    history: [],
    entities: [],
    future: [],
  });
});
