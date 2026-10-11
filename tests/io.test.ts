import { describe, expect, it } from "vitest";
import {
  parseMesh,
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validatePositions,
} from "../src/io";
import type { Entity } from "../src/types";
const entity: Entity = {
  id: "test",
  name: "Triangle",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  color: "#00ffaa",
  opacity: 1,
};
describe("file boundaries", () => {
  it("roundtrips independent project geometry and strips ephemeral handles", () => {
    const saved = serializeProject("Project", [
      { ...entity, kernelId: "ephemeral", brep: "DBRep_DrawableShape\n" },
    ]);
    expect(saved).not.toContain("ephemeral");
    const project = parseProject(saved);
    expect(project.entities[0].positions).toEqual(entity.positions);
    expect(project.entities[0].brep).toBe("DBRep_DrawableShape\n");
  });
  it("rejects foreign versions, invalid coordinates, duplicate IDs and invalid colors", () => {
    const valid = JSON.parse(serializeProject("Project", [entity]));
    expect(() =>
      parseProject(JSON.stringify({ ...valid, version: 2 })),
    ).toThrow();
    expect(() =>
      parseProject(JSON.stringify({ ...valid, entities: [entity, entity] })),
    ).toThrow();
    expect(() =>
      parseProject(
        JSON.stringify({
          ...valid,
          entities: [{ ...entity, color: "url(remote)" }],
        }),
      ),
    ).toThrow();
    expect(() => validatePositions([0, 0, NaN, 1, 0, 0, 0, 1, 0])).toThrow();
    expect(() => validatePositions([0, 0, 0])).toThrow();
  });
  it("imports an ASCII STL triangle preserving millimetre coordinates", () => {
    const stl =
      "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid triangle";
    expect(
      Array.from(parseMesh(new TextEncoder().encode(stl).buffer, "stl")),
    ).toEqual([0, 0, 0, 10, 0, 0, 0, 5, 0]);
  });
  it("imports OBJ triangles and rejects empty meshes and point-cloud PLY", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";
    expect(
      Array.from(parseMesh(new TextEncoder().encode(obj).buffer, "obj")),
    ).toEqual(entity.positions);
    expect(() =>
      parseMesh(new TextEncoder().encode("v 0 0 0").buffer, "obj"),
    ).toThrow();
    const ply =
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n";
    expect(() =>
      parseMesh(new TextEncoder().encode(ply).buffer, "ply"),
    ).toThrow("Point clouds");
  });
  it("preserves typed geometry and more than 100 objects in v1 project JSON", async () => {
    const entities = Array.from({ length: 101 }, (_, i) => ({
      ...entity,
      id: String(i),
      positions: new Float32Array(entity.positions),
      kernelId: "transient",
    }));
    const serialized = serializeProject("Many objects", entities);
    expect(parseProject(serialized).entities).toHaveLength(101);
    const blob = await serializeProjectBlob("Many objects", entities);
    expect(parseProject(await blob.text()).entities[100].positions).toEqual(
      entity.positions,
    );
    expect(await blob.text()).not.toContain("transient");
  });
});
