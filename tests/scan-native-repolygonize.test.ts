import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { runScanTool } from "../src/scan-tools";
import fixture from "./fixtures/repolygonize-observed-tilted-box.json";
import { admitReconstructionTransport } from "../src/scan-reconstruction-input";
import { meshFacetNormals } from "../src/mesh-geometry-normals";
import { indexedRenderNormals } from "../src/indexed-mesh";
import { prepareRestoredScanDisplays } from "../src/restored-scan-display";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
import {
  digestEntityGeometry,
  type GeometryDigest,
} from "../src/geometry-digest";
import type { Entity } from "../src/types";

function input() {
  const vertices = Float32Array.from(fixture.vertices.flat());
  const triangles = Uint32Array.from(fixture.faces.flat());
  const positions = Float32Array.from(
    Array.from(triangles).flatMap((id) =>
      Array.from(vertices.subarray(id * 3, id * 3 + 3)),
    ),
  );
  return { vertices, triangles, positions };
}
function sha(values: Float32Array) {
  return createHash("sha256")
    .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
    .digest("hex");
}

it("matches every ordered native Float32 corner through the existing scan-tool dispatcher", () => {
  const source = input();
  const before = source.positions.slice();
  const operation = {
    kind: "repolygonize" as const,
    method: "native" as const,
    resolution: fixture.resolution,
    sourceTopology: { vertices: source.vertices, triangles: source.triangles },
  };
  const result = runScanTool({
    kind: "scanTools",
    positions: source.positions,
    operation,
  });
  expect(sha(result.positions)).toBe(
    sha(Float32Array.from(fixture.nativeOutput)),
  );
  expect(result.positions.length / 9).toBe(fixture.nativeTriangles);
  expect(source.positions).toEqual(before);
});

it("publishes computed facet state before display preparation and project roundtrip", async () => {
  const source = input();
  const result = runScanTool({
    kind: "scanTools",
    positions: source.positions,
    operation: {
      kind: "repolygonize",
      method: "native",
      sourceTopology: source,
      resolution: 0.5,
    },
  });
  const mesh = result.indexedMesh;
  if (!mesh || !(mesh.geometryNormals instanceof Float32Array))
    throw Error(
      "Native output requires indexed geometry and computed vertex normals",
    );
  const coordinates = sha(result.positions),
    vertexNormals = sha(mesh.geometryNormals);
  expect(mesh.facetNormals).toBeInstanceOf(Float32Array);
  expect(mesh.facetNormals).toHaveLength(mesh.triangles.length);
  expect(mesh.facetNormals).toEqual(
    meshFacetNormals({
      vertices: mesh.vertices,
      triangles: mesh.triangles,
    }),
  );
  const entity: Entity = {
    id: "native-output",
    name: "Native output",
    kind: "mesh",
    positions: result.positions,
    indexedMesh: mesh,
    normals: indexedRenderNormals(mesh),
    visible: true,
    color: "#aaaaaa",
    opacity: 1,
  };
  const canonical = (digest: GeometryDigest) =>
    digest.buffers.map(({ path, encoding, elements, rawBytes, sha256 }) => ({
      path,
      encoding,
      elements,
      rawBytes,
      sha256,
    }));
  const before = canonical(await digestEntityGeometry(entity));
  const [displayed] = prepareRestoredScanDisplays([entity]);
  expect(displayed.indexedMesh?.facetNormals).toBe(mesh.facetNormals);
  expect(canonical(await digestEntityGeometry(displayed))).toEqual(before);
  const decoded = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Native facet state",
        entities: [entity],
      },
      history: [],
      future: [],
    }),
  );
  const restored = decoded.project.entities[0];
  expect(restored.indexedMesh?.facetNormals).toBeInstanceOf(Float32Array);
  expect(canonical(await digestEntityGeometry(restored))).toEqual(before);
  expect(sha(result.positions)).toBe(coordinates);
  expect(sha(mesh.geometryNormals)).toBe(vertexNormals);
});

