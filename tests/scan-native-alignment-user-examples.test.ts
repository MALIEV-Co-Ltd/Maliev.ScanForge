import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import first from "./fixtures/alignment-user-ply-source.json";
import second from "./fixtures/alignment-user-ply-2-source.json";
import third from "./fixtures/alignment-user-ply-3-source.json";
import refinement from "./fixtures/alignment-user-refinement.json";
import { nativeRefineAlignmentMeshes } from "../src/scan-native-alignment-surface-controller";
import topology from "./fixtures/alignment-user-target-adjacency.json";
import surface from "./fixtures/alignment-user-target-surface.json";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import type { NoiseQueryNode } from "../src/scan-noise-octree-query";
import { prepareNativeAlignmentSource } from "../src/scan-native-alignment-source";

// Large owner-supplied scans remain outside the repository and default CI suite.
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
function readExample(expected: {
  file: string;
  sha256: string;
  vertices: number;
  triangles: number;
}) {
  const raw = readFileSync(join(folder!, expected.file.split(/[\\/]/).pop()!));
  expect(digest(raw)).toBe(expected.sha256);
  const marker = Buffer.from("end_header\r\n");
  let offset = raw.indexOf(marker) + marker.length;
  if (offset === marker.length - 1) {
    const marker = Buffer.from("end_header\n");
    offset = raw.indexOf(marker) + marker.length;
  }
  expect(offset).toBeGreaterThan(12);
  const vertices = new Float32Array(expected.vertices * 3);
  for (let id = 0; id < expected.vertices; id++)
    for (let axis = 0; axis < 3; axis++)
      vertices[id * 3 + axis] = raw.readFloatLE(offset + id * 24 + axis * 4);
  offset += expected.vertices * 24;
  const triangles = new Uint32Array(expected.triangles * 3);
  for (let id = 0; id < expected.triangles; id++) {
    if (raw[offset] !== 3)
      throw new Error("Example PLY contains a non-triangle face.");
    for (let corner = 0; corner < 3; corner++)
      triangles[id * 3 + corner] = raw.readUInt32LE(offset + 1 + corner * 4);
    offset += 13;
  }
  expect(offset).toBe(raw.length);
  return { vertices, triangles };
}

it.skipIf(!folder).each([first, second, third])(
  "matches full-resolution user source normals and sampling: $file",
  (expected) => {
    const { vertices, triangles } = readExample(expected);
    const began = performance.now();
    const result = prepareNativeAlignmentSource(
      { vertices, triangles },
      expected.budget,
    );
    console.info(
      JSON.stringify({
        file: expected.file,
        prepareMilliseconds: performance.now() - began,
        vertices: expected.vertices,
        triangles: expected.triangles,
      }),
    );
    expect(digest(new Uint8Array(result.normals.buffer))).toBe(
      expected.normalsSha256,
    );
    const flags = Uint32Array.from(result.sampling.flags);
    expect(digest(new Uint8Array(flags.buffer))).toBe(expected.flagsSha256);
    expect(result.sampling.levelCounts).toEqual(expected.levelCounts);
    expect(result.sampling.nodes).toBe(expected.nodes);
    expect(
      result.sampling.flags.flatMap((flag, id) => (flag & 4 ? [id] : [])),
    ).toEqual(expected.selected);
  },
  60000,
);

function countNodes(node: NoiseQueryNode): number {
  return (
    1 +
    Object.values(node.children).reduce(
      (total, child) => total + (child ? countNodes(child) : 0),
      0,
    )
  );
}
it.skipIf(!folder)(
  "matches full native target topology and surface queries on owner scan",
  () => {
    const expected = surface.cases[0],
      links = topology.cases[0];
    const geometry = readExample(expected);
    const prepared = prepareNativeAlignmentSurface(
      geometry.vertices,
      geometry.triangles,
      { minimumExtent: expected.minimumExtent },
    )!;
    const adjacency = prepared.adjacency;
    const hashBuffer = (data: ArrayBufferView) =>
      digest(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    expect(hashBuffer(adjacency.vertexBuckets)).toBe(links.vertexBucketsSha256);
    expect(hashBuffer(adjacency.neighbors)).toBe(links.neighborsSha256);
    expect(hashBuffer(adjacency.neighborEdges)).toBe(links.neighborEdgesSha256);
    expect(hashBuffer(adjacency.triangleFlags)).toBe(links.triangleFlagsSha256);
    expect(
      adjacency.neighbors.reduce((total, id) => total + (id < 0 ? 1 : 0), 0),
    ).toBe(links.boundaryEdges);
    expect(countNodes(prepared.surface.root) - 1).toBe(expected.nodes);
    for (const point of expected.queries) {
      const hit = prepared.query(point.point, point.radius);
      if (point.winner === null) expect(hit).toBeUndefined();
      else
        expect(hit).toEqual({
          distance: point.distance,
          closest: point.closest,
          normal: point.normal,
          openBoundary: point.openBoundary,
        });
    }
  },
  60000,
);

it.skipIf(!folder).each(refinement.cases[0].registrations)(
  "matches full native owner scan refinement: $sourceFile",
  (expected) => {
    const sourceMetadata = [first, second, third].find(
      (input) => input.sha256 === expected.sourceSha256,
    )!;
    const source = readExample(sourceMetadata),
      target = readExample(surface.cases[0]);
    const result = nativeRefineAlignmentMeshes(
      [source],
      target,
      expected.sampleBudget,
      { initialRadius: expected.initialRadius, step: expected.step },
    );
    expect(result.initialError).toBe(expected.initialError);
    expect(result.flags).toEqual([expected.flags]);
    expect(result.parameters).toEqual(expected.parameters);
    expect(result.accepted).toBe(expected.accepted);
    expect(result.best).toBe(expected.best);
    expect(result.matrix).toEqual(expected.matrix);
  },
  120000,
);
