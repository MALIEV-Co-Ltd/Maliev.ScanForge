import { expect, it } from "vitest";
import { scanSegmentPublication } from "../src/scan-segment-publication";
import { scanSplitCutter, isScanSplitCutter } from "../src/scan-split-cutter";
import { DEFAULT_PART_COLOR } from "../src/appearance";
import type { Entity } from "../src/types";
import type { RegionClassification } from "../src/mesh-processing";
import { analyzeIndexedMesh, analyzeMesh } from "../src/mesh-processing";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const source: Entity = {
  id: "source",
  name: "Source",
  source: "source.stl",
  kind: "mesh",
  positions: triangle,
  color: "#ff0000",
  opacity: 0.4,
  visible: true,
  kernelId: "original",
  brep: "original BREP",
  constructionOrderKey: "00000000000000000000000000000001",
};
it("retains original part/classification indices and publishes independent display/history ownership", () => {
  const unrelated = { ...source, id: "other", kernelId: undefined };
  const classification = (kind: "sphere" | "plane"): RegionClassification => ({
    kind,
    samples: 3,
    extent: [1, 1, 1],
    tolerance: 0.01,
    reason: "fixture",
    fit: { kind, center: [0, 0, 0], axis: [0, 0, 1], rms: 0, maxError: 0 },
  });
  const expected = classification("plane"),
    parts = [new Float32Array(), triangle];
  const result = scanSegmentPublication(
    [source, unrelated],
    source.id,
    parts,
    [classification("sphere"), expected],
    () => "new",
  );
  expect(result.created).toHaveLength(1);
  const part = result.created[0];
  expect(part.name).toBe("Source segment 2 · plane");
  expect(part.fit).toEqual(expected.fit);
  expect(part.positions).toBe(triangle);
  expect(part.source).toBe(source.source);
  expect(part.color).toBe(DEFAULT_PART_COLOR);
  expect(part.opacity).toBe(1);
  expect(part.visible).toBe(true);
  expect(part.kernelId).toBeUndefined();
  expect(part.brep).toBeUndefined();
  expect(part.constructionOrderKey).toBeUndefined();
  expect(part.parametric).toBeUndefined();
  expect(result.entities[0].visible).toBe(false);
  expect(result.entities[0].positions).toBe(triangle);
  expect(result.entities[1]).toBe(unrelated);
  expect(source.visible).toBe(true);
  expect(result.policy).toEqual({ modelVisibilityFor: [source.id] });
});
it("rejects locked, empty and malformed publication without mutating source or caller buffers", () => {
  const before = triangle.slice();
  expect(() =>
    scanSegmentPublication([{ ...source, locked: true }], source.id, [
      triangle,
    ]),
  ).toThrow(/locked/);
  expect(() =>
    scanSegmentPublication([source], source.id, [new Float32Array()]),
  ).toThrow(/no meshes/);
  expect(() =>
    scanSegmentPublication([source], source.id, [
      triangle,
      new Float32Array([1, 2, 3]),
    ]),
  ).toThrow();
  expect(triangle).toEqual(before);
  expect(source.visible).toBe(true);
});
it("retains matching indexed topology for each published segment", () => {
  const indexed = {
    vertices: triangle.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const result = scanSegmentPublication(
    [source],
    source.id,
    [new Float32Array(), triangle],
    undefined,
    () => "part",
    [undefined, indexed],
  );
  expect(result.created[0].indexedMesh).toBe(indexed);
  expect(result.created[0].positions).toBe(triangle);
});
it("rejects mismatched indexed segment data atomically", () => {
  const indexed = {
    vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  };
  expect(() =>
    scanSegmentPublication(
      [source],
      source.id,
      [triangle],
      undefined,
      () => "part",
      [indexed],
    ),
  ).toThrow(/indices.*match/i);
  expect(source.visible).toBe(true);
});
it("retains distinct coincident segment vertices through binary reopening", async () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const positions = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.slice(id * 3, id * 3 + 3)]),
  );
  const indexed = { vertices, triangles };
  const published = scanSegmentPublication(
    [source],
    source.id,
    [positions],
    undefined,
    () => "part",
    [indexed],
  );
  const file = await encodeProjectFileLocally({
    project: {
      format: "maliev-scanforge",
      version: 1,
      name: "Segment",
      units: "mm",
      entities: published.entities,
    },
    history: [],
    future: [],
  });
  const reopened = (await decodeProjectFile(file)).project.entities.find(
    (entity) => entity.id === "part",
  )!;
  expect([...reopened.indexedMesh!.triangles]).toEqual([...triangles]);
  expect(
    analyzeIndexedMesh(
      Float64Array.from(reopened.indexedMesh!.vertices),
      Uint32Array.from(reopened.indexedMesh!.triangles),
    ).boundaryEdges,
  ).toBe(6);
  expect(analyzeMesh(reopened.positions).boundaryEdges).toBe(4);
});
it("filters non-triangle cutters and validates persisted reference-plane geometry", () => {
  const pointCloud = { ...source, kind: "pointcloud" as const };
  expect(isScanSplitCutter(pointCloud)).toBe(false);
  expect(() => scanSplitCutter(pointCloud)).toThrow(/triangle/);
  expect(
    isScanSplitCutter({
      ...source,
      kind: "referencePoint",
      positions: new Float32Array(),
    }),
  ).toBe(false);
  const plane = {
    ...source,
    kind: "plane" as const,
    planeFrame: {
      center: [0, 0, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      tangent: [1, 0, 0] as [number, number, number],
    },
  };
  expect(scanSplitCutter(plane)).toEqual({
    plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
  });
  expect(() =>
    scanSplitCutter({
      ...plane,
      planeFrame: { ...plane.planeFrame, normal: [0, 0, 2] },
    }),
  ).toThrow(/plane frame/);
  expect(
    scanSplitCutter({
      ...plane,
      kind: "mesh",
      planeFrame: undefined,
      kernelId: undefined,
    }),
  ).toEqual({ target: triangle, targetIsNonMesh: false });
  expect(
    scanSplitCutter({ ...plane, kind: "mesh", planeFrame: undefined }),
  ).toEqual({ target: triangle, targetIsNonMesh: true });
});
