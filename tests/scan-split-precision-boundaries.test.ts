import { expect, it } from "vitest";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { prepareScanRenderData } from "../src/scan-render-data";
import { scanDisplayBuffers } from "../src/scan-display-buffers";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import type { Entity } from "../src/types";

it("retains number-array seam coordinates in binary projects but rounds them in Float32 display attributes", async () => {
  const vertices = [100000000, 0, 0, 100000004, 4, 0, 99999992, 16, 0];
  const positions = [...vertices];
  const indexedMesh = { vertices, triangles: new Uint32Array([0, 1, 2]) };
  const entity: Entity = {
    id: "precision-control",
    name: "Precision control",
    kind: "mesh",
    color: "#ffffff",
    visible: true,
    opacity: 1,
    positions,
    indexedMesh,
  };
  expect(indexedMeshMatches(indexedMesh, positions)).toBe(true);
  const session = {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      units: "mm" as const,
      name: "Precision",
      entities: [entity],
    },
    history: [],
    future: [],
  };
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  const restored = reopened.project.entities[0];
  expect(restored.positions[3]).toBe(100000004);
  expect(restored.indexedMesh!.vertices[3]).toBe(100000004);
  expect(indexedMeshMatches(restored.indexedMesh, restored.positions)).toBe(
    true,
  );
  const prepared = prepareScanRenderData(
    restored.positions,
    restored.indexedMesh,
  );
  const buffers = scanDisplayBuffers(
    restored.positions,
    restored.indexedMesh,
    prepared,
  );
  expect(buffers.indexed).toBe(true);
  const display = new Float32BufferAttribute(buffers.positions, 3);
  expect(display.getX(1)).toBe(100000000);
});

it("preserves the controlled seam in Float32 coordinates relative to a nearby origin", () => {
  const origin = [100000000, 0, 0];
  const vertices = [
    100000000, 0, 0, 100000004, 4, 0, 100000008, 8, 0, 99999992, 16, 0,
  ];
  const local = new Float32BufferAttribute(
    vertices.map((value, i) => value - origin[i % 3]),
    3,
  );
  expect(local.getX(1)).toBe(4);
  const p = (id: number) => [local.getX(id), local.getY(id)];
  const area2 = (a: number, b: number, c: number) => {
    const [x, y] = p(a),
      [bx, by] = p(b),
      [cx, cy] = p(c);
    return (bx - x) * (cy - y) - (by - y) * (cx - x);
  };
  expect(area2(0, 1, 3) + area2(1, 2, 3)).toBe(192);
  expect(local.getX(1) + origin[0]).toBe(vertices[3]);
});

it("raycasts the controlled local-origin geometry back to world coordinates", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 4, 4, 0, -8, 16, 0], 3),
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(100000000, 0, 0);
  mesh.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(99999999, 6, 1), new Vector3(0, 0, -1));
  const hits = ray.intersectObject(mesh);
  expect(hits).toHaveLength(1);
  expect(hits[0].point.x).toBe(99999999);
  expect(hits[0].point.y).toBe(6);
  expect(hits[0].point.z).toBe(0);
  geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
  mesh.raycast = acceleratedRaycast;
  const accelerated = ray.intersectObject(mesh);
  expect(accelerated).toHaveLength(1);
  expect(accelerated[0].point.toArray()).toEqual(hits[0].point.toArray());
  geometry.dispose();
  material.dispose();
});
