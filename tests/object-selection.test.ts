import { expect, it } from "vitest";
import {
  reconcileObjectSelection,
  selectObject,
  type ObjectSelectionState,
} from "../src/object-selection";

const empty: ObjectSelectionState = {
  ids: [],
  activeId: null,
  anchorId: null,
};
const order = ["a", "b", "c", "d", "e"];

it("replaces the selection and anchor on an ordinary click", () => {
  expect(
    selectObject(
      { ids: ["a", "b"], activeId: "b", anchorId: "a" },
      order,
      "d",
      {},
    ),
  ).toEqual({
    ids: ["d"],
    activeId: "d",
    anchorId: "d",
  });
});

it("toggles another object while preserving existing selections", () => {
  const selected = selectObject(empty, order, "c", {});
  expect(selectObject(selected, order, "a", { toggle: true })).toEqual({
    ids: ["a", "c"],
    activeId: "a",
    anchorId: "a",
  });
});

it("retains the active object when another selection is toggled off", () => {
  expect(
    selectObject(
      { ids: ["a", "c"], activeId: "c", anchorId: "a" },
      order,
      "a",
      { toggle: true },
    ),
  ).toEqual({
    ids: ["c"],
    activeId: "c",
    anchorId: "a",
  });
});

it("chooses a remaining active object or empties selection when toggling off", () => {
  const remaining = selectObject(
    { ids: ["a", "c"], activeId: "c", anchorId: "a" },
    order,
    "c",
    { toggle: true },
  );
  expect(remaining).toEqual({ ids: ["a"], activeId: "a", anchorId: "c" });
  expect(selectObject(remaining, order, "a", { toggle: true })).toEqual({
    ids: [],
    activeId: null,
    anchorId: "a",
  });
});

it("selects an inclusive range from a persistent anchor in both directions", () => {
  const anchor = selectObject(empty, order, "c", {});
  const forward = selectObject(anchor, order, "e", { range: true });
  expect(forward).toEqual({
    ids: ["c", "d", "e"],
    activeId: "e",
    anchorId: "c",
  });
  expect(selectObject(forward, order, "a", { range: true })).toEqual({
    ids: ["a", "b", "c"],
    activeId: "a",
    anchorId: "c",
  });
});

it("adds a range with ctrl+shift while retaining selections outside it", () => {
  expect(
    selectObject(
      { ids: ["a", "c"], activeId: "c", anchorId: "c" },
      order,
      "e",
      { toggle: true, range: true },
    ),
  ).toEqual({
    ids: ["a", "c", "d", "e"],
    activeId: "e",
    anchorId: "c",
  });
});

it("falls back to the clicked object when a range anchor is deleted", () => {
  const stale = { ids: ["a"], activeId: "a", anchorId: "deleted" };
  expect(selectObject(stale, order, "c", { range: true })).toEqual({
    ids: ["c"],
    activeId: "c",
    anchorId: "c",
  });
  expect(
    selectObject(stale, order, "c", { range: true, toggle: true }),
  ).toEqual({
    ids: ["a", "c"],
    activeId: "c",
    anchorId: "c",
  });
});

it("includes hidden pickable rows in a range and excludes disabled objects", () => {
  const pickable = ["a", "hidden", "d"];
  const selected = selectObject(empty, pickable, "a", {});
  expect(selectObject(selected, pickable, "d", { range: true }).ids).toEqual([
    "a",
    "hidden",
    "d",
  ]);
  expect(selectObject(selected, pickable, "locked", {})).toEqual(selected);
});

it("reconciles deleted or disabled IDs, duplicates, active object and anchor", () => {
  expect(
    reconcileObjectSelection(
      {
        ids: ["c", "deleted", "a", "c"],
        activeId: "deleted",
        anchorId: "deleted",
      },
      order,
    ),
  ).toEqual({
    ids: ["a", "c"],
    activeId: "c",
    anchorId: null,
  });
  expect(
    reconcileObjectSelection(
      { ids: ["deleted"], activeId: "deleted", anchorId: "deleted" },
      order,
    ),
  ).toEqual(empty);
});

it("retains a valid unselected range anchor and a selected active object", () => {
  expect(
    reconcileObjectSelection(
      { ids: ["c", "a"], activeId: "a", anchorId: "b" },
      order,
    ),
  ).toEqual({
    ids: ["a", "c"],
    activeId: "a",
    anchorId: "b",
  });
});

it("does not mutate the caller's selection or ordered IDs", () => {
  const state = { ids: ["c"], activeId: "c", anchorId: "c" };
  const before = structuredClone(state);
  const ids = [...order];
  selectObject(state, ids, "a", { toggle: true });
  expect(state).toEqual(before);
  expect(ids).toEqual(order);
});
