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
import { ApplicationApi, type WorkspaceHost } from "../src/automation/api";
import { createWorkflowOperations } from "../src/automation/workflow-operations";
import { SelectionProcessingHighlight } from "../src/selection-processing-highlight";

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

it("renders and ray-picks a precise indexed triangle at large world coordinates", async () => {
  const x = 100000000;
  const positions = [x, 0, 0, x + 4, 0, 0, x + 4, 4, 0];
  const indexedMesh = {
    vertices: positions.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const entity: Entity = {
    id: "precise",
    kind: "mesh",
    name: "precise",
    positions,
    indexedMesh,
    color: "#abcdef",
    visible: true,
    opacity: 1,
    meshSelection: { hidden: [], saved: [] },
  };
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.set(x + 2, 2, 10);
  camera.lookAt(x + 2, 2, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    camera,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    triangleSelection: new THREE.Group(),
    selectionProcessing: new SelectionProcessingHighlight(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });
  const before = positions.slice();
  try {
    view.setEntities([entity], entity.id);
    const mesh = scene.children.find(
      (object) => object instanceof THREE.Mesh,
    ) as THREE.Mesh;
    mesh.updateMatrixWorld(true);
    const attribute = mesh.geometry.getAttribute("position");
    expect(attribute.getX(1) - attribute.getX(0)).toBe(4);
    const modelView = new THREE.Matrix4().multiplyMatrices(
      camera.matrixWorldInverse,
      mesh.matrixWorld,
    );
    const uploadedModelView = new THREE.Matrix4().fromArray(
      new Float32Array(modelView.elements),
    );
    const projectCorner = (slot: number) =>
      new THREE.Vector4(
        attribute.getX(slot),
        attribute.getY(slot),
        attribute.getZ(slot),
        1,
      )
        .applyMatrix4(uploadedModelView)
        .applyMatrix4(camera.projectionMatrix);
    expect(projectCorner(1).x - projectCorner(0).x).toBeCloseTo(1, 7);
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.x).toBe(x);
    expect(box.max.x).toBe(x + 4);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x + 3, 1, 10),
      new THREE.Vector3(0, 0, -1),
    );
    expect(ray.intersectObject(mesh)[0]?.point.toArray()).toEqual([
      x + 3,
      1,
      0,
    ]);
    expect(view.pickAgentView(0.625, 0.625, 10).hits[0]?.triangleIndex).toBe(0);
    mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { indirect: true });
    mesh.raycast = acceleratedRaycast;
    expect(ray.intersectObject(mesh)[0]?.point.toArray()).toEqual([
      x + 3,
      1,
      0,
    ]);
    expect(view.pickAgentView(0.625, 0.625, 10).hits[0]?.triangleIndex).toBe(0);
    const host = {
      snapshot: () => ({
        name: "Test",
        entities: [entity],
        selectedId: entity.id,
        selection: null,
        history: [],
        future: [],
        authoring: {},
        settings: {},
      }),
      busy: () => false,
      activity: vi.fn(),
      pickViewport: (px: number, py: number, max: number) =>
        view.pickAgentView(px, py, max),
    } as unknown as WorkspaceHost;
    const api = new ApplicationApi(host, createWorkflowOperations(host));
    try {
      const receipt = await api.invoke("viewport_pick", {
        x: 0.625,
        y: 0.625,
        maxHits: 10,
      });
      expect(receipt.ok).toBe(true);
      expect((receipt as any).result.hits[0]).toMatchObject({
        entityId: entity.id,
        triangleIndex: 0,
        point: [x + 3, 1, 0],
      });
    } finally {
      api.dispose();
    }
    expect((view as any).bounds.min.x).toBe(x);
    expect((view as any).bounds.max.x).toBe(x + 4);
    view.setEntities([entity], entity.id);
    mesh.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(mesh).max.x).toBe(x + 4);
    view.setTriangleSelection(positions, new Uint8Array([1]));
    const overlay = (view as any).triangleSelection.children[0] as THREE.Mesh;
    overlay.updateMatrixWorld(true);
    const selected = overlay.geometry.getAttribute("position");
    expect(selected.getX(1) - selected.getX(0)).toBe(4);
    const selectedBox = new THREE.Box3().setFromObject(overlay);
    expect(selectedBox.min.x).toBe(x);
    expect(selectedBox.max.x).toBe(x + 4);
    const selectionObjects = (view as any).triangleSelection
      .children as THREE.Object3D[];
    expect(selectionObjects.length).toBeGreaterThan(1);
    expect(
      selectionObjects.every((object) => object.position.x === mesh.position.x),
    ).toBe(true);
    view.setDeviation(entity.id, [0, 0, 0], 1);
    expect(new THREE.Box3().setFromObject(mesh).max.x).toBe(x + 4);
    view.setDeviation(entity.id, null, 1);
    expect(positions).toEqual(before);
    const replacement = {
      ...entity,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indexedMesh: undefined,
    };
    view.setTriangleSelection();
    view.setEntities([replacement], replacement.id);
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(new THREE.Box3().setFromObject(mesh).max.x).toBe(1);
  } finally {
    view.setTriangleSelection();
    view.setEntities([], null);
  }
});

