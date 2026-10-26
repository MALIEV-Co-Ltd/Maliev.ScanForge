import { expect, it, vi } from "vitest";
import {
  modelChanged,
  restoreModelDisplay,
  seekModelRevision,
  type Revision,
} from "../src/history";
import {
  lockedObjectEdit,
  type ModelCommitPolicy,
} from "../src/object-operations";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import {
  projectEncodingSnapshot,
  restoreEncodingSnapshot,
} from "../src/project-encoding-snapshot";
import type { Entity } from "../src/types";

function mesh(id = "scan"): Entity {
  const positions = new Float32Array([-0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, -0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    id,
    name: id,
    kind: "mesh",
    visible: true,
    color: "#888888",
    opacity: 1,
    positions,
    normals,
    indexedMesh: {
      vertices: positions,
      triangles: new Uint32Array([0, 1, 2]),
      normals,
      geometryNormals: normals.slice(),
      facetNormals: new Float32Array([0, -0, 1]),
    },
  };
}
const revision = (
  entities: Entity[],
  ids: string[],
  label = "Native reconstruct",
) => ({ entities, label, restoreVisibilityFor: ids }) as Revision;
const project = (entities: Entity[]) => ({
  format: "maliev-scanforge" as const,
  version: 1 as const,
  units: "mm" as const,
  name: "Native reconstruction",
  entities,
});
const bits = (a: Float32Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("hex");

it("restores only modeling-owned visibility through undo/redo while preserving display edits and immutable geometry", () => {
  const a = mesh("a"),
    b = mesh("b"),
    unrelated = mesh("other"),
    output = mesh("output");
  const before = [a, b, unrelated];
  const after = [
    { ...a, visible: false, name: "renamed", color: "#123456" },
    { ...b, visible: false },
    { ...unrelated, visible: false, opacity: 0.25 },
    output,
  ];
  const history = [revision(before, ["a", "b"])];
  const undo = seekModelRevision(history, after, [], 0);
  expect(undo.entities.map((e) => e.visible)).toEqual([true, true, false]);
  expect(undo.entities[0].name).toBe("renamed");
  expect(undo.entities[0].color).toBe("#123456");
  expect(undo.entities[2].opacity).toBe(0.25);
  expect(undo.entities[0].positions).toBe(a.positions);
  expect(undo.entities[0].indexedMesh).toBe(a.indexedMesh);
  expect(undo.future[0].restoreVisibilityFor).toEqual(["a", "b"]);
  const redo = seekModelRevision(undo.history, undo.entities, undo.future, 1);
  expect(redo.entities.map((e) => e.visible)).toEqual([
    false,
    false,
    false,
    true,
  ]);
  expect(redo.history[0].restoreVisibilityFor).toEqual(["a", "b"]);
  expect(history[0].entities[0]).toBe(a);
  expect(a.visible).toBe(true);
});

it("unions only visibility provenance crossed by a timeline seek and retains it on both sides", () => {
  const a = mesh("a"),
    b = mesh("b"),
    one = mesh("one"),
    two = mesh("two");
  const initial = [a, b];
  const first = [{ ...a, visible: false }, b, one];
  const second = [{ ...a, visible: false }, { ...b, visible: false }, one, two];
  const current = [
    { ...a, visible: true },
    { ...b, visible: false },
    { ...one, positions: new Float32Array(one.positions) },
    two,
  ];
  const history = [
    revision(initial, ["a"], "First"),
    revision(first, ["b"], "Second"),
    { entities: second, label: "Edit output" },
  ];
  const earlier = seekModelRevision(history, current, [], 1);
  expect(earlier.entities.slice(0, 2).map((e) => e.visible)).toEqual([
    true,
    true,
  ]);
  expect(earlier.history[0].restoreVisibilityFor).toEqual(["a"]);
  expect(earlier.future[0].restoreVisibilityFor).toEqual(["b"]);
  const later = seekModelRevision(
    earlier.history,
    earlier.entities,
    earlier.future,
    3,
  );
  expect(later.entities.slice(0, 2).map((e) => e.visible)).toEqual([
    true,
    false,
  ]);
  expect(later.history[0].restoreVisibilityFor).toEqual(["a"]);
  expect(later.history[1].restoreVisibilityFor).toEqual(["b"]);
});

it("keeps ordinary display toggles outside modeling history and leaves lock checks intact", () => {
  const original = mesh();
  expect(modelChanged([original], [{ ...original, visible: false }])).toBe(
    false,
  );
  expect(
    restoreModelDisplay([original], [{ ...original, visible: false }])[0]
      .visible,
  ).toBe(false);
  const locked = { ...original, locked: true };
  const policy: ModelCommitPolicy = { modelVisibilityFor: [original.id] };
  expect(
    lockedObjectEdit([locked], [{ ...locked, visible: false }], policy),
  ).toBeUndefined();
  expect(
    lockedObjectEdit(
      [locked],
      [{ ...locked, positions: new Float32Array(locked.positions) }],
      policy,
    ),
  ).toBe(locked);
});

it("roundtrips visibility metadata in history/future and preserves M3 normal/facet and shared-buffer aliases", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    const scan = mesh(),
      output = mesh("output"),
      hidden = { ...scan, visible: false };
    const input: ProjectSession = {
      project: project([hidden, output]),
      history: [revision([scan], [scan.id])],
      future: [revision([hidden, output], [scan.id], "Later")],
    };
    const cloned = restoreEncodingSnapshot(
      structuredClone(projectEncodingSnapshot(input)),
    );
    expect(cloned.history[0].restoreVisibilityFor).toEqual([scan.id]);
    expect(cloned.future[0].restoreVisibilityFor).toEqual([scan.id]);
    const decoded = await decodeProjectContents(
      await encodeProjectFileLocally(cloned),
      { sharedReadonlyBuffers: true },
    );
    expect(decoded.history[0].restoreVisibilityFor).toEqual([scan.id]);
    expect(decoded.future[0].restoreVisibilityFor).toEqual([scan.id]);
    const current = decoded.project.entities[0],
      old = decoded.history[0].entities[0],
      future = decoded.future[0].entities[0];
    expect(current.positions).toBe(old.positions);
    expect(current.positions).toBe(future.positions);
    expect((current.positions as Float32Array).buffer).toBeInstanceOf(
      SharedArrayBuffer,
    );
    for (const field of [
      "vertices",
      "triangles",
      "normals",
      "geometryNormals",
      "facetNormals",
    ] as const) {
      expect(current.indexedMesh![field]).toBe(old.indexedMesh![field]);
      expect(current.indexedMesh![field]).toBe(future.indexedMesh![field]);
      if (field !== "triangles")
        expect(bits(current.indexedMesh![field] as Float32Array)).toBe(
          bits(scan.indexedMesh![field] as Float32Array),
        );
    }
    expect(current.normals).toBe(old.normals);
    expect(bits(current.normals as Float32Array)).toBe(
      bits(scan.normals as Float32Array),
    );
    const undo = seekModelRevision(
      decoded.history,
      decoded.project.entities,
      [],
      0,
    );
    expect(undo.entities[0].visible).toBe(true);
    const savedUndo = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: project(undo.entities),
        history: undo.history,
        future: undo.future,
      }),
    );
    expect(savedUndo.future[0].restoreVisibilityFor).toEqual([scan.id]);
    expect(
      seekModelRevision(
        savedUndo.history,
        savedUndo.project.entities,
        savedUndo.future,
        1,
      ).entities[0].visible,
    ).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

