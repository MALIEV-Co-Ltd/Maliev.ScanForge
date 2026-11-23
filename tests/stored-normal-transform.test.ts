import { expect, it } from "vitest";
import type { Entity } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";
import { transformIndexedMesh } from "../src/indexed-mesh";
import { transformPositions } from "../src/geometry";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { transformDatumScan } from "../src/datum-alignment";
import { transformDatumCoordinateStages } from "../src/datum-transform-kernel";
import { noiseNormals } from "../src/scan-native-noise";
import { scanRenderData } from "../src/scan-render-data";
import { scanDisplayBuffers } from "../src/scan-display-buffers";

const frames = [
  [
    0.9659258262890683, -0.25881904510252074, 0, 1e7, 0.25881904510252074,
    0.9659258262890683, 0, -1e7, 0, 0, 1, 0.1,
  ],
  [
    1, 0, 0, -1e7, 0, 0.8660254037844387, -0.5, 1e7, 0, 0.5, 0.8660254037844387,
    -0.1,
  ],
];
const bits = (values: ArrayLike<number>) =>
  Buffer.from(Float32Array.from(values).buffer).toString("hex");
function fixture(stored = true): Entity {
  const indexedMesh = {
    vertices: new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 1, 0, 0, 0, 0.1, 9, 8, 7,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 1]),
    normals: new Float32Array(15).fill(2),
    geometryNormals: stored
      ? new Float32Array([
          0.1, -0, 0.2, 0.3, 0.5, 0.7, 0.25, 0.125, 0.75, -0.5, 0.5, -0.25, 3,
          -4, 5,
        ])
      : undefined,
  };
  return {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    visible: true,
    opacity: 1,
    color: "#888888",
    positions: expandPlyTopology(indexedMesh),
    indexedMesh,
  };
}
it.each([true, false])(
  "stages computed vectors through both Float32 transforms without recomputing (stored=%s)",
  async (stored) => {
    const source = fixture(stored),
      mesh = source.indexedMesh!;
    const normals = mesh.geometryNormals ?? noiseNormals(mesh),
      original = bits(normals);
    const expected = transformDatumCoordinateStages(normals, frames, true);
    const executor = createDatumTransformExecutor({
      parallel: false,
      typedNormals: true,
    });
    try {
      const output = (await executor.transformScanStages(source, frames))
        .entity;
      expect(output.indexedMesh!.geometryNormals).toBeInstanceOf(Float32Array);
      expect(bits(output.indexedMesh!.geometryNormals!)).toBe(bits(expected));
      expect(bits(output.indexedMesh!.geometryNormals!)).not.toBe(
        bits(noiseNormals(output.indexedMesh!)),
      );
      expect(scanRenderData(output.positions)!.normals).toBe(
        output.indexedMesh!.geometryNormals,
      );
      expect(bits(normals)).toBe(original);
      expect(mesh.geometryNormals !== undefined).toBe(stored);
      expect(output.indexedMesh!.triangles).toBe(mesh.triangles);
    } finally {
      executor.close();
    }
  },
);

it.each([true, false])(
  "keeps synchronous datum staging consistent with computed vector lifetime (stored=%s)",
  (stored) => {
    const source = fixture(stored),
      mesh = source.indexedMesh!;
    const normals = mesh.geometryNormals ?? noiseNormals(mesh);
    const result = frames.reduce(
      (e, matrix) => transformDatumScan(e, matrix),
      source,
    );
    expect(result.indexedMesh!.geometryNormals).toBeInstanceOf(Float32Array);
    expect(bits(result.indexedMesh!.geometryNormals!)).toBe(
      bits(transformDatumCoordinateStages(normals, frames, true)),
    );
    expect(Array.from(mesh.normals!)).toEqual(new Array(15).fill(2));
  },
);

it("rotates computed vectors without applying translation, scale or renormalization", () => {
  const source = fixture(),
    mesh = source.indexedMesh!;
  const before = bits(mesh.geometryNormals!);
  const result = transformIndexedMesh(source, [100, 200, 300], [13, 29, 43], 7);
  expect(result.indexedMesh!.geometryNormals).toBeInstanceOf(Float32Array);
  expect(bits(result.indexedMesh!.geometryNormals!)).toBe(
    bits(transformPositions(mesh.geometryNormals!, [0, 0, 0], [13, 29, 43], 1)),
  );
  expect(bits(mesh.geometryNormals!)).toBe(before);
});

it("uses stored computed state for uncached restored history and synchronous edits", () => {
  const e = fixture(),
    m = e.indexedMesh!;
  const output = scanDisplayBuffers(e.positions, m, undefined);
  expect(output.indexed).toBe(true);
  expect(output.normals).toBe(m.geometryNormals);
  expect(output.positions).toBe(m.vertices);
  expect(output.index).toBe(m.triangles);
  const expanded = scanDisplayBuffers(e.positions, m, undefined, [], true);
  expect(bits(expanded.normals!)).toBe(
    bits(
      expandPlyTopology({
        vertices: m.geometryNormals as Float32Array,
        triangles: m.triangles as Uint32Array,
      }),
    ),
  );
});

it.each([[1], new Array(15).fill(Infinity), new Array(15).fill(1e300)])(
  "invalidates malformed computed fields before asynchronous staging",
  async (normals) => {
    const e = fixture();
    e.indexedMesh!.geometryNormals = normals;
    const executor = createDatumTransformExecutor({ parallel: false });
    try {
      const output = (await executor.transformScanStages(e, frames)).entity;
      expect(output.indexedMesh).toBeUndefined();
      expect(scanRenderData(output.positions)).toBeUndefined();
      expect(e.indexedMesh!.geometryNormals).toBe(normals);
    } finally {
      executor.close();
    }
  },
);

it("does not display a stored field if its topology no longer matches geometry", () => {
  const e = fixture();
  const output = scanDisplayBuffers(
    new Float32Array(e.positions.length),
    e.indexedMesh,
    undefined,
  );
  expect(output.indexed).toBe(false);
  expect(output.normals).toBeUndefined();
});
