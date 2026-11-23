import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Entity, Project } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches, retainIndexedMesh } from "../src/indexed-mesh";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validateProject,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { createOperations } from "../src/automation/operations";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import { digestEntityGeometry } from "../src/geometry-digest";
import { transformPositions } from "../src/geometry";

function fixture(): Entity {
  const indexedMesh = {
    vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 9, 8, 7]),
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array([2, 1, 0, 2, 1, 0, 2, 1, 0, 8, 7, 6]),
    geometryNormals: new Float32Array([
      0.125, 0.25, 0.5, -0.5, 0.25, 0.125, 0.75, -0.25, 0.5, 0, 0, 0,
    ]),
  };
  return {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions: expandPlyTopology(indexedMesh),
    indexedMesh,
    visible: true,
    color: "#888888",
    opacity: 1,
  };
}
function project(entity: Entity): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    name: "Normals",
    units: "mm",
    entities: [entity],
  };
}
function values(entity: Entity) {
  return Array.from(entity.indexedMesh!.geometryNormals!);
}
describe("stored computed geometry normals", () => {
  it("transforms computed normals through the shared MCP operation and retains undo input", async () => {
    const source = fixture();
    let entities = [source];
    const history: Entity[][] = [];
    const host = {
      snapshot: () => ({ entities, history: [], future: [], authoring: {} }),
      commit: (next: Entity[]) => {
        history.push(entities);
        entities = next;
      },
    } as unknown as WorkspaceHost;
    const context = {
      signal: new AbortController().signal,
      check: vi.fn(),
      progress: vi.fn(),
      artifact: (value: string) => JSON.parse(value),
    } as unknown as CommandContext;
    const operations = createOperations(host),
      before = values(source);
    await operations.mesh_transform(
      {
        entityId: source.id,
        translation: [10, 20, 30],
        rotation: [0, 0, 90],
        scale: 3,
      },
      context,
    );
    expect(values(entities[0])).toEqual(
      Array.from(
        transformPositions(
          source.indexedMesh!.geometryNormals!,
          [0, 0, 0],
          [0, 0, 90],
          1,
        ),
      ),
    );
    expect(history).toHaveLength(1);
    expect(history[0][0]).toBe(source);
    expect(values(source)).toEqual(before);
    const inspected = (await operations.object_get(
      { entityId: source.id, includeGeometry: true },
      context,
    )) as { geometry: { indexedMesh: { geometryNormals: number[] } } };
    expect(inspected.geometry.indexedMesh.geometryNormals).toEqual(
      values(entities[0]),
    );
  });
  it.each([
    ["short", [0, 1, 0]],
    ["sparse", new Array(12)],
    ["nonfinite", [NaN, ...new Array(11).fill(0)]],
    ["overflow", [1e300, ...new Array(11).fill(0)]],
    ["unsupported carrier", new Float64Array(12)],
  ])("rejects %s computed fields before project publication", (_name, bad) => {
    const entity = fixture();
    entity.indexedMesh!.geometryNormals = bad as number[];
    expect(indexedMeshMatches(entity.indexedMesh, entity.positions)).toBe(
      false,
    );
    expect(() => validateProject(project(entity))).toThrow(
      "indexed mesh topology",
    );
  });

  it.each(["json", "streamed-json", "binary"] as const)(
    "retains separate computed and scanner fields through %s",
    async (format) => {
      const entity = fixture(),
        before = values(entity);
      const output =
        format === "json"
          ? parseProject(serializeProject("Normals", [entity]))
          : format === "streamed-json"
            ? parseProject(
                await (await serializeProjectBlob("Normals", [entity])).text(),
              )
            : (
                await decodeProjectContents(
                  await encodeProjectFileLocally({
                    project: project(entity),
                    history: [],
                    future: [],
                  }),
                )
              ).project;
      expect(values(output.entities[0])).toEqual(before);
      expect(Array.from(output.entities[0].indexedMesh!.normals!)).toEqual(
        Array.from(entity.indexedMesh!.normals!),
      );
      expect(values(entity)).toEqual(before);
      expect(entity.indexedMesh!.geometryNormals!.length).toBe(12);
    },
  );

  it("keeps current, undo and redo normal records distinct and preserves Float32 bits", async () => {
    const before = fixture(),
      after = fixture(),
      future = fixture();
    before.indexedMesh!.geometryNormals![0] = -0;
    after.indexedMesh!.geometryNormals![0] = Math.fround(0.1);
    future.indexedMesh!.geometryNormals![0] = Math.fround(0.2);
    const restored = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: project(after),
        history: [{ label: "Before", entities: [before] }],
        future: [{ label: "After", entities: [future] }],
      }),
    );
    for (const [actual, expected] of [
      [restored.project.entities[0], after],
      [restored.history[0].entities[0], before],
      [restored.future[0].entities[0], future],
    ]) {
      const a = actual.indexedMesh!.geometryNormals as Float32Array;
      const e = expected.indexedMesh!.geometryNormals as Float32Array;
      expect(a).toBeInstanceOf(Float32Array);
      expect(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).toEqual(
        new Uint8Array(e.buffer, e.byteOffset, e.byteLength),
      );
      expect(e.byteLength).toBe(48);
    }
  });

  it("accepts old projects without the optional computed field", async () => {
    const entity = fixture();
    delete entity.indexedMesh!.geometryNormals;
    expect(indexedMeshMatches(entity.indexedMesh, entity.positions)).toBe(true);
    const output = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: project(entity),
        history: [],
        future: [],
      }),
    );
    expect(
      output.project.entities[0].indexedMesh!.geometryNormals,
    ).toBeUndefined();
  });

  it("invalidates computed state together with stale topology while preserving undo input", () => {
    const entity = fixture();
    const edited = retainIndexedMesh({
      ...entity,
      positions: new Float32Array(9),
    });
    expect(edited.indexedMesh).toBeUndefined();
    expect(entity.indexedMesh!.geometryNormals).toHaveLength(12);
  });

  it("exposes the computed field through the existing MCP geometry artifact and digest", async () => {
    const entity = fixture();
    const host = {
      snapshot: () => ({ entities: [entity] }),
    } as unknown as WorkspaceHost;
    const context = {
      signal: new AbortController().signal,
      check: vi.fn(),
      progress: vi.fn(),
      artifact: (text: string) => JSON.parse(text),
    } as unknown as CommandContext;
    const operations = createOperations(host);
    const inspected = (await operations.object_get(
      { entityId: entity.id, includeGeometry: true },
      context,
    )) as {
      geometry: {
        indexedMesh: { geometryNormals: number[]; normals: number[] };
      };
    };
    expect(inspected.geometry.indexedMesh.geometryNormals).toEqual(
      values(entity),
    );
    expect(inspected.geometry.indexedMesh.normals).toEqual(
      Array.from(entity.indexedMesh!.normals!),
    );
    const result = (await operations.object_geometry_digest(
      { entityId: entity.id },
      context,
    )) as Awaited<ReturnType<typeof digestEntityGeometry>>;
    const carrier = entity.indexedMesh!.geometryNormals as Float32Array;
    expect(
      result.buffers.find((b) => b.path === "indexedMesh.geometryNormals"),
    ).toMatchObject({
      encoding: "f32",
      elements: 12,
      rawBytes: 48,
      sha256: createHash("sha256")
        .update(new Uint8Array(carrier.buffer))
        .digest("hex"),
    });
    expect(context.check).toHaveBeenCalled();
  });

  it("changes the computed digest without changing authored scanner values", async () => {
    const before = fixture(),
      after = fixture();
    after.indexedMesh!.geometryNormals![0] = -0.5;
    const a = await digestEntityGeometry(before),
      b = await digestEntityGeometry(after);
    expect(
      a.buffers.find((f) => f.path === "indexedMesh.normals")!.sha256,
    ).toBe(b.buffers.find((f) => f.path === "indexedMesh.normals")!.sha256);
    const first = a.buffers.find(
      (f) => f.path === "indexedMesh.geometryNormals",
    );
    const second = b.buffers.find(
      (f) => f.path === "indexedMesh.geometryNormals",
    );
    expect(first).toBeDefined();
    expect(first!.sha256).not.toBe(second?.sha256);
  });
});
