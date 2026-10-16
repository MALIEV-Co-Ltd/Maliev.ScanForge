import { expect, it, vi } from "vitest";
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

it("adopts supplied immutable preview output without copying the discarded source buffer", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const source = {
    id: "source",
    name: "Scan",
    kind: "mesh",
    positions,
    color: "#fff",
    visible: true,
    opacity: 1,
  } satisfies Entity;
  const slice = vi.spyOn(positions, "slice");
  const output = new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]);
  try {
    const copy = scanMeshCopy(source, "output", output);
    expect(copy.positions).toBe(output);
    expect(source.positions).toBe(positions);
    expect(slice).not.toHaveBeenCalled();
  } finally {
    slice.mockRestore();
  }
});
