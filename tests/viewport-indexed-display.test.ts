import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { Viewport } from "../src/viewport";
import { expandPlyTopology } from "../src/ply-topology";
import {
  cacheScanRenderData,
  prepareScanRenderData,
} from "../src/scan-render-data";
import type { Entity } from "../src/types";

function setup(hidden: number[] = []) {
  const mesh = {
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 999, 999, 999,
    ]),
    triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
    normals: new Float32Array(15).fill(2),
  };
  const positions = expandPlyTopology(mesh);
  const prepared = prepareScanRenderData(positions, mesh);
  cacheScanRenderData(positions, prepared);
  const entity: Entity = {
    id: "scan",
    kind: "mesh",
    name: "scan",
    positions,
    indexedMesh: mesh,
    color: "#abcdef",
    visible: true,
    opacity: 1,
    meshSelection: { hidden, saved: [] },
  };
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.1, 1.1, 1.1, -0.1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.updateMatrixWorld(true);
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    camera,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    triangleSelection: new THREE.Group(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });
  view.setEntities([entity], entity.id);
  const rendered = scene.children.find(
    (object) => object instanceof THREE.Mesh,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  return { view, entity, mesh, positions, prepared, rendered };
}

it("reuses compact buffers and preserves authored bounds, facet IDs and agent picking", () => {
  const { view, entity, mesh, positions, prepared, rendered } = setup();
  const before = positions.slice(),
    normalsBefore = mesh.normals.slice();
  try {
    expect(rendered.geometry.getAttribute("position").array).toBe(
      mesh.vertices,
    );
    expect(rendered.geometry.getAttribute("normal").array).toBe(
      prepared.normals,
    );
    expect(rendered.geometry.index!.array).toBe(mesh.triangles);
    expect(rendered.geometry.boundingBox!.max.toArray()).toEqual([1, 1, 0]);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0.8, 0.8, 2),
      new THREE.Vector3(0, 0, -1),
    );
    expect(ray.intersectObject(rendered)[0].faceIndex).toBe(1);
    expect(view.pickAgentView(0.75, 0.25, 10).hits[0].triangleIndex).toBe(1);
    rendered.geometry.boundsTree = new MeshBVH(rendered.geometry, {
      indirect: true,
    });
    rendered.raycast = acceleratedRaycast;
    expect(ray.intersectObject(rendered)[0].faceIndex).toBe(1);
    expect(view.pickAgentView(0.75, 0.25, 10).hits[0].triangleIndex).toBe(1);
    view.setTriangleSelection(entity.positions, new Uint8Array([0, 1]));
    const overlay = (view as any).triangleSelection.children[0] as THREE.Mesh;
    expect(overlay.geometry.getAttribute("position").array).toEqual(
      positions.slice(9),
    );
    expect(positions).toEqual(before);
    expect(mesh.normals).toEqual(normalsBefore);
  } finally {
    view.setTriangleSelection();
    view.setEntities([], null);
  }
});

it("filters indexed hidden facets without changing original triangle-slot mapping", () => {
  const { view, entity, rendered } = setup([0]);
  try {
    expect(Array.from(rendered.geometry.index!.array)).toEqual([1, 3, 2]);
    const item = (view as any).objects.get(entity.id);
    expect(item.triangleSlots).toEqual([1]);
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0.8, 0.8, 2),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(rendered)[0];
    expect(item.triangleSlots[hit.faceIndex!]).toBe(1);
    expect(view.pickAgentView(0.75, 0.25, 10).hits[0].triangleIndex).toBe(0);
  } finally {
    view.setEntities([], null);
  }
});

function colors(values: readonly number[]) {
  return Float32Array.from(
    values.flatMap((value) => {
      const color = new THREE.Color("#4bb78c");
      return color
        .lerp(
          new THREE.Color(value < 0 ? "#2479de" : "#e56b47"),
          Math.min(1, Math.abs(value)),
        )
        .toArray();
    }),
  );
}

it("maps equal corner deviation values to compact vertices without changing color precision", () => {
  const { view, entity, rendered } = setup();
  const original = rendered.geometry;
  try {
    view.setDeviation(
      entity.id,
      [-1, 0.123456789123, 1, 0.123456789123, 2, 1],
      1,
    );
    expect(rendered.geometry).toBe(original);
    expect(rendered.geometry.getAttribute("color").array).toEqual(
      colors([-1, 0.123456789123, 1, 2, 0]),
    );
    view.setDeviation(entity.id, null, 1);
    expect(rendered.geometry.getAttribute("color")).toBeUndefined();
  } finally {
    view.setEntities([], null);
  }
});

it.each([false, true])(
  "preserves conflicting corner colors in an expanded overlay and releases it (remove=%s)",
  (remove) => {
    const { view, entity, rendered, positions } = setup([0]);
    const original = rendered.geometry;
    const originalDisposed = vi.spyOn(original, "dispose");
    const values = [-1, 0, 1, 0.5, 2, 1];
    view.setDeviation(entity.id, values, 1);
    const expanded = rendered.geometry;
    const disposed = vi.spyOn(expanded, "dispose");
    expect(expanded).not.toBe(original);
    expect(expanded.getAttribute("position").array).toBe(positions);
    expect(Array.from(expanded.index!.array)).toEqual([3, 4, 5]);
    expect(expanded.getAttribute("color").array).toEqual(colors(values));
    if (remove) {
      // Exercise object removal even if selection has not reset yet.
      view.setEntities([], entity.id);
      expect(originalDisposed).toHaveBeenCalledOnce();
    } else {
      view.setDeviation(entity.id, null, 1);
      expect(rendered.geometry).toBe(original);
      expect(originalDisposed).not.toHaveBeenCalled();
      view.setEntities([], null);
    }
    expect(disposed).toHaveBeenCalledOnce();
  },
);

it("rebuilds a same-position scene when its indexed topology identity changes", () => {
  const { view, entity, mesh, positions, rendered } = setup();
  const original = rendered.geometry;
  const replaced = { ...mesh, triangles: mesh.triangles.slice() };
  cacheScanRenderData(positions, prepareScanRenderData(positions, replaced));
  try {
    view.setEntities([{ ...entity, indexedMesh: replaced }], entity.id);
    expect(rendered.geometry).not.toBe(original);
    expect(rendered.geometry.index!.array).toBe(replaced.triangles);
  } finally {
    view.setEntities([], null);
  }
});
