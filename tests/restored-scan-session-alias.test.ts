import { prepareRestoredProjectDisplays } from "../src/restored-scan-display";
import { scanRenderData } from "../src/scan-render-data";
import { expect, it } from "vitest";
import type { Entity, IndexedMesh } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
  type ProjectSession,
} from "../src/project-file";

function entity(id = "scan", indexedMesh?: IndexedMesh): Entity {
  const mesh = indexedMesh ?? {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    geometryNormals: new Float32Array(9).fill(0.25),
  };
  return {
    id,
    name: id,
    kind: "mesh",
    visible: true,
    color: "#888888",
    opacity: 1,
    indexedMesh: mesh,
    positions: expandPlyTopology(mesh),
  };
}
function session(
  current: Entity,
  history: Entity[] = [current],
  future: Entity[] = [current],
): ProjectSession {
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Aliases",
      entities: [current],
    },
    history: [{ label: "Before", entities: history }],
    future: [{ label: "After", entities: future }],
  };
}
it("preserves a legacy shared index across actual current/history/future project decoding", async () => {
  const input = entity();
  const decoded = await decodeProjectFile(
    await encodeProjectFileLocally(session(input)),
  );
  const current = decoded.project.entities[0].indexedMesh!;
  expect(current.facetNormals).toBeInstanceOf(Float32Array);
  expect(decoded.history[0].entities[0].indexedMesh).toBe(current);
  expect(decoded.future[0].entities[0].indexedMesh).toBe(current);
  expect(input.indexedMesh!.facetNormals).toBeUndefined();
});

it("remaps shared index identities while preserving different metadata and leaving unrelated history lazy", () => {
  const current = entity(),
    shared = { ...current, name: "Before", visible: false },
    unrelated = entity("old");
  // Equal coordinates and normal bits do not establish descriptor identity.
  const input = session(current, [shared, unrelated], [shared, unrelated]);
  const prepared = prepareRestoredProjectDisplays(input),
    result = prepared.project.entities[0];
  expect(prepared.history[0].entities[0].indexedMesh).toBe(result.indexedMesh);
  expect(prepared.future[0].entities[0]).toBe(prepared.history[0].entities[0]);
  expect(prepared.history[0].entities[0].name).toBe("Before");
  expect(prepared.history[0].entities[0].visible).toBe(false);
  expect(prepared.history[0].entities[1]).toBe(unrelated);
  expect(unrelated.indexedMesh!.facetNormals).toBeUndefined();
  expect(scanRenderData(unrelated.positions)).toBeUndefined();
  expect(input.project.entities[0]).toBe(current);
  expect(input.history[0].entities[0]).toBe(shared);
  expect(current.indexedMesh!.facetNormals).toBeUndefined();
  expect(shared.indexedMesh).toBe(current.indexedMesh);
});
it("initializes one shared index once across current descriptors and repeated entity aliases", () => {
  const current = entity(),
    another = entity("another", current.indexedMesh);
  const input = session(current);
  input.project.entities = [current, another, current];
  const result = prepareRestoredProjectDisplays(input);
  expect(result.project.entities[0]).toBe(result.project.entities[2]);
  expect(result.project.entities[0].indexedMesh).toBe(
    result.project.entities[1].indexedMesh,
  );
  expect(result.history[0].entities[0]).toBe(result.project.entities[0]);
  expect(result.future[0].entities[0]).toBe(result.project.entities[0]);
  expect(result.project.entities[1].id).toBe("another");
});
it("does not initialize history-only geometry when restoration is cancelled", () => {
  const current = entity(),
    old = entity("old"),
    input = session(current, [old], [old]),
    controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareRestoredProjectDisplays(input, controller.signal),
  ).toThrow();
  expect(current.indexedMesh!.facetNormals).toBeUndefined();
  expect(old.indexedMesh!.facetNormals).toBeUndefined();
  expect(input.history[0].entities[0]).toBe(old);
});

it("does not merge a distinct history index even when its positions and every existing buffer are shared", () => {
  const current = entity(),
    distinct = {
      ...current,
      id: "distinct",
      indexedMesh: { ...current.indexedMesh! },
    };
  const input = session(current, [distinct], [distinct]);
  const result = prepareRestoredProjectDisplays(input);
  expect(result.history[0].entities[0]).toBe(distinct);
  expect(result.history[0].entities[0].indexedMesh).toBe(distinct.indexedMesh);
  expect(distinct.indexedMesh!.facetNormals).toBeUndefined();
  expect(result.project.entities[0].indexedMesh).not.toBe(distinct.indexedMesh);
});
