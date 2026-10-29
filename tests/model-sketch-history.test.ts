import { expect, it } from "vitest";
import { seekModelRevision, type Revision } from "../src/history";
import {
  applyModelSketchChanges,
  captureModelSketchChanges,
  prepareModelSketchPublication,
} from "../src/model-sketch-history";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import type { Entity, Project, SavedSketch } from "../src/types";

const saved = (id: string, x = 0): SavedSketch => ({
  id,
  name: id,
  sketch: {
    version: 1,
    points: [{ id: "a", x, y: 0 }],
    segments: [],
    constraints: [],
  },
});
const original = saved("original"),
  generated = { ...saved("generated"), visible: true },
  other = saved("other");

it("retains signed facet-normal bytes with owned history in manifest 6 and rejects older feature versions", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const facetNormals = new Float32Array([-0, 0.6, 0.8]);
  const mesh: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions,
    indexedMesh: {
      vertices: positions,
      triangles: new Uint32Array([0, 1, 2]),
      facetNormals,
    },
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const file = await encodeProjectFile({
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Combined",
      entities: [mesh],
      authoring: { sketches: [generated] },
    },
    history: [
      {
        entities: [mesh],
        label: "Unroll",
        sketchChanges: [{ id: generated.id }],
      },
    ],
    future: [],
  });
  const reopened = await decodeProjectFile(file);
  const bits = (values: ArrayLike<number>) =>
    Buffer.from(Float32Array.from(values).buffer).toString("hex");
  expect(bits(reopened.project.entities[0].indexedMesh!.facetNormals!)).toBe(
    bits(facetNormals),
  );
  expect(bits(reopened.history[0].entities[0].indexedMesh!.facetNormals!)).toBe(
    bits(facetNormals),
  );
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const headerView = new DataView(header.buffer),
    length = headerView.getUint32(8, true);
  const manifest = JSON.parse(await file.slice(16, 16 + length).text());
  expect(manifest.version).toBe(6);
  manifest.version = 5;
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  headerView.setUint32(8, bytes.length, true);
  await expect(
    decodeProjectFile(new Blob([header, bytes, file.slice(16 + length)])),
  ).rejects.toThrow();
});

it("publishes only fresh owned sketch identities without replacing unrelated authoring", () => {
  const authoring = { sketches: [original], activeSketchId: original.id };
  const next = prepareModelSketchPublication(authoring, [generated]);
  expect(next.authoring.sketches).toEqual([original, generated]);
  expect(next.authoring.activeSketchId).toBe(original.id);
  expect(next.changes).toEqual([{ id: generated.id }]);
  expect(authoring.sketches).toEqual([original]);
  expect(() => prepareModelSketchPublication(authoring, [original])).toThrow(
    /identity/i,
  );
  expect(() =>
    prepareModelSketchPublication(authoring, [generated, generated]),
  ).toThrow(/identity/i);
});

it("captures edited owned values for redo while preserving unrelated edits and order", () => {
  const owned = saved("generated", 42),
    editedOriginal = saved("original", 7);
  const current = {
    sketches: [editedOriginal, owned, other],
    activeSketchId: owned.id,
  };
  const remove = [{ id: owned.id }];
  const redo = captureModelSketchChanges(current, remove);
  const undone = applyModelSketchChanges(current, remove);
  expect(undone.sketches).toEqual([editedOriginal, other]);
  expect(undone.activeSketchId).toBeUndefined();
  expect(applyModelSketchChanges(undone, redo).sketches).toEqual(
    current.sketches,
  );
  expect(current.sketches).toHaveLength(3);
});

it("seeks across model-only edits and multiple owned transactions in both directions", () => {
  const history: Revision[] = [
    { entities: [], label: "Unroll A", sketchChanges: [{ id: "generated" }] },
    { entities: [], label: "Mesh only" },
    { entities: [], label: "Unroll B", sketchChanges: [{ id: "other" }] },
  ];
  const authoring = {
    sketches: [
      saved("original", 9),
      saved("generated", 11),
      saved("other", 13),
    ],
  };
  const undo = seekModelRevision(history, [], [], 0, authoring);
  expect(undo.authoring?.sketches).toEqual([saved("original", 9)]);
  const changed = {
    ...undo.authoring!,
    sketches: [saved("original", 27), saved("later")],
  };
  const redo = seekModelRevision(
    undo.history,
    undo.entities,
    undo.future,
    3,
    changed,
  );
  expect(redo.authoring?.sketches).toEqual([
    saved("original", 27),
    saved("generated", 11),
    saved("other", 13),
    saved("later"),
  ]);
  expect(history[0].sketchChanges).toEqual([{ id: "generated" }]);
});

it("preserves unrelated active sketches and rejects malformed target records", () => {
  const current = {
    sketches: [original, generated],
    activeSketchId: original.id,
  };
  expect(
    applyModelSketchChanges(current, [{ id: generated.id }]).activeSketchId,
  ).toBe(original.id);
  for (const changes of [
    [{ id: "generated", value: saved("wrong"), index: 0 }],
    [{ id: "generated", value: generated, index: -1 }],
    [{ id: "generated" }, { id: "generated" }],
    [{ id: "generated", extra: true }],
  ])
    expect(() => applyModelSketchChanges(current, changes as never)).toThrow(
      /sketch/i,
    );
});

it("round trips owned sketch deltas on both sides of a binary timeline", async () => {
  const project: Project = {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Owned",
    entities: [],
    authoring: { sketches: [original, generated] },
  };
  const source = {
    project,
    history: [
      { entities: [], label: "Unroll", sketchChanges: [{ id: generated.id }] },
    ],
    future: [
      {
        entities: [],
        label: "Unroll again",
        sketchChanges: [{ id: other.id, value: other, index: 2 }],
      },
    ],
  };
  const reopened = await decodeProjectFile(await encodeProjectFile(source));
  expect(reopened.history).toEqual(source.history);
  expect(reopened.future).toEqual(source.future);
  const undo = seekModelRevision(
    reopened.history,
    [],
    reopened.future,
    0,
    reopened.project.authoring,
  );
  expect(undo.authoring?.sketches).toEqual([original]);
  const redo = seekModelRevision(
    undo.history,
    [],
    undo.future,
    2,
    undo.authoring,
  );
  expect(redo.authoring?.sketches).toEqual([original, generated, other]);
});
