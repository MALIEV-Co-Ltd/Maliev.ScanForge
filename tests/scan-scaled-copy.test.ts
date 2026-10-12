import { expect, it } from "vitest";
import { scaledMeshCopy } from "../src/scan-scaled-copy";
import type { Entity } from "../src/types";
import capture from "./fixtures/scale-geometry-native.json";

it.each(capture.cases)(
  "adopts the native $name scale preview at $factor into a distinct object",
  (entry) => {
    const fromBits = (hex: string) =>
      new Float32Array(
        Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16)).buffer,
      );
    const original: Entity = {
      id: "original",
      name: "Scan",
      kind: "mesh",
      positions: fromBits(entry.inputBits),
      color: "#778899",
      opacity: 0.7,
      visible: false,
      normals: [1, 0, 0],
      edgePositions: [0, 0, 0],
      source: "fixture.stl",
      scanSource: { bytes: 1, triangles: 2, displayedTriangles: 1 },
      surfaceScanId: "old-fit",
    };
    const output = fromBits(entry.nativeBits);
    const copy = scaledMeshCopy(original, output, "copy");
    expect(copy.positions).toBe(output);
    expect(new Uint8Array(copy.positions.buffer)).toEqual(
      new Uint8Array(output.buffer),
    );
    expect(copy).toMatchObject({
      id: "copy",
      name: "Scan (scaled)",
      kind: "mesh",
      visible: true,
      color: original.color,
      opacity: original.opacity,
      source: original.source,
    });
    expect(original.visible).toBe(false);
    expect(new Uint8Array(new Float32Array(original.positions).buffer)).toEqual(
      new Uint8Array(fromBits(entry.inputBits).buffer),
    );
    for (const field of [
      "normals",
      "edgePositions",
      "fit",
      "surfacePatch",
      "surfaceScanId",
      "scanSource",
      "meshSelection",
      "kernelId",
      "brep",
      "parametric",
    ])
      expect(field in copy).toBe(false);
  },
);

it("rejects invalid copy identity, incompatible preview and exact CAD source", () => {
  const source: Entity = {
    id: "source",
    name: "Scan",
    kind: "mesh",
    positions: new Float32Array(9),
    color: "#aaa",
    opacity: 1,
    visible: true,
  };
  for (const id of ["", "source"])
    expect(() => scaledMeshCopy(source, new Float32Array(9), id)).toThrow(
      "distinct",
    );
  for (const p of [
    new Float32Array(),
    new Float32Array(18),
    new Float32Array(9).fill(NaN),
  ])
    expect(() => scaledMeshCopy(source, p, "copy")).toThrow("does not match");
  expect(() =>
    scaledMeshCopy(
      { ...source, kernelId: "exact" },
      new Float32Array(9),
      "copy",
    ),
  ).toThrow("mesh source");
});
