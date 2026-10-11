import { describe, expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import type { Entity, MeshSelectionState } from "../src/types";

const entity: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1,
  ]),
  color: "#a6a6a6",
  visible: true,
  opacity: 1,
};
const selection: MeshSelectionState = {
  hidden: [1],
  saved: [
    { id: "front", name: "Front face", triangles: [0] },
    { id: "both", name: "Both faces", triangles: [0, 1] },
  ],
};
const project = (metadata: unknown) =>
  JSON.stringify({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Selections",
    entities: [
      {
        ...entity,
        positions: Array.from(entity.positions),
        meshSelection: metadata,
      },
    ],
  });

describe("mesh selection project storage", () => {
  it("roundtrips sparse hidden slots and named selections through both save paths", async () => {
    for (const kind of ["mesh", "cad"] as const) {
      const source = { ...entity, kind, meshSelection: selection };
      for (const text of [
        serializeProject("Selections", [source]),
        await (await serializeProjectBlob("Selections", [source])).text(),
      ]) {
        const restored = parseProject(text).entities[0];
        expect(restored.meshSelection).toEqual(selection);
        expect(restored.positions).toEqual(Array.from(entity.positions));
        expect(restored.meshSelection).not.toBe(selection);
      }
    }
  });
  it("loads older projects without selection metadata and allows empty sparse sets", async () => {
    expect(
      parseProject(serializeProject("Old", [entity])).entities[0].meshSelection,
    ).toBeUndefined();
    const empty = {
      ...entity,
      meshSelection: {
        hidden: [],
        saved: [{ id: "empty", name: "Empty", triangles: [] }],
      },
    };
    expect(
      parseProject(await (await serializeProjectBlob("Empty", [empty])).text())
        .entities[0].meshSelection,
    ).toEqual(empty.meshSelection);
  });
  it.each(
    [
      null,
      [],
      {},
      { hidden: [], saved: null },
      { hidden: null, saved: [] },
      { hidden: [-1], saved: [] },
      { hidden: [2], saved: [] },
      { hidden: [0.5], saved: [] },
      { hidden: [0, 0], saved: [] },
      { hidden: [1, 0], saved: [] },
      { hidden: [NaN], saved: [] },
      { hidden: [], saved: [null] },
      { hidden: [], saved: [{ id: "s", name: "Name", triangles: [2] }] },
      { hidden: [], saved: [{ id: "s", name: "Name", triangles: [0, 0] }] },
      { hidden: [], saved: [{ id: "s", name: "Name", triangles: [1, 0] }] },
      { hidden: [], saved: [{ id: "s", name: "Name", triangles: "0" }] },
      { hidden: [], saved: [{ id: "", name: "Name", triangles: [] }] },
      { hidden: [], saved: [{ id: "s", name: " ", triangles: [] }] },
      {
        hidden: [],
        saved: [{ id: "s", name: "n".repeat(201), triangles: [] }],
      },
      {
        hidden: [],
        saved: [
          { id: "s", name: "One", triangles: [] },
          { id: "s", name: "Two", triangles: [] },
        ],
      },
    ].map((metadata) => ({ metadata })),
  )(
    "rejects malformed metadata on read and both writes: %j",
    async ({ metadata }) => {
      const source = {
        ...entity,
        meshSelection: metadata as MeshSelectionState,
      };
      expect(() => parseProject(project(metadata))).toThrow("mesh selection");
      expect(() => serializeProject("Invalid", [source])).toThrow(
        "mesh selection",
      );
      await expect(serializeProjectBlob("Invalid", [source])).rejects.toThrow(
        "mesh selection",
      );
    },
  );
});
