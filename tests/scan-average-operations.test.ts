import { expect, it, vi, beforeEach } from "vitest";
import { createOperations } from "../src/automation/operations";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
import { runScanTool } from "../src/scan-tools";
import { runAverageCommand } from "../src/ui/average-command";
import unrollObserved from "./fixtures/unroll-observed-cylinder.json";
import { prepareModelSketchPublication } from "../src/model-sketch-history";
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

beforeEach(() => {
  vi.mocked(processMesh)
    .mockReset()
    .mockImplementation(async (request) => {
      if (request.kind !== "scanTools") throw Error("Expected scanTools");
      const result = runScanTool(request);
      return {
        kind: "scanTools",
        positions: result.positions,
        diagnostics: { summary: result.summary },
      };
    });
});

it("binds Unroll to exact imported CAD parameters through GUI and MCP", async () => {
  const { runUnrollCommand } = await import("../src/ui/unroll-command");
  const source = entity({
    positions: Float32Array.from(unrollObserved.source),
  });
  const reference = entity({ id: "reference", kind: "cad", kernelId: "exact" });
  const h = harness([source, reference]);
  vi.mocked(h.cad.alignmentReferences).mockResolvedValue([
    {
      kind: "cylinder",
      faceIndex: 0,
      firstTriangle: 0,
      triangleCount: 24,
      location: [0, 0, 0],
      axis: [0, 0, 1],
      firstV: 0,
      lastV: 1,
      radius: 2,
      semiAngle: 0,
    },
  ]);
  const result = await runUnrollCommand(
    new ApplicationApi(h.host, h.ops),
    source.id,
    {
      kind: "unroll",
      cylinderId: reference.id,
      instances: 1,
    },
  );
  expect(h.cad.alignmentReferences).toHaveBeenCalledExactlyOnceWith("exact");
  const request = vi.mocked(processMesh).mock.calls[0][0];
  expect(request).toMatchObject({
    operation: {
      kind: "unroll",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 2,
      instances: 1,
    },
  });
  expect(request).not.toHaveProperty("operation.cylinderId");
  expect(result.unroll).toMatchObject({
    cylinderEntityId: reference.id,
    referenceKind: "exact-cad",
    faceIndex: 0,
    radius: 2,
  });
  const output = h.state.entities.find(
    (row) => row.id === (result.entityIds as string[])[0],
  )!;
  const expected = unrollObserved.cases.find(
    (sample) => sample.instances === 1 && sample.offsetDegrees === 0,
  )!;
  for (let i = 0; i < output.positions.length; i++) {
    if (i % 3 === 1)
      expect(
        Math.abs(output.positions[i] - expected.positions[i]),
      ).toBeLessThan(1e-12);
    else expect(output.positions[i]).toBe(expected.positions[i]);
  }
  expect(h.state.entities[0]).toBe(source);
  expect(h.state.entities[1]).toBe(reference);
});

it("rejects ambiguous exact Unroll references and cancels before geometry work", async () => {
  const source = entity({
    positions: Float32Array.from(unrollObserved.source),
  });
  const reference = entity({ id: "reference", kind: "cad", kernelId: "exact" });
  const h = harness([source, reference]);
  const face = {
    kind: "cylinder" as const,
    faceIndex: 0,
    firstTriangle: 0,
    triangleCount: 24,
    location: [0, 0, 0] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
    firstV: 0,
    lastV: 1,
    radius: 2,
    semiAngle: 0,
  };
  const args = {
    entityId: source.id,
    operation: {
      kind: "scanTools",
      operation: { kind: "unroll", cylinderId: reference.id },
    },
  };
  vi.mocked(h.cad.alignmentReferences).mockResolvedValue([
    face,
    { ...face, faceIndex: 1 },
  ]);
  await expect(h.ops.mesh_process(args, h.context)).rejects.toThrow(
    /single.*cylinder/i,
  );
  expect(processMesh).not.toHaveBeenCalled();
  vi.mocked(h.cad.alignmentReferences).mockImplementation(async () => {
    h.controller.abort();
    return [face];
  });
  await expect(h.ops.mesh_process(args, h.context)).rejects.toThrow(
    /cancel|abort/i,
  );
  expect(processMesh).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});
const plane = (id: string, z: number, facets = 1) =>
  entity({
    id,
    positions: new Float32Array(
      Array.from({ length: facets }, () => [
        -10,
        -10,
        z,
        10,
        -10,
        z,
        0,
        10,
        z,
      ]).flat(),
    ),
  });
