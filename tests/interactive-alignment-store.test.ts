import { expect, it, vi } from "vitest";
import { InteractiveAlignmentStore } from "../src/interactive-alignment-store";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
it("retains one stable snapshot until publication and cleans subscriptions", () => {
  const store = new InteractiveAlignmentStore();
  expect(store.getSnapshot()).toBe(null);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const state: InteractiveAlignmentState = {
    sessionId: crypto.randomUUID(),
    version: 0,
    changed: false,
    targets: [],
    strength: 100,
    mirror: false,
    mirrorPlane: 1,
    entityIds: [],
    matrix: [],
    matrixBits: "",
    pivot: [0, 0, 0],
    boundsFresh: false,
    applying: false,
  };
  store.publish(state);
  expect(store.getSnapshot()).toBe(state);
  expect(listener).toHaveBeenCalledOnce();
  for (let version = 1; version <= 60; version++)
    store.publish({ ...state, version });
  expect(store.getSnapshot()?.version).toBe(60);
  unsubscribe();
  store.publish(null);
  expect(listener).toHaveBeenCalledTimes(61);
  expect(store.getSnapshot()).toBe(null);
});
