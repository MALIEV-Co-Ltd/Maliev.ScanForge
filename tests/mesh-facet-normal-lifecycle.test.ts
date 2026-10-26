import { expect, it } from "vitest";
import type { Entity, IndexedMesh, Positions } from "../src/types";
import { prepareStoredScanRenderData } from "../src/scan-render-data";
import { nativeGlobalFacetNormals } from "../src/scan-native-global-surface";
import { nativeGlobalMeshTargetData } from "../src/scan-native-global-mesh-target";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { transformDatumCoordinateStages } from "../src/datum-transform-kernel";
import { indexedMeshMatches, retainIndexedMesh } from "../src/indexed-mesh";
import { digestEntityGeometry } from "../src/geometry-digest";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
import {
  globalQueryInputBytes,
  shareGlobalQueryInput,
} from "../src/scan-global-query-storage";

type FacetMesh = IndexedMesh & { facetNormals?: Positions };
const bits = (values: ArrayLike<number>) =>
  Buffer.from(Float32Array.from(values).buffer).toString("hex");
function source(): Entity {
  const vertices = new Float32Array([
    0.13, 0.27, 0.31, 1.23, 0.44, 0.58, 0.62, 1.47, 0.79,
  ]);
  return {
    id: "mesh",
    name: "mesh",
    kind: "mesh",
    visible: true,
    color: "#aaaaaa",
    opacity: 1,
    positions: vertices,
    indexedMesh: {
      vertices,
      triangles: new Uint32Array([0, 1, 2]),
      geometryNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    },
  };
}
const frames = [
  [0, -1, 0, 100000, 1, 0, 0, -200000, 0, 0, 1, 300000],
  [1, 0, 0, 0.03, 0, 0, -1, 0.07, 0, 1, 0, 0.09],
];
it("initializes computed facet normals on the original indexed geometry during stored render preparation", () => {
  const entity = source(),
    mesh = entity.indexedMesh!;
  const result = prepareStoredScanRenderData(entity.positions, mesh);
  const facets = (result.indexedMesh as FacetMesh).facetNormals;
  expect(facets).toBeInstanceOf(Float32Array);
  expect(bits(facets!)).toBe(
    bits(
      nativeGlobalFacetNormals(
        mesh.vertices as Float32Array,
        mesh.triangles as Uint32Array,
      ).normals,
    ),
  );
  expect((mesh as FacetMesh).facetNormals).toBeUndefined();
});
it.each([false, true])(
  "rotates computed facets through each Float32 stage, deriving only missing state (stored=%s)",
  async (stored) => {
    const entity = source(),
      mesh = entity.indexedMesh as FacetMesh;
    const facets = stored
      ? new Float32Array([-0, 0.6, 0.8])
      : nativeGlobalFacetNormals(
          mesh.vertices as Float32Array,
          mesh.triangles as Uint32Array,
        ).normals;
    if (stored) mesh.facetNormals = facets;
    const expected = transformDatumCoordinateStages(facets, frames, true),
      original = bits(facets);
    const executor = createDatumTransformExecutor({
      parallel: false,
      typedNormals: true,
    });
    try {
      const result = await executor.transformScanStages(entity, frames);
      expect(
        (result.entity.indexedMesh as FacetMesh).facetNormals,
      ).toBeInstanceOf(Float32Array);
      expect(bits((result.entity.indexedMesh as FacetMesh).facetNormals!)).toBe(
        bits(expected),
      );
      expect(bits(facets)).toBe(original);
      expect(result.entity.indexedMesh!.triangles).toBe(mesh.triangles);
    } finally {
      executor.close();
    }
  },
);
it("uses stored facet normals for evaluator preparation rather than recomputing rounded triangles", () => {
  const entity = source(),
    mesh = entity.indexedMesh!;
  const facetNormals = new Float32Array([-0, 0.6, 0.8]);
  const target = {
    vertices: mesh.vertices as Float32Array,
    triangles: mesh.triangles as Uint32Array,
    facetNormals,
  };
  const data = nativeGlobalMeshTargetData(target);
  expect(data.surface.normals).toBe(facetNormals);
  expect(data.surface.deriveNormals).not.toBe(true);
});
it("rejects malformed computed facet carriers without discarding validation", () => {
  for (const facets of [new Float32Array(2), [NaN, 0, 1], [1e40, 0, 1]]) {
    const entity = source();
    (entity.indexedMesh as FacetMesh).facetNormals = facets;
    expect(indexedMeshMatches(entity.indexedMesh, entity.positions)).toBe(
      false,
    );
  }
});
it("exposes computed facet bytes through the existing structured geometry digest", async () => {
  const entity = source();
  (entity.indexedMesh as FacetMesh).facetNormals = new Float32Array([
    -0, 0.6, 0.8,
  ]);
  const digest = await digestEntityGeometry(entity);
  expect(
    digest.buffers.find((b) => b.path === "indexedMesh.facetNormals"),
  ).toMatchObject({ encoding: "f32", elements: 3, rawBytes: 12 });
});
it("retains computed facet bits independently through project files and history", async () => {
  const first = source(),
    second = source();
  (first.indexedMesh as FacetMesh).facetNormals = new Float32Array([
    -0, 0.6, 0.8,
  ]);
  (second.indexedMesh as FacetMesh).facetNormals = new Float32Array([
    0.8, -0, -0.6,
  ]);
  const session = {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      name: "facets",
      units: "mm" as const,
      entities: [second],
    },
    history: [{ label: "pose", entities: [first] }],
    future: [],
  };
  const reopened = await decodeProjectFile(
    await encodeProjectFileLocally(session),
  );
  expect(
    bits((reopened.project.entities[0].indexedMesh as FacetMesh).facetNormals!),
  ).toBe(bits((second.indexedMesh as FacetMesh).facetNormals!));
  expect(
    bits(
      (reopened.history[0].entities[0].indexedMesh as FacetMesh).facetNormals!,
    ),
  ).toBe(bits((first.indexedMesh as FacetMesh).facetNormals!));
});
it("counts and shares the stored facet backing with the other query inputs", () => {
  const mesh = source().indexedMesh!,
    facetNormals = new Float32Array([-0, 0.6, 0.8]);
  const geometry = {
    points: mesh.vertices as Float32Array,
    normals: mesh.geometryNormals as Float32Array,
    targetMeshes: [
      {
        vertices: mesh.vertices as Float32Array,
        triangles: mesh.triangles as Uint32Array,
        facetNormals,
      },
    ],
  };
  const input = { scans: [{ id: "mesh", geometry }] };
  const expected =
    (geometry.points.byteLength +
      geometry.normals.byteLength +
      (mesh.triangles as Uint32Array).byteLength +
      facetNormals.byteLength) *
    2;
  expect(globalQueryInputBytes(input, 2, true)).toBe(expected);
  const shared = shareGlobalQueryInput(input);
  const result = shared.scans[0].geometry
    .targetMeshes![0] as (typeof geometry.targetMeshes)[0];
  expect(result.facetNormals.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(bits(result.facetNormals)).toBe(bits(facetNormals));
  expect(facetNormals.buffer).toBeInstanceOf(ArrayBuffer);
});

it("initializes legacy facet state on history activation without altering retained snapshots", async () => {
  const { restoreModelDisplay } = await import("../src/history");
  const entity = source();
  const [restored] = restoreModelDisplay([entity], []);
  expect(restored.indexedMesh!.facetNormals).toBeInstanceOf(Float32Array);
  expect(entity.indexedMesh!.facetNormals).toBeUndefined();
  expect(restored.positions).toBe(entity.positions);
  const [again] = restoreModelDisplay([restored], []);
  expect(again.indexedMesh!.facetNormals).toBe(
    restored.indexedMesh!.facetNormals,
  );
});
it("drops stale facet ownership with geometry edits and preserves history's original cache", () => {
  const entity = source();
  const facets = (entity.indexedMesh!.facetNormals = new Float32Array([
    -0, 0.6, 0.8,
  ]));
  const positions = Float32Array.from(entity.positions);
  positions[0] += 1;
  expect(
    retainIndexedMesh({ ...entity, positions }).indexedMesh,
  ).toBeUndefined();
  expect(entity.indexedMesh!.facetNormals).toBe(facets);
});
it("preserves shared facets and snapshot aliases across worker cloning and project numeric transport", async () => {
  const { projectEncodingSnapshot, restoreEncodingSnapshot } =
    await import("../src/project-encoding-snapshot");
  const { packProjectTransport, unpackProjectTransport } =
    await import("../src/project-transport");
  const entity = source(),
    facets = new Float32Array(new SharedArrayBuffer(12));
  facets.set([-0, 0.6, 0.8]);
  entity.indexedMesh!.facetNormals = facets;
  const session = {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      name: "Facets",
      units: "mm" as const,
      entities: [entity],
    },
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
  const packed = await packProjectTransport(projectEncodingSnapshot(session));
  expect(packed.transfers).not.toContain(facets.buffer);
  const wire = await unpackProjectTransport<any>(
    structuredClone(packed.packet, { transfer: packed.transfers }),
  );
  const restored = restoreEncodingSnapshot(wire);
  const result = restored.project.entities[0].indexedMesh!
    .facetNormals as Float32Array;
  expect(result.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(result).toBe(
    restored.history[0].entities[0].indexedMesh!.facetNormals,
  );
  expect(bits(result)).toBe(bits(facets));
  expect(facets.byteLength).toBe(12);
});
it.each(
  [new Float32Array(2), [NaN, 0, 1], [1e40, 0, 1], new Array(3)].map(
    (facets) => ({ facets }),
  ),
)(
  "rejects malformed facets before project publication (%s)",
  async ({ facets }) => {
    const entity = source();
    entity.indexedMesh!.facetNormals = facets;
    await expect(
      encodeProjectFileLocally({
        project: {
          format: "maliev-scanforge",
          version: 1,
          name: "Facets",
          units: "mm",
          entities: [entity],
        },
        history: [],
        future: [],
      }),
    ).rejects.toThrow(/facet/i);
  },
);