it("keeps precise local coordinates when deviation display expands indexed corners", () => {
  const x = 100000000;
  const indexedMesh = {
    vertices: [x, 0, 0, x + 4, 0, 0, x, 4, 0, x + 4, 4, 0],
    triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
  };
  const positions = Array.from(indexedMesh.triangles).flatMap((id) =>
    indexedMesh.vertices.slice(id * 3, id * 3 + 3),
  );
  cacheScanRenderData(positions, prepareScanRenderData(positions, indexedMesh));
  const entity: Entity = {
    id: "precise",
    kind: "mesh",
    name: "precise",
    positions,
    indexedMesh,
    color: "#abcdef",
    visible: true,
    opacity: 1,
    meshSelection: { hidden: [], saved: [] },
  };
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.set(x + 2, 2, 10);
  camera.lookAt(x + 2, 2, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
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
  try {
    view.setEntities([entity], entity.id);
    const mesh = scene.children.find(
      (object) => object instanceof THREE.Mesh,
    ) as THREE.Mesh;
    const indexedGeometry = mesh.geometry;
    view.setDeviation(entity.id, [0, 0, 0, 1, 0, 0], 1);
    expect(mesh.geometry).not.toBe(indexedGeometry);
    const position = mesh.geometry.getAttribute("position");
    expect(position.getX(1) - position.getX(0)).toBe(4);
    expect(new THREE.Box3().setFromObject(mesh).max.x).toBe(x + 4);
    view.setDeviation(entity.id, null, 1);
    expect(mesh.geometry).toBe(indexedGeometry);
    expect(new THREE.Box3().setFromObject(mesh).max.x).toBe(x + 4);
    entity.meshSelection!.hidden = [0];
    view.setEntities([entity], entity.id);
    expect((view as any).objects.get(entity.id).triangleSlots).toEqual([1]);
    const hit = view.pickAgentView(0.625, 0.375, 10).hits[0];
    expect(hit.triangleIndex).toBe(0);
    expect(hit.point).toEqual([x + 3, 3, 0]);
    const onPick = vi.fn(),
      onSelect = vi.fn();
    Object.assign(view, {
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 200,
          }),
        },
      },
      onPick,
      onSelect,
    });
    expect((view as any).pickAt({ clientX: 125, clientY: 75 })).toBe(entity.id);
    expect(onPick).toHaveBeenCalledWith([x + 3, 3, 0], entity.id, 1);
    (mesh.material as THREE.Material).clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(x + 3.5)),
    ];
    expect(view.pickAgentView(0.625, 0.375, 10).hits).toHaveLength(0);
    expect((view as any).pickAt({ clientX: 125, clientY: 75 })).toBeUndefined();
  } finally {
    view.setEntities([], null);
  }
});

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
  // Independent sRGB fixtures for the shared reduction palette at these distances.
  const palette = new Map<number, string>([
    [-1, "#0000ff"],
    [0, "#00ff00"],
    [1, "#ff0000"],
    [0.5, "#ffff00"],
    [2, "#ff0000"],
    [0.123456789123, "#3fff00"],
  ]);
  return Float32Array.from(
    values.flatMap((value) => {
      const color = palette.get(value);
      if (!color) throw new Error("Missing palette fixture.");
      return new THREE.Color(color).toArray();
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
