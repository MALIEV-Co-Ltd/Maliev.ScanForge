import { expect, it } from "vitest";
import { scanMeshCopy } from "../src/scan-mesh-copy";
import type { Entity } from "../src/types";
it("creates an independent editable mesh while preserving exact CAD surfaces and dependencies", () => {
  const source = {
    id: "cad",
    name: "Part.step",
    kind: "cad",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    kernelId: "native",
    brep: "exact NURBS BRep",
    color: "#999",
    visible: true,
    opacity: 1,
  } satisfies Entity;
  const copy = scanMeshCopy(source, "copy");
  expect(copy.kind).toBe("mesh");
  expect(copy.kernelId).toBeUndefined();
  expect(copy.brep).toBeUndefined();
  expect(copy.normals).toBeUndefined();
  copy.positions[0] = 20;
  expect(source.positions[0]).toBe(0);
  expect(source.brep).toBe("exact NURBS BRep");
  expect(source.kernelId).toBe("native");
});
