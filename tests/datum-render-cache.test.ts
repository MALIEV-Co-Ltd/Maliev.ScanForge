import { expect, it } from "vitest";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { transformDatumCoordinateStages } from "../src/datum-transform-kernel";
import { expandPlyTopology } from "../src/ply-topology";
import { meshStats } from "../src/geometry";
import {
  cacheScanRenderData,
  prepareScanRenderData,
  scanRenderData,
} from "../src/scan-render-data";
import type { Entity } from "../src/types";

const frames = [
  [0, -1, 0, 3, 1, 0, 0, -2, 0, 0, 1, 5],
  [1, 0, 0, 0.25, 0, 1, 0, 0.5, 0, 0, 1, -0.75],
];

function source(): Entity {
  const indexedMesh = {
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 200, 300,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 1]),
    normals: new Float32Array([-0, 0, 2, 0, -3, 0, 4, 0, 0, 0, 0, -5, 1, 2, 3]),
  };
  return {
    id: "scan",
    name: "scan",
    kind: "mesh",
    positions: expandPlyTopology(indexedMesh),
    normals: expandPlyTopology({
      vertices: indexedMesh.normals,
      triangles: indexedMesh.triangles,
    }),
    indexedMesh,
    visible: true,
    color: "#aaa",
    opacity: 1,
    meshSelection: {
      hidden: [],
      saved: [{ id: "s", name: "saved", triangles: [0] }],
    },
  };
}

function bytes(values: ArrayLike<number>) {
  return new Uint8Array(Float32Array.from(values).buffer);
}

it("caches compact transformed display data without changing native fields or the source cache", async () => {
  const entity = source();
  const mesh = entity.indexedMesh!;
  const streams = [
    entity.positions,
    entity.normals!,
    mesh.vertices,
    mesh.normals!,
  ];
  const before = streams.map(bytes);
  const indices = Uint32Array.from(mesh.triangles);
  const cached = prepareScanRenderData(entity.positions as Float32Array, mesh);
  cacheScanRenderData(entity.positions, cached);
  const executor = createDatumTransformExecutor({
    parallel: false,
    typedNormals: true,
  });
  try {
    const result = await executor.transformScanStages(entity, frames);
    const output = result.entity;
    const indexed = output.indexedMesh!;
    const expected = streams.map((stream, index) =>
      transformDatumCoordinateStages(
        stream,
        frames,
        index === 1 || index === 3,
      ),
    );
    const actual = [
      output.positions,
      output.normals!,
      indexed.vertices,
      indexed.normals!,
    ];
    actual.forEach((stream, index) =>
      expect(bytes(stream)).toEqual(bytes(expected[index])),
    );
    streams.forEach((stream, index) =>
      expect(bytes(stream)).toEqual(before[index]),
    );
    expect(indexed.triangles).toBe(mesh.triangles);
    expect(indexed.triangles).toEqual(indices);
    expect(output.meshSelection).toBe(entity.meshSelection);
    expect(scanRenderData(entity.positions)).toBe(cached);
    const data = scanRenderData(output.positions)!;
    expect(data).toBeDefined();
    expect(data).not.toBe(cached);
    expect(data.indexedMesh).toBe(indexed);
    expect(data.normals?.length).toBe(indexed.vertices.length);
    expect(data.normals!.byteLength).toBeLessThan(
      (output.positions as Float32Array).byteLength,
    );
    const stats = meshStats(output.positions);
    expect(data.bounds).toEqual([...stats.min, ...stats.max]);
    expect(data.stats).toEqual(stats);
    expect(data.radius).toBe(
      Math.hypot(...stats.max.map((n, i) => (n - stats.min[i]) / 2)),
    );
    const prepared = prepareScanRenderData(
      output.positions as Float32Array,
      indexed,
    );
    expect(bytes(data.normals!)).toEqual(bytes(prepared.normals!));
    expect(Array.from(data.normals!.subarray(-3))).toEqual([0, 0, 0]);
    expect(result.execution.physicalWorkers).toBe(0);
  } finally {
    executor.close();
  }
});

it.each(["pointcloud", "unindexed", "stale"] as const)(
  "keeps %s output on its existing uncached display path",
  async (kind) => {
    const entity = source();
    if (kind === "pointcloud") entity.kind = "pointcloud";
    if (kind === "unindexed") entity.indexedMesh = undefined;
    if (kind === "stale")
      entity.indexedMesh!.triangles = new Uint32Array([1, 0, 2, 0, 3, 1]);
    const executor = createDatumTransformExecutor({ parallel: false });
    try {
      const result = await executor.transformScanStages(entity, frames);
      expect(scanRenderData(result.entity.positions)).toBeUndefined();
      expect(scanRenderData(entity.positions)).toBeUndefined();
      if (kind !== "pointcloud")
        expect(result.entity.indexedMesh).toBeUndefined();
      expect(result.entity.kind).toBe(entity.kind);
    } finally {
      executor.close();
    }
  },
);