async function editManifest(file: Blob, edit: (m: any) => void) {
  const raw = Buffer.from(await file.arrayBuffer()),
    length = raw.readUInt32LE(8),
    m = JSON.parse(raw.subarray(16, 16 + length).toString("utf8"));
  edit(m);
  const encoded = Buffer.from(JSON.stringify(m)),
    header = Buffer.from(raw.subarray(0, 16));
  header.writeUInt32LE(encoded.length, 8);
  return new Blob([header, encoded, raw.subarray(16 + length)]);
}

it.each(["history", "future"] as const)(
  "rejects malformed persisted visibility metadata in %s",
  async (side) => {
    const scan = mesh(),
      input: ProjectSession = {
        project: project([scan]),
        history: [{ entities: [scan], label: "Old" }],
        future: [{ entities: [scan], label: "Next" }],
      };
    const file = await encodeProjectFileLocally(input);
    for (const ids of [
      null,
      "scan",
      [1],
      [""],
      ["scan", "scan"],
      ["x".repeat(1025)],
    ])
      await expect(
        decodeProjectContents(
          await editManifest(file, (m) => {
            m[side][0].restoreVisibilityFor = ids;
          }),
        ),
      ).rejects.toThrow("project file");
    const legacy = await decodeProjectContents(file);
    expect(legacy[side][0].restoreVisibilityFor).toBeUndefined();
  },
);