it("GUI adapter uses the public multi-reference operation and native base/new-owner policy", async () => {
  const first = plane("first", 0),
    base = plane("base", 1, 2),
    last = plane("last", 2);
  const h = harness([first, base, last]);
  const api = new ApplicationApi(h.host, h.ops);
  const result = await runAverageCommand(api, {
    entityId: first.id,
    targetIds: [last.id, base.id],
    tolerance: 10,
  });
  expect(result.average).toEqual({
    baseEntityId: base.id,
    referenceEntityIds: [first.id, last.id],
  });
  expect(h.state.entities.slice(0, 3)).toEqual([first, base, last]);
  expect(h.state.entities).toHaveLength(4);
  expect(h.state.history).toHaveLength(1);
  expect(h.host.select).toHaveBeenCalledWith(h.state.entities[3].id);
  const request = vi.mocked(processMesh).mock.calls[0][0];
  expect(request.positions).toBe(base.positions);
  if (request.kind !== "scanTools" || request.operation.kind !== "averageMesh")
    throw Error("Expected average");
  expect(request.operation.targets).toEqual([first.positions, last.positions]);
});
it("retains the singular target alias and explicit replacement, but rejects conflicting or invalid references", async () => {
  const a = plane("a", 1, 2),
    b = plane("b", 0);
  const h = harness([a, b]);
  await h.ops.mesh_process(
    {
      entityId: a.id,
      targetId: b.id,
      createNew: false,
      operation: { kind: "scanTools", operation: { kind: "averageMesh" } },
    },
    h.context,
  );
  expect(h.state.entities).toHaveLength(2);
  expect(h.state.entities[1]).toBe(b);
  expect(h.state.entities[0].positions[2]).toBe(0.5);
  for (const extra of [
    { targetId: b.id, targetIds: [b.id] },
    { targetIds: [b.id, b.id] },
    { targetIds: ["missing"] },
  ])
    await expect(
      h.ops.mesh_process(
        {
          entityId: a.id,
          ...extra,
          operation: { kind: "scanTools", operation: { kind: "averageMesh" } },
        },
        h.context,
      ),
    ).rejects.toThrow();
});
it("rejects a locked chosen base and does not publish a failed or cancelled result", async () => {
  const a = plane("a", 1),
    b = { ...plane("b", 0, 2), locked: true };
  const h = harness([a, b]);
  await expect(
    h.ops.mesh_process(
      {
        entityId: a.id,
        targetIds: [b.id],
        operation: { kind: "scanTools", operation: { kind: "averageMesh" } },
      },
      h.context,
    ),
  ).rejects.toThrow(/locked/i);
  expect(h.host.commit).not.toHaveBeenCalled();
});

it("Unroll GUI command and MCP create the same separate owner with instances", async () => {
  const { runUnrollCommand } = await import("../src/ui/unroll-command");
  const source = entity({
    positions: new Float32Array([2, 0, 0, 0, 2, 0, 2, 0, 1]),
  });
  const operation = {
    kind: "unroll" as const,
    center: [0, 0, 0] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
    radius: 2,
    instances: 2,
  };
  const h = harness([source]);
  const result = await runUnrollCommand(
    new ApplicationApi(h.host, h.ops),
    source.id,
    operation,
  );
  expect(h.state.entities).toHaveLength(3);
  expect(h.state.entities[0]).toBe(source);
  expect(h.state.entities[1].positions.length).toBe(18);
  expect(h.state.entities[1].name).toBe("Scan - Unrolled");
  expect(h.state.history).toHaveLength(1);
  expect(result.entityIds).toEqual([h.state.entities[1].id]);
  expect(result.unroll).toMatchObject({
    meshEntityId: h.state.entities[1].id,
    frameEntityId: h.state.entities[2].id,
    sketchId: h.state.authoring.sketches![0].id,
  });
  expect(h.state.entities[2]).toMatchObject({
    kind: "referenceFrame",
    name: "Roll frame",
    visible: false,
    rollMapping: { radius: 2, sourceEntityId: source.id },
  });
  expect(h.state.authoring.sketches).toHaveLength(1);
  expect(h.state.history[0].sketchChanges).toEqual([
    { id: h.state.authoring.sketches![0].id },
  ]);
  const m = harness([source]);
  await m.ops.mesh_process(
    { entityId: source.id, operation: { kind: "scanTools", operation } },
    m.context,
  );
  expect(m.state.entities[1].positions).toEqual(h.state.entities[1].positions);
});

it.each(["averageMesh", "unroll"] as const)(
  "%s gives a keyed source's new owner a distinct saveable identity",
  async (kind) => {
    const { serializeProject, parseProject } = await import("../src/io");
    const { resolveConstructionIdentities } =
      await import("../src/reference-construction-identity");
    const source = entity({
      positions: new Float32Array([2, 0, 0, 0, 2, 0, 2, 0, 1]),
      constructionOrderKey: "00000000000000000000000000000001",
    });
    const reference = plane("reference", 0);
    const h = harness([source, reference]);
    const operation =
      kind === "averageMesh"
        ? { kind, tolerance: 10 }
        : { kind, center: [0, 0, 0], axis: [0, 0, 1], radius: 2 };
    await h.ops.mesh_process(
      {
        entityId: source.id,
        ...(kind === "averageMesh" ? { targetIds: [reference.id] } : {}),
        operation: { kind: "scanTools", operation },
      },
      h.context,
    );
    expect(h.state.entities).toHaveLength(kind === "unroll" ? 4 : 3);
    expect(h.state.entities[0].constructionOrderKey).toBe(
      source.constructionOrderKey,
    );
    expect(h.state.entities[2].constructionOrderKey).not.toBe(
      source.constructionOrderKey,
    );
    expect(() =>
      resolveConstructionIdentities(h.state.entities, []),
    ).not.toThrow();
    expect(
      parseProject(serializeProject("Saveable", h.state.entities)).entities,
    ).toHaveLength(kind === "unroll" ? 4 : 3);
  },
);
