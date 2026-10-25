import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createInteractiveOperations } from "../src/automation/interactive-alignment-operations";
import {
  beginReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
  disposeReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";
import { ReferencePreviewDisplay } from "../src/reference-preview-display";
const hosts: WorkspaceHost[] = [];
const prior = {
  geometry: { kind: "point" as const, position: [0, 0, 0] as const },
  state: { completionWord: 0 },
};
const edit = {
  definition: {
    version: 1 as const,
    kind: "point" as const,
    mode: "coordinates" as const,
    position: [1, 2, 3] as const,
    sources: [],
  },
  writeNumericInputs: true,
  evaluationAllowed: true,
};
function setup() {
  vi.useFakeTimers();
  const state: WorkspaceSnapshot = {
    name: "Test",
    projectId: "p",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const host = { snapshot: () => state } as WorkspaceHost;
  const scene = new THREE.Scene(),
    manager = new ReferencePreviewDisplay(scene);
  hosts.push(host);
  return { host, scene, manager };
}
afterEach(() => {
  for (const host of hosts.splice(0)) disposeReferenceConstructionPreview(host);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("joins API disposal to the actual owned display and timer", () => {
  const { host, scene, manager } = setup();
  const api = new ApplicationApi(host, {});
  beginReferenceConstructionPreview(host, manager, prior, edit);
  expect(scene.children).toHaveLength(1);
  api.dispose();
  expect(scene.children).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "disposed",
  });
});
it("still clears the reference owner if another preview cleanup throws", () => {
  const { host, scene, manager } = setup();
  host.installInteractiveMirror = vi.fn(() => {
    throw Error("interactive cleanup failed");
  });
  const api = new ApplicationApi(host, createInteractiveOperations(host));
  beginReferenceConstructionPreview(host, manager, prior, edit);
  expect(() => api.dispose()).toThrow(/cleanup/);
  expect(scene.children).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "disposed",
  });
});
it("retains failed owner cleanup for a later API disposal retry", () => {
  const { host, scene, manager } = setup();
  const clear = vi
    .fn((owner: string) => manager.clear(owner))
    .mockImplementationOnce(() => {
      throw Error("display cleanup failed");
    });
  beginReferenceConstructionPreview(
    host,
    { show: (owner, candidate) => manager.show(owner, candidate), clear },
    prior,
    edit,
  );
  const api = new ApplicationApi(host, {});
  expect(() => api.dispose()).toThrow(/cleanup/);
  expect(vi.getTimerCount()).toBe(0);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "disposed",
    cleanupPending: true,
  });
  api.dispose();
  expect(scene.children).toHaveLength(0);
  expect(clear).toHaveBeenCalledTimes(2);
});
