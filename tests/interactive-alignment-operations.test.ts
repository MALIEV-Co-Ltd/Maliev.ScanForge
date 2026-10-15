import { expect, it, vi } from "vitest";
import {
  createInteractiveOperations,
  releaseInteractiveSession,
} from "../src/automation/interactive-alignment-operations";
import type {
  WorkspaceHost,
  CommandContext,
  WorkspaceSnapshot,
} from "../src/automation/api";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
import type { Entity } from "../src/types";
import type { InteractiveMirrorBackend } from "../src/interactive-mirror-backend";
function harness() {
  const base: Entity[] = [
    {
      id: "scan",
      name: "scan",
      kind: "mesh",
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
      color: "#aaa",
      opacity: 1,
      visible: true,
    },
  ];
  let entities = base,
    state: InteractiveAlignmentState | null = null;
  const snapshot = () =>
    ({
      entities,
      selectedId: "scan",
      selectedIds: [],
      name: "test",
      history: [],
      future: [],
      authoring: [],
      selection: null,
      settings: {},
    }) as unknown as WorkspaceSnapshot;
  const commit = vi.fn((next: Entity[]) => {
    entities = next;
  });
  const host = {
    snapshot,
    commit,
    publishInteractive: (next: InteractiveAlignmentState | null) => {
      state = next;
    },
    inspectInteractive: () => state,
    inspectApplication: () => ({ previews: {} }),
  } as unknown as WorkspaceHost;
  const operations = createInteractiveOperations(host);
  const abort = new AbortController();
  const context = {
    signal: abort.signal,
    check: () => abort.signal.throwIfAborted(),
    progress: vi.fn(),
    mutate: (write: () => void) => write(),
  } as unknown as CommandContext;
  const edit = (args: Record<string, unknown>) =>
    Promise.resolve(
      operations.interactive_alignment_edit(args, context),
    ) as Promise<any>;
  const apply = (args: Record<string, unknown>) =>
    Promise.resolve(
      operations.interactive_alignment_apply(args, context),
    ) as Promise<any>;
  const current = () => state!;
  const reference = () => ({
    sessionId: current().sessionId,
    expectedSessionVersion: current().version,
  });
  return {
    host,
    base,
    snapshot,
    commit,
    context,
    edit,
    apply,
    current,
    reference,
    abort,
    replace: () => {
      entities = [...entities];
    },
  };
}
it("defaults to the selected scan even when the multi-selection list is empty, and commits only once after preview", async () => {
  const h = harness();
  try {
    const begin = await h.edit({ action: "begin", parallel: false });
    expect(begin.active).toBe(true);
    expect(begin.entityIds).toEqual(["scan"]);
    expect(begin.pivot).toEqual([1, 1, 0]);
    const source = h.base[0].positions;
    await h.edit({
      action: "step",
      ...h.reference(),
      kind: "translatePositive",
      axis: 0,
      value: 3,
    });
    expect(h.snapshot().entities).toBe(h.base);
    expect(h.base[0].positions).toBe(source);
    expect(h.commit).not.toHaveBeenCalled();
    const result = await h.apply(h.reference());
    expect(result.applied).toBe(true);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.snapshot().entities[0].positions[0]).toBe(3);
    expect(h.current()).toBe(null);
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("uses native face-derived visibility for the session pivot and exposes source-state diagnostics", async () => {
  const h = harness();
  const vertices = new Float32Array([
    0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 3, 3, 0, 999, 999, 999,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 2, 3, 4]);
  h.base[0] = {
    ...h.base[0],
    positions: Float32Array.from(
      Array.from(triangles).flatMap((i) =>
        Array.from(vertices.subarray(i * 3, i * 3 + 3)),
      ),
    ),
    indexedMesh: {
      vertices,
      triangles,
      normals: Float32Array.from({ length: 18 }, (_, i) =>
        i % 3 === 2 ? 1 : 0,
      ),
    },
    meshSelection: { hidden: [1], saved: [] },
  };
  h.host.snapshot = () => ({
    ...h.snapshot(),
    selection: new Uint8Array([1, 0]),
  });
  try {
    const result = await h.edit({ action: "begin", parallel: false });
    expect(result.pivot).toEqual([1, 1, 0]);
    expect(result.displaySources).toEqual([
      {
        entityId: "scan",
        vertices: 6,
        normalsAvailable: true,
        ready: true,
        selected: 1,
        hidden: 1,
        visibleFaces: 1,
      },
    ]);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.base[0].indexedMesh!.vertices).toBe(vertices);
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("installs a session-owned mirror provider, prepares normals before configuration, and invalidates it on release", async () => {
  const h = harness();
  let installed: InteractiveMirrorBackend | null = null;
  h.host.installInteractiveMirror = (next) => {
    installed = next;
  };
  try {
    await h.edit({ action: "begin", parallel: false });
    const backend = installed! as InteractiveMirrorBackend;
    expect(backend.entityIds).toEqual(["scan"]);
    const before = h.base[0].positions;
    const result = await h.edit({
      action: "configure",
      ...h.reference(),
      mirror: true,
      mirrorPlane: "XY",
    });
    expect(result.mirror).toBe(true);
    expect(result.displaySources[0].normalsAvailable).toBe(true);
    const source = await backend.source("scan");
    expect(source.positions).toBe(before);
    expect(Array.from(source.flags!)).toEqual([0, 0, 0]);
    const points = await backend.prepare("scan", {
      direction: [0, 0, 1],
      stride: 0,
      baseColor: [0.8, 0.8, 0],
      selectedColor: [0.3, 0.4, 0.5],
      allowanceMilliseconds: 1000000,
      elapsedMilliseconds: 0,
    });
    expect(Array.from(points.indices)).toEqual([0, 1, 2]);
    expect(points.colors!.length).toBe(9);
    expect((await h.apply(h.reference())).applied).toBe(false);
    expect(installed).toBe(null);
    await expect(backend.source("scan")).rejects.toThrow();
    expect(h.commit).not.toHaveBeenCalled();
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("refuses stale session versions and changed geometry without changing preview or committing", async () => {
  const h = harness();
  try {
    await h.edit({ action: "begin", entityIds: ["scan"], parallel: false });
    const old = h.reference();
    await h.edit({ action: "configure", ...old, strength: 50 });
    const state = h.current();
    await expect(
      h.edit({
        action: "step",
        ...old,
        kind: "translatePositive",
        axis: 0,
        value: 1,
      }),
    ).rejects.toThrow("session changed");
    expect(h.current()).toBe(state);
    h.replace();
    await expect(h.apply(h.reference())).rejects.toThrow("project changed");
    expect(h.commit).not.toHaveBeenCalled();
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("cancels a pending begin without publishing a late session or leaving it usable", async () => {
  const h = harness();
  const pending = h.edit({
    action: "begin",
    entityIds: ["scan"],
    parallel: false,
  });
  releaseInteractiveSession(h.host);
  await expect(pending).rejects.toThrow();
  expect(h.current()).toBe(null);
  expect(h.commit).not.toHaveBeenCalled();
});
it("closes a no-op without adding history and leaves a cancelled Apply unpublished", async () => {
  const h = harness();
  try {
    await h.edit({ action: "begin", entityIds: ["scan"], parallel: false });
    await h.apply(h.reference());
    expect(h.commit).not.toHaveBeenCalled();
    await h.edit({ action: "begin", entityIds: ["scan"], parallel: false });
    await h.edit({
      action: "step",
      ...h.reference(),
      kind: "translatePositive",
      axis: 0,
      value: 1,
    });
    h.abort.abort();
    await expect(h.apply(h.reference())).rejects.toThrow();
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.snapshot().entities).toBe(h.base);
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("leaves the session version and geometry untouched while a drag is below its native threshold", async () => {
  const h = harness();
  h.host.interactiveDragInput = vi.fn(() => null);
  try {
    await h.edit({ action: "begin", entityIds: ["scan"], parallel: false });
    const before = h.reference();
    const result = await h.edit({
      action: "drag",
      ...before,
      handle: 4,
      from: [0.5, 0.5],
      to: [0.505, 0.5],
      continuation: false,
    });
    expect(result.accepted).toBe(false);
    expect(result.waiting).toBe(true);
    expect(h.reference()).toEqual(before);
    expect(h.snapshot().entities).toBe(h.base);
    expect(h.commit).not.toHaveBeenCalled();
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("releases a session when its first display publication fails", async () => {
  const h = harness();
  const publish = h.host.publishInteractive!;
  h.host.publishInteractive = () => {
    throw new Error("Display failed");
  };
  await expect(
    h.edit({ action: "begin", entityIds: ["scan"], parallel: false }),
  ).rejects.toThrow("Display failed");
  h.host.publishInteractive = publish;
  try {
    await expect(
      h.edit({ action: "begin", entityIds: ["scan"], parallel: false }),
    ).resolves.toMatchObject({ active: true });
  } finally {
    releaseInteractiveSession(h.host);
  }
});

it("publishes transformed measured bounds before resetting the Current View camera", async () => {
  const h = harness();
  h.host.interactiveViewFrame = () => ({
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    anchor: [5, 6, 7],
  });
  const finish = vi.fn(() => {
    const state = h.host.inspectInteractive!()!;
    expect(state.targets[0].matrix[3]).toBe(-5);
    expect(state.bounds![0]).toEqual({ min: [-5, -6, -7], max: [-3, -4, -7] });
  });
  h.host.finishInteractiveCurrentView = finish;
  try {
    await h.edit({ action: "begin", parallel: false });
    await h.edit({ action: "currentView", ...h.reference() });
    expect(finish).toHaveBeenCalledOnce();
  } finally {
    releaseInteractiveSession(h.host);
  }
});
it("does not advance Current View when the camera reset adapter is unavailable", async () => {
  const h = harness();
  h.host.interactiveViewFrame = () => ({
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    anchor: [5, 6, 7],
  });
  try {
    await h.edit({ action: "begin", parallel: false });
    const before = h.reference();
    await expect(h.edit({ action: "currentView", ...before })).rejects.toThrow(
      "unavailable",
    );
    expect(h.reference()).toEqual(before);
  } finally {
    releaseInteractiveSession(h.host);
  }
});

it("restores the previous pose, bounds and version after a failed Current View camera publication", async () => {
  const h = harness();
  h.host.interactiveViewFrame = () => ({
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    anchor: [5, 6, 7],
  });
  h.host.finishInteractiveCurrentView = () => {
    throw Error("camera unavailable");
  };
  try {
    await h.edit({ action: "begin", parallel: false });
    const before = h.host.inspectInteractive!();
    await expect(
      h.edit({ action: "currentView", ...h.reference() }),
    ).rejects.toThrow("camera unavailable");
    expect(h.host.inspectInteractive!()).toEqual(before);
    expect(h.commit).not.toHaveBeenCalled();
  } finally {
    releaseInteractiveSession(h.host);
  }
});
