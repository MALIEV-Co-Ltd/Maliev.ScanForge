import { expect, it } from "vitest";
import {
  encodeProjectFile,
  decodeProjectFile,
  type ProjectSession,
} from "../src/project-file";
import { serializeProject } from "../src/io";
import type { Entity } from "../src/types";
import { seekModelRevision } from "../src/history";
const entity: Entity = {
  id: "mesh",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array([-0, 0, 0, 1.234, 0, 0, 0, 1, 0]),
  visible: true,
  color: "#ffffff",
  opacity: 1,
};
const session = (): ProjectSession => ({
  project: {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "ชิ้นงาน",
    entities: [entity],
  },
  history: [{ label: "Import", entities: [] }],
  future: [
    { label: "Duplicate", entities: [entity, { ...entity, id: "copy" }] },
  ],
});
it("round trips current state, Unicode names, undo/redo and shared lossless geometry", async () => {
  const source = session(),
    file = await encodeProjectFile(source),
    result = await decodeProjectFile(file);
  expect(result.project.name).toBe(source.project.name);
  expect(result.history).toEqual(source.history);
  expect(result.future[0].label).toBe("Duplicate");
  expect(result.project.entities[0].positions).toEqual(entity.positions);
  expect(Object.is(result.project.entities[0].positions[0], -0)).toBe(true);
  expect(result.future[0].entities[0].positions).toBe(
    result.project.entities[0].positions,
  );
  const undo = seekModelRevision(
    result.history,
    result.project.entities,
    result.future,
    0,
  );
  expect(undo.entities).toEqual([]);
  expect(
    seekModelRevision(undo.history, undo.entities, undo.future, 2).entities,
  ).toHaveLength(2);
});
it("preserves stable project identity in portable files while accepting older files", async () => {
  const source = { ...session(), projectId: "existing-project" };
  expect(
    (await decodeProjectFile(await encodeProjectFile(source))).projectId,
  ).toBe("existing-project");
  expect(
    (await decodeProjectFile(await encodeProjectFile(session()))).projectId,
  ).toBeUndefined();
});
it("retains more than twenty revisions and deduplicates their payloads", async () => {
  const source = session();
  source.history = Array.from({ length: 40 }, (_, i) => ({
    label: `Edit ${i}`,
    entities: [entity],
  }));
  const file = await encodeProjectFile(source),
    result = await decodeProjectFile(file);
  expect(result.history).toHaveLength(40);
  const header = new DataView(await file.slice(0, 16).arrayBuffer());
  const manifest = JSON.parse(
    await file.slice(16, 16 + header.getUint32(8, true)).text(),
  );
  expect(manifest.chunks).toHaveLength(1);
});
it("preserves double precision, exact BREP, CAD edges and normals", async () => {
  const source = session();
  source.project.entities = [
    {
      ...entity,
      positions: [-0, 0, 0, Math.PI, 0, 0, 0, 1, 0],
      brep: "CASCADE Topology\n".repeat(100),
      edgePositions: [0, 0, 0, Math.PI, 0, 0],
      normals: Array(9).fill(1),
    },
  ];
  const result = await decodeProjectFile(await encodeProjectFile(source));
  expect(result.project.entities[0]).toEqual(source.project.entities[0]);
});
it("reads legacy JSON projects with an empty timeline", async () => {
  const result = await decodeProjectFile(
    new Blob([serializeProject("Legacy", [entity])]),
  );
  expect(result.project.name).toBe("Legacy");
  expect(result.history).toEqual([]);
  expect(result.future).toEqual([]);
});
it("rejects truncated and corrupted payloads", async () => {
  const file = await encodeProjectFile(session());
  await expect(
    decodeProjectFile(file.slice(0, file.size - 1)),
  ).rejects.toThrow();
  const bytes = new Uint8Array(await file.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await expect(decodeProjectFile(new Blob([bytes]))).rejects.toThrow();
});
it("compresses representative repeated scan geometry below JSON size", async () => {
  const source = session();
  source.project.entities = [
    {
      ...entity,
      positions: new Float32Array(
        Array.from({ length: 90000 }, (_, i) => (i % 9) / 3),
      ),
    },
  ];
  const file = await encodeProjectFile(source);
  expect(file.size).toBeLessThan(
    new Blob([serializeProject(source.project.name, source.project.entities)])
      .size / 5,
  );
});
it("rejects invalid geometry before saving", async () => {
  const source = session();
  source.history[0].entities = [{ ...entity, positions: [NaN] }];
  await expect(encodeProjectFile(source)).rejects.toThrow(/geometry/);
});
it("stores hidden and saved facet indices as deduplicated unsigned binary chunks", async () => {
  const source = session();
  source.project.entities = [
    {
      ...entity,
      meshSelection: {
        hidden: [0],
        saved: [{ id: "selection", name: "Saved facets", triangles: [0] }],
      },
    },
  ];
  const file = await encodeProjectFile(source);
  expect(
    (await decodeProjectFile(file)).project.entities[0].meshSelection,
  ).toEqual(source.project.entities[0].meshSelection);
  const header = new DataView(await file.slice(0, 16).arrayBuffer());
  const manifest = JSON.parse(
    await file.slice(16, 16 + header.getUint32(8, true)).text(),
  );
  const selection = manifest.records[0].meshSelection;
  expect(selection.hidden.type).toBe("u32");
  expect(selection.hidden.chunk).toBe(selection.saved[0].triangles.chunk);
});
