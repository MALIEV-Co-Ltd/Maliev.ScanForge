import { expect, it, vi, afterEach } from "vitest";
import type { Entity, Project } from "../src/types";
import {
  indexedMeshMatches,
  retainIndexedMesh,
  transformIndexedMesh,
} from "../src/indexed-mesh";
import { expandPlyTopology } from "../src/ply-topology";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validateProject,
} from "../src/io";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import type { WorkspaceHost, CommandContext } from "../src/automation/api";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
function mesh(): Entity {
  const indexedMesh = {
    vertices: new Float32Array([9, 9, 9, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]),
    triangles: new Uint32Array([3, 2, 1, 1, 4, 3]),
  };
  return {
    id: "indexed",
    name: "Indexed scan",
    kind: "mesh",
    positions: expandPlyTopology(indexedMesh),
    indexedMesh,
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
}
function project(entities: Entity[]): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    name: "Indexed",
    units: "mm",
    entities,
  };
}
it("preserves original vertex IDs, unused vertices and undo coordinates through transforms", () => {
  const before = mesh();
  const original = Array.from(before.indexedMesh!.vertices);
  const transformed = transformIndexedMesh(
    before,
    [12, -8, 3],
    [17, 32, -81],
    1.5,
  );
  expect(
    indexedMeshMatches(transformed.indexedMesh, transformed.positions),
  ).toBe(true);
  expect(transformed.indexedMesh!.triangles).toBe(
    before.indexedMesh!.triangles,
  );
  expect(transformed.indexedMesh!.vertices.length).toBe(original.length);
  expect(Array.from(before.indexedMesh!.vertices)).toEqual(original);
  expect(Array.from(transformed.indexedMesh!.vertices).slice(0, 3)).not.toEqual(
    original.slice(0, 3),
  );
});
it("retains metadata edits and invalidates geometry changes without changing undo snapshots", () => {
  const before = mesh();
  const renamed = { ...before, name: "Renamed" };
  expect(retainIndexedMesh(renamed)).toBe(renamed);
  const positions = new Float32Array(before.positions);
  positions[0] += 1;
  expect(
    retainIndexedMesh({ ...before, positions }).indexedMesh,
  ).toBeUndefined();
  expect(indexedMeshMatches(before.indexedMesh, before.positions)).toBe(true);
  expect(
    retainIndexedMesh({ ...before, kind: "cad" }).indexedMesh,
  ).toBeUndefined();
});
it.each(["json", "blob", "binary"])(
  "preserves topology through %s saving",
  async (format) => {
    const source = mesh();
    const output =
      format === "json"
        ? parseProject(serializeProject("Indexed", [source]))
        : format === "blob"
          ? parseProject(
              await (await serializeProjectBlob("Indexed", [source])).text(),
            )
          : (
              await decodeProjectFile(
                await encodeProjectFile({
                  project: project([source]),
                  history: [{ label: "Imported", entities: [source] }],
                  future: [],
                }),
              )
            ).project;
    expect(Array.from(output.entities[0].indexedMesh!.vertices)).toEqual(
      Array.from(source.indexedMesh!.vertices),
    );
    expect(Array.from(output.entities[0].indexedMesh!.triangles)).toEqual([
      3, 2, 1, 1, 4, 3,
    ]);
    expect(
      indexedMeshMatches(
        output.entities[0].indexedMesh,
        output.entities[0].positions,
      ),
    ).toBe(true);
  },
);
it("omits stale live topology from saving and retains original topology in undo history", async () => {
  const before = mesh(),
    after = { ...before, positions: new Float32Array(9) };
  const output = await decodeProjectFile(
    await encodeProjectFile({
      project: project([after]),
      history: [{ label: "Before edit", entities: [before] }],
      future: [],
    }),
  );
  expect(output.project.entities[0].indexedMesh).toBeUndefined();
  expect(output.history[0].entities[0].indexedMesh).toBeDefined();
  expect(
    parseProject(serializeProject("Edited", [after])).entities[0].indexedMesh,
  ).toBeUndefined();
});
it.each([NaN, -1, 5, 1.5])(
  "rejects malformed or stale project indices: %s",
  (bad) => {
    const entity = mesh();
    entity.indexedMesh = {
      ...entity.indexedMesh!,
      triangles: [bad, 2, 1, 1, 4, 3],
    };
    expect(() => validateProject(project([entity]))).toThrow(
      "indexed mesh topology",
    );
  },
);
it("retains indexed import topology and exposes counts through the MCP boundary", async () => {
  const source = mesh();
  vi.mocked(importScan).mockImplementationOnce(async (_file, options) => {
    options?.onIndexedMesh?.(
      source.indexedMesh as {
        vertices: Float32Array<ArrayBuffer>;
        triangles: Uint32Array<ArrayBuffer>;
      },
    );
    return source.positions as Float32Array;
  });
  let entities: Entity[] = [];
  const host = {
    snapshot: () => ({ entities, history: [], future: [], authoring: {} }),
    commit: (next: Entity[]) => {
      entities = next;
    },
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
    artifactBlob: () => new File(["scan"], "scan.ply"),
  } as unknown as CommandContext;
  const operations = createOperations(host);
  await operations.project_import({ artifactId: "scan" }, context);
  expect(entities[0].indexedMesh).toBe(source.indexedMesh);
  expect(
    ((await operations.project_get({}, context)) as { objects: unknown[] })
      .objects[0],
  ).toMatchObject({ indexedTopology: { vertices: 5, triangles: 2 } });
  await operations.mesh_transform(
    {
      entityId: entities[0].id,
      translation: [1, 2, 3],
      rotation: [7, 13, 21],
      scale: 2,
    },
    context,
  );
  expect(
    indexedMeshMatches(entities[0].indexedMesh, entities[0].positions),
  ).toBe(true);
  expect(entities[0].indexedMesh!.triangles).toBe(
    source.indexedMesh!.triangles,
  );
});
it("applies import units and origin placement to render and indexed coordinates in the real worker", async () => {
  const messages: {
    positions?: Float32Array;
    indexedMesh?: Entity["indexedMesh"];
    error?: string;
  }[] = [];
  const scope = {
    onmessage: null as unknown as (event: { data: unknown }) => Promise<void>,
    postMessage: (message: (typeof messages)[number]) => messages.push(message),
  };
  vi.stubGlobal("self", scope);
  await import("../src/import-worker");
  const ascii =
    "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n99 99 99\n0 0 1\n2 0 1\n0 2 1\n3 1 2 3\n";
  await scope.onmessage({
    data: {
      file: new Blob([ascii]),
      extension: "ply",
      unit: "cm",
      placeAtOrigin: true,
    },
  });
  const result = messages.at(-1)!;
  expect(result.error).toBeUndefined();
  expect([...result.positions!]).toEqual([-10, -10, 0, 10, -10, 0, -10, 10, 0]);
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  expect(Array.from(result.indexedMesh!.vertices).slice(0, 3)).toEqual([
    980, 980, 980,
  ]);
});
