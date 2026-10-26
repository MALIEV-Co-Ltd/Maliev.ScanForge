import { expect, it, vi, beforeEach } from "vitest";
import { createOperations } from "../src/automation/operations";
import {
  validateInput,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
import { runScanEdit } from "../src/scan-edit";
import { boundarySketches } from "../src/scan-boundary-sketch";
import { prepareModelSketchPublication } from "../src/model-sketch-history";
import { seekModelRevision } from "../src/history";
import catalog from "../src/automation/catalog.json";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = [0, 0, 1, 1, 0, 1, 0, 1, 1];
function entity(patch: Partial<Entity> = {}): Entity {
  return {
    id: "mesh",
    name: "Scan",
    kind: "mesh",
    positions: new Float32Array([...triangle, ...triangle.map((v) => v + 3)]),
    color: "#ffffff",
    visible: true,
    opacity: 1,
    ...patch,
  };
}
function harness(entities: Entity[] = [entity()]) {
  let sequence = 0;
  const cad = {
    alignmentReferences: vi.fn(),
    primitive: vi.fn(async () => ({
      kernelId: `native-${++sequence}`,
      positions: [...triangle],
      brep: "BREP",
    })),
    release: vi.fn(async () => {}),
  } as unknown as CadClient;
  const state: WorkspaceSnapshot = {
    name: "Test",
    entities,
    history: [],
    future: [],
    authoring: {},
    selectedId: "mesh",
    selection: new Uint8Array([1, 0]),
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => cad,
    commit: vi.fn((next, label, policy) => {
      const publication = policy?.newModelSketches?.length
        ? prepareModelSketchPublication(
            state.authoring,
            policy.newModelSketches,
          )
        : undefined;
      state.history.push({
        entities: state.entities,
        label,
        ...(publication ? { sketchChanges: publication.changes } : {}),
      });
      if (publication) state.authoring = publication.authoring;
      state.entities = next;
    }),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn((entityId, mask) => {
      state.selectedId = entityId;
      state.selection = mask;
    }),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  const controller = new AbortController();
  const context: CommandContext = {
    signal: controller.signal,
    progress: vi.fn(),
    check: () => {
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
    },
    artifact: vi.fn((_data, name, mime) => ({
      artifactId: "artifact",
      name,
      mime,
      bytes: 1,
    })),
    artifactBlob: vi.fn(),
  };
  return { host, state, cad, context, controller, ops: createOperations(host) };
}

const plane = { origin: [0, 0, 5], normal: [0, 0, 2] };
const operation = {
  kind: "scanEdit",
  action: "boundaryProject",
  plane,
  fitTolerance: 0.05,
};
const positions = new Float32Array([
  0, 0, 2, 2, 0, 2, 2, 2, 2, 0, 0, 2, 2, 2, 2, 0, 2, 2, 4, 0, 3, 5, 0, 3, 5, 1,
  3, 4, 0, 3, 5, 1, 3, 4, 1, 3,
]);
beforeEach(() => {
  vi.mocked(processMesh)
    .mockReset()
    .mockImplementation(async (request) => {
      if (request.kind !== "scanEdit") throw Error("Expected shared scan edit");
      return {
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: runScanEdit(request),
      };
    });
});
it("discovers explicit boundary sketch publication while retaining read-only default reports", () => {
  const schema = catalog.find((t) => t.name === "mesh_process")!.inputSchema;
  for (const createSketches of [true, false])
    expect(() =>
      validateInput(schema, {
        entityId: "mesh",
        operation: { ...operation, createSketches },
        expectedRevision: 0,
        requestId: "projection",
      }),
    ).not.toThrow();
  expect(() =>
    validateInput(schema, {
      entityId: "mesh",
      operation: { ...operation, createSketches: "yes" },
      expectedRevision: 0,
      requestId: "projection",
    }),
  ).toThrow();
});
it.each([undefined, false])(
  "keeps existing projection reports read-only with createSketches=%s",
  async (createSketches) => {
    const h = harness([entity({ positions })]);
    const result = await h.ops.mesh_process(
      {
        entityId: "mesh",
        operation: {
          ...operation,
          ...(createSketches === undefined ? {} : { createSketches }),
        },
      },
      h.context,
    );
    expect(result).toHaveProperty("artifact");
    expect(result).not.toHaveProperty("sketchIds");
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.state.entities[0].positions).toBe(positions);
    expect(h.state.authoring.sketches).toBeUndefined();
  },
);
it.each([[0], undefined])(
  "publishes new saved sketches in one owned model step for indices %s",
  async (indices) => {
    const h = harness([entity({ positions })]);
    const original = boundarySketches(
      [[0, 0, 5, 1, 0, 5]],
      { origin: [0, 0, 5], normal: [0, 0, 1] },
      "Original",
      () => "original",
    )[0];
    h.state.authoring = {
      sketches: [original],
      activeSketchId: original.id,
      sketch: original.sketch,
    };
    const before = h.state.entities[0];
    const result = (await h.ops.mesh_process(
      {
        entityId: "mesh",
        operation: { ...operation, indices, createSketches: true },
      },
      h.context,
    )) as { sketchIds: string[] };
    const created = h.state.authoring.sketches!.filter(
      (row) => row.id !== original.id,
    );
    expect(created).toHaveLength(indices ? 1 : 2);
    expect(result.sketchIds).toEqual(created.map((row) => row.id));
    expect(created.map((row) => row.name)).toEqual(
      created.map((_, i) => `Projected boundary ${i + 1}`),
    );
    for (const row of created) {
      expect(row.sketch.points).toHaveLength(4);
      expect(row.sketch.segments).toHaveLength(4);
      expect(row.sketch.segments.at(-1)!.b).toBe(row.sketch.points[0].id);
      expect(row.sketch.frame!.origin).toEqual([0, 0, 5]);
    }
    expect(h.state.entities).toHaveLength(1);
    expect(h.state.entities[0].positions).toBe(before.positions);
    expect(h.state.authoring.sketches![0]).toEqual(original);
    expect(h.state.authoring.activeSketchId).toBe(original.id);
    expect(h.state.authoring.sketch).toBe(original.sketch);
    expect(h.host.commit).toHaveBeenCalledOnce();
    expect(h.state.history).toHaveLength(1);
    expect(h.state.history[0].sketchChanges).toEqual(
      created.map((row) => ({ id: row.id })),
    );
    expect(vi.mocked(processMesh).mock.lastCall![0]).not.toHaveProperty(
      "createSketches",
    );
    const undo = seekModelRevision(
      h.state.history,
      h.state.entities,
      [],
      0,
      h.state.authoring,
    );
    expect(undo.authoring!.sketches).toEqual([original]);
    const later = { ...original, id: "later", name: "Later" };
    const redo = seekModelRevision(
      undo.history,
      undo.entities,
      undo.future,
      1,
      { ...undo.authoring!, sketches: [original, later] },
    );
    expect(redo.authoring!.sketches!.map((row) => row.id).sort()).toEqual(
      [original.id, later.id, ...created.map((row) => row.id)].sort(),
    );
  },
);
it.each([true, false, "yes"])(
  "rejects publication option on other scan actions: %s",
  async (createSketches) => {
    const h = harness([entity({ positions })]);
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: { kind: "scanEdit", action: "inventory", createSketches },
        },
        h.context,
      ),
    ).rejects.toThrow(/boundary projection|boundaryProject/i);
    expect(processMesh).not.toHaveBeenCalled();
    expect(h.host.commit).not.toHaveBeenCalled();
  },
);
it("rejects locked publication before work but allows protected read-only projection", async () => {
  const h = harness([entity({ positions, locked: true })]);
  await expect(
    h.ops.mesh_process(
      { entityId: "mesh", operation: { ...operation, createSketches: true } },
      h.context,
    ),
  ).rejects.toThrow(/locked/i);
  expect(processMesh).not.toHaveBeenCalled();
  await h.ops.mesh_process({ entityId: "mesh", operation }, h.context);
  expect(processMesh).toHaveBeenCalledOnce();
  expect(h.host.commit).not.toHaveBeenCalled();
});
it.each([
  { label: "empty", curves: [] },
  { label: "short", curves: [[0, 0, 0]] },
  { label: "nonplanar", curves: [[0, 0, 5, 1, 0, 7]] },
  {
    label: "malformed worker shape",
    curves: [0, 0, 0] as unknown as number[][],
  },
])("publishes no $label output", async ({ curves }) => {
  const h = harness([entity({ positions })]);
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: { curves, diagnostics: {} },
  });
  await expect(
    h.ops.mesh_process(
      { entityId: "mesh", operation: { ...operation, createSketches: true } },
      h.context,
    ),
  ).rejects.toThrow();
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.authoring.sketches).toBeUndefined();
});
it("discards a cancelled publication before committing sketches or history", async () => {
  const h = harness([entity({ positions })]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (request.kind !== "scanEdit") throw Error("Expected scan edit");
    const edit = runScanEdit(request);
    h.controller.abort();
    return { kind: "scanEdit", diagnostics: {}, scanEdit: edit };
  });
  await expect(
    h.ops.mesh_process(
      { entityId: "mesh", operation: { ...operation, createSketches: true } },
      h.context,
    ),
  ).rejects.toThrow(/cancel/i);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.entities[0].positions).toBe(positions);
});

it("rejects a nonboolean publication option before worker dispatch", async () => {
  const h = harness([entity({ positions })]);
  await expect(
    h.ops.mesh_process(
      { entityId: "mesh", operation: { ...operation, createSketches: "true" } },
      h.context,
    ),
  ).rejects.toThrow(/boolean/);
  expect(processMesh).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});