it("keeps the previous watertight voxel route explicitly available", () => {
  const source = input();
  const operation = {
    kind: "repolygonize" as const,
    method: "voxel" as const,
    resolution: 0.5,
  };
  const result = runScanTool({
    kind: "scanTools",
    positions: source.positions,
    operation,
  });
  expect(result.diagnostics?.extraction).toBe("face-consistent-cube-contours");
  expect(result.topology).toMatchObject({ watertight: true });
});

it("defaults triangle inputs to native while typed point and mixed inputs retain voxel", () => {
  const source = input();
  const native = runScanTool({
    kind: "scanTools",
    positions: source.positions,
    operation: {
      kind: "repolygonize",
      sourceTopology: source,
      resolution: 0.5,
    },
  });
  expect(sha(native.positions)).toBe(
    sha(Float32Array.from(fixture.nativeOutput)),
  );
  const points = new Float32Array([0, 0, 0, 0.5, 0, 0]);
  for (const targets of [
    [],
    [{ kind: "triangles" as const, positions: source.positions }],
  ]) {
    const result = runScanTool({
      kind: "scanTools",
      positions: points,
      operation: {
        kind: "repolygonize",
        inputKind: "points",
        targetInputs: targets,
        resolution: 0.5,
      },
    });
    expect(result.diagnostics?.extraction).toBe(
      "face-consistent-cube-contours",
    );
    expect(result.diagnostics?.processedPoints).toBe(2);
    expect(result.diagnostics?.representedPoints).toBe(2);
  }
  expect(() =>
    runScanTool({
      kind: "scanTools",
      positions: points,
      operation: {
        kind: "repolygonize",
        inputKind: "points",
        method: "native",
      },
    }),
  ).toThrow(/triangle meshes/);
});

it("cancels native verification without mutating any input carrier", () => {
  const source = input(),
    before = sha(source.positions);
  const abort = new AbortController();
  expect(() =>
    runScanTool(
      {
        kind: "scanTools",
        positions: source.positions,
        operation: {
          kind: "repolygonize",
          method: "native",
          sourceTopology: source,
        },
      },
      {
        signal: abort.signal,
        onProgress(_fraction, stage) {
          if (stage === "Verifying reconstructed topology") abort.abort();
        },
      },
    ),
  ).toThrow(/cancelled/i);
  expect(sha(source.positions)).toBe(before);
});

it("budgets indexed normals before copying or reading oversized carriers", () => {
  const unread = new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return 150_000_000;
      throw Error("Must reject before reading");
    },
  });
  expect(() =>
    admitReconstructionTransport(
      [new Float32Array(9)],
      [{ vertices: unread, triangles: new Uint32Array([0, 1, 2]) }],
    ),
  ).toThrow(/topology exceeds 256 MiB/);
  const vertices = new Float32Array(new SharedArrayBuffer(36));
  const normals = new Float32Array(new SharedArrayBuffer(36));
  const triangles = new Uint32Array([0, 1, 2]);
  expect(
    admitReconstructionTransport(
      [vertices],
      [
        {
          vertices,
          triangles,
          normals,
          geometryNormals: normals,
          facetNormals: normals.subarray(0, 3),
        },
      ],
    ).privateBytes,
  ).toBe(12);
  expect(
    admitReconstructionTransport(
      [new Float32Array(9)],
      [
        {
          vertices: new Float32Array(9),
          triangles,
          normals: new Float32Array(9),
          geometryNormals: new Float32Array(9),
          facetNormals: new Float32Array(3),
        },
      ],
    ).privateBytes,
  ).toBe(168);
  expect(() =>
    admitReconstructionTransport(
      [vertices],
      [{ vertices, triangles, facetNormals: new Float32Array(6) }],
    ),
  ).toThrow(/normal carriers/);
});
