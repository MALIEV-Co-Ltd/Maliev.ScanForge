import { expect, it, vi } from "vitest";
import { restoreModelDisplay, seekModelRevision } from "../src/history";
import {
  decodeProjectFile,
  encodeProjectFileLocally,
} from "../src/project-file";
import { expandPlyTopology } from "../src/ply-topology";
import { noiseNormals } from "../src/scan-native-noise";
import { scanDisplayBuffers } from "../src/scan-display-buffers";
import { createOperations } from "../src/automation/operations";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import type { Entity, IndexedMesh } from "../src/types";

function legacyEntity(): Entity {
  const indexedMesh: IndexedMesh = {
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 1, 0, 0, 0, 0.1]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 1]),
    normals: new Float32Array(12).fill(2),
  };
  return {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    visible: true,
    color: "#888888",
    opacity: 1,
    positions: expandPlyTopology(indexedMesh),
    indexedMesh,
  };
}

it("initializes native computed state on shared history activation without changing retained geometry", () => {
  const original = legacyEntity();
  const activated = restoreModelDisplay([original], [])[0];
  expect(activated.indexedMesh!.geometryNormals).toEqual(
    noiseNormals(original.indexedMesh!),
  );
  expect(original.indexedMesh!.geometryNormals).toBeUndefined();
  expect(activated.positions).toBe(original.positions);
  expect(activated.indexedMesh!.vertices).toBe(original.indexedMesh!.vertices);
  expect(activated.indexedMesh!.normals).toBe(original.indexedMesh!.normals);
  const displayed = scanDisplayBuffers(
    activated.positions,
    activated.indexedMesh,
    undefined,
  );
  expect(displayed.indexed).toBe(true);
  expect(displayed.normals).toBe(activated.indexedMesh!.geometryNormals);
  expect(displayed.normals![1]).toBeCloseTo(Math.SQRT1_2);
  expect(restoreModelDisplay([activated], [])[0].indexedMesh).toBe(
    activated.indexedMesh,
  );
});

it("exposes the same computed state after legacy open, MCP undo/redo and timeline seek", async () => {
  const older = legacyEntity(),
    current = legacyEntity();
  current.indexedMesh!.geometryNormals = new Float32Array(12).fill(0.25);
  const decoded = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        name: "Legacy",
        units: "mm",
        entities: [current],
      },
      history: [{ label: "Modify", entities: [older] }],
      future: [],
    }),
  );
  let state = {
    entities: decoded.project.entities,
    history: decoded.history,
    future: decoded.future,
  };
  const retained = state.history[0].entities[0];
  const host = {
    snapshot: () => state,
    undo: () => {
      state = seekModelRevision(
        state.history,
        state.entities,
        state.future,
        state.history.length - 1,
      );
    },
    redo: () => {
      state = seekModelRevision(
        state.history,
        state.entities,
        state.future,
        state.history.length + 1,
      );
    },
  } as unknown as WorkspaceHost;
  const context = {
    check: vi.fn(),
    signal: new AbortController().signal,
    artifact: (text: string) => JSON.parse(text),
  } as unknown as CommandContext;
  const operations = createOperations(host);
  await operations.history_undo({}, context);
  const normals = state.entities[0].indexedMesh!.geometryNormals;
  expect(normals).toEqual(noiseNormals(retained.indexedMesh!));
  expect(retained.indexedMesh!.geometryNormals).toBeUndefined();
  const inspected = (await operations.object_get(
    { entityId: "scan", includeGeometry: true },
    context,
  )) as { geometry: { indexedMesh: { geometryNormals: number[] } } };
  expect(inspected.geometry.indexedMesh.geometryNormals).toEqual(
    Array.from(normals!),
  );
  await operations.history_redo({}, context);
  expect(state.entities[0].indexedMesh!.geometryNormals).toEqual(
    current.indexedMesh!.geometryNormals,
  );
  await operations.history_undo({}, context);
  expect(state.entities[0].indexedMesh!.geometryNormals).toBe(normals);
  expect(
    scanDisplayBuffers(
      state.entities[0].positions,
      state.entities[0].indexedMesh,
      undefined,
    ).normals,
  ).toBe(normals);
});
