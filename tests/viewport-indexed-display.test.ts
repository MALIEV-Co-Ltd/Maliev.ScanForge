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

it("releases a retired recentered display buffer without changing authored geometry", () => {
  const { view, entity } = setup();
  const source = [0.123456789, 0, 0, 1, 0, 0, 0, 1, 0];
  const precise = {
    ...entity,
    id: "precise",
    positions: source,
    indexedMesh: undefined,
    meshSelection: undefined,
  };
  view.setEntities([precise], precise.id);
  const item = (view as any).objects.get(precise.id);
  const geometry = item.mesh.geometry as THREE.BufferGeometry;
  const buffer = geometry.getAttribute("position").array.buffer;
  const before = source.slice();
  let intactDuringDispose = false;
  geometry.addEventListener("dispose", () => {
    intactDuringDispose = buffer.byteLength > 0;
  });
  const dependent = new THREE.BufferGeometry();
  dependent.setAttribute("position", geometry.getAttribute("position"));
  let intactDuringDependentDispose = false;
  dependent.addEventListener("dispose", () => {
    intactDuringDependentDispose = buffer.byteLength > 0;
  });
  item.deviationGeometry = geometry;
  item.mesh.geometry = dependent;
  view.setEntities([], null);
  expect(intactDuringDispose).toBe(true);
  expect(intactDuringDependentDispose).toBe(true);
  if (
    typeof (ArrayBuffer.prototype as { transfer?: unknown }).transfer ===
    "function"
  )
    expect(buffer.byteLength).toBe(0);
  expect(source).toEqual(before);
});

it("releases the retired recentered geometry when a same-object deviation display is replaced", () => {
  const { view, entity } = setup();
  const source = [0.123456789, 0, 0, 1, 0, 0, 0, 1, 0];
  const precise = {
    ...entity,
    id: "precise",
    positions: source,
    indexedMesh: undefined,
    meshSelection: undefined,
  };
  view.setEntities([precise], precise.id);
  const item = (view as any).objects.get(precise.id);
  const original = item.mesh.geometry as THREE.BufferGeometry;
  const buffer = original.getAttribute("position").array.buffer;
  const expanded = new THREE.BufferGeometry();
  expanded.setAttribute("position", original.getAttribute("position"));
  let intactDuringExpandedDispose = false;
  expanded.addEventListener("dispose", () => {
    intactDuringExpandedDispose = buffer.byteLength > 0;
  });
  item.deviationGeometry = original;
  item.mesh.geometry = expanded;
  view.setEntities(
    [{ ...precise, positions: source.map((n) => n + 0.25) }],
    precise.id,
  );
  expect(intactDuringExpandedDispose).toBe(true);
  if (
    typeof (ArrayBuffer.prototype as { transfer?: unknown }).transfer ===
    "function"
  )
    expect(buffer.byteLength).toBe(0);
  expect(source[0]).toBe(0.123456789);
  view.setEntities([], null);
});

it("falls back to collection for retired recentered displays without transfer", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  );
  const { view, entity } = setup();
  const source = [0.123456789, 0, 0, 1, 0, 0, 0, 1, 0];
  const precise = {
    ...entity,
    id: "precise",
    positions: source,
    indexedMesh: undefined,
    meshSelection: undefined,
  };
  try {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", {
      configurable: true,
      value: undefined,
    });
    view.setEntities([precise], precise.id);
    const geometry = (view as any).objects.get(precise.id).mesh
      .geometry as THREE.BufferGeometry;
    const buffer = geometry.getAttribute("position").array.buffer;
    view.setEntities([], null);
    expect(buffer.byteLength).toBe(36);
    expect(source[0]).toBe(0.123456789);
  } finally {
    if (descriptor)
      Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
    else
      delete (ArrayBuffer.prototype as ArrayBuffer & { transfer?: unknown })
        .transfer;
    view.setEntities([], null);
  }
});

it("releases retired selection-only buffers while preserving source geometry", () => {
  const { view, positions } = setup();
  (view as any).selectionProcessing = new SelectionProcessingHighlight();
  const original = Array.from(positions);
  view.setTriangleSelection(positions, new Uint8Array([1, 0]));
  const group = (view as any).triangleSelection as THREE.Group;
  const overlay = group.children[0] as THREE.Mesh;
  const vertex = overlay.geometry.getAttribute("position").array.buffer;
  const corner = overlay.geometry.getAttribute("processingBarycentric").array
    .buffer;
  const line = group.children[1] as THREE.LineSegments;
  const edge = (
    line.geometry.getAttribute(
      "instanceStart",
    ) as THREE.InterleavedBufferAttribute
  ).data.array.buffer;
  const lineBase = line.geometry.getAttribute("position").array.buffer;
  const lineBaseBytes = lineBase.byteLength;
  expect(vertex.byteLength).toBeGreaterThan(0);
  expect(corner.byteLength).toBeGreaterThan(0);
  expect(edge.byteLength).toBeGreaterThan(0);
  view.setTriangleSelection();
  expect(vertex.byteLength).toBe(0);
  expect(corner.byteLength).toBe(0);
  expect(edge.byteLength).toBe(0);
  expect(lineBase.byteLength).toBe(lineBaseBytes);
  expect(Array.from(positions)).toEqual(original);
  view.setEntities([], null);
});

it("keeps selection cleanup working when immediate buffer transfer is unavailable", () => {
  const { view, positions } = setup();
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  );
  const original = Array.from(positions);
  try {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", {
      configurable: true,
      value: undefined,
    });
    view.setTriangleSelection(positions, new Uint8Array([1, 0]));
    const group = (view as any).triangleSelection as THREE.Group;
    const overlay = group.children[0] as THREE.Mesh;
    const vertex = overlay.geometry.getAttribute("position").array.buffer;
    view.setTriangleSelection();
    expect(group.children).toHaveLength(0);
    expect(vertex.byteLength).toBe(36);
    expect(Array.from(positions)).toEqual(original);
  } finally {
    if (descriptor)
      Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
    else
      delete (ArrayBuffer.prototype as ArrayBuffer & { transfer?: unknown })
        .transfer;
    view.setEntities([], null);
  }
});

it("retires the previous selection overlay before displaying a different selected mesh", () => {
  const { view, entity, positions } = setup();
  view.setTriangleSelection(positions, new Uint8Array([1, 0]));
  const group = (view as any).triangleSelection as THREE.Group;
  const oldOverlay = group.children[0] as THREE.Mesh;
  const dispose = vi.spyOn(oldOverlay.geometry, "dispose");
  const next = { ...entity, id: "next", positions: positions.slice() };
  try {
    view.setEntities([entity, next], next.id);
    expect(group.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledOnce();
    view.setTriangleSelection(next.positions, new Uint8Array([0, 1]));
    expect(group.children).toHaveLength(1);
    view.setEntities([entity, next], next.id);
    expect(group.children).toHaveLength(1);
  } finally {
    view.setTriangleSelection();
    view.setEntities([], null);
  }
});

it("keeps a selection overlay when the new selected entity shares its positions", () => {
  const { view, entity, positions } = setup();
  view.setTriangleSelection(positions, new Uint8Array([1, 0]));
  const group = (view as any).triangleSelection as THREE.Group;
  const overlay = group.children[0] as THREE.Mesh;
  const dispose = vi.spyOn(overlay.geometry, "dispose");
  const sameGeometry = { ...entity, id: "same" };
  try {
    view.setEntities([entity, sameGeometry], sameGeometry.id);
    expect(group.children[0]).toBe(overlay);
    expect(dispose).not.toHaveBeenCalled();
  } finally {
    view.setTriangleSelection();
    view.setEntities([], null);
  }
});

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

it("keeps viewport geometry when an indexed wrapper changes but its stored buffers do not", () => {
  const { view, entity, mesh, prepared, rendered } = setup();
  const topology = {
    ...mesh,
    geometryNormals: prepared.normals,
    facetNormals: new Float32Array(mesh.triangles.length),
  };
  try {
    view.setEntities([{ ...entity, indexedMesh: topology }], entity.id);
    const geometry = rendered.geometry;
    const disposal = vi.spyOn(geometry, "dispose");
    view.setEntities([{ ...entity, indexedMesh: { ...topology } }], entity.id);
    expect(rendered.geometry).toBe(geometry);
    expect(disposal).not.toHaveBeenCalled();
    expect((view as any).objects.get(entity.id).renderTopology).not.toBe(
      topology,
    );
  } finally {
    view.setEntities([], null);
  }
});

it("rebuilds when a replacement changes computed normals", () => {
  const { view, entity, mesh, prepared, rendered } = setup();
  const topology = { ...mesh, geometryNormals: prepared.normals };
  try {
    view.setEntities([{ ...entity, indexedMesh: topology }], entity.id);
    const original = rendered.geometry;
    const changed = {
      ...topology,
      geometryNormals: new Float32Array(prepared.normals!),
    };
    changed.geometryNormals[0] += 0.25;
    view.setEntities([{ ...entity, indexedMesh: changed }], entity.id);
    expect(rendered.geometry).not.toBe(original);
    expect(rendered.geometry.getAttribute("normal").array).toBe(
      changed.geometryNormals,
    );
  } finally {
    view.setEntities([], null);
  }
});

it("preserves hidden-face mapping and expanded deviation through an equivalent topology wrapper", () => {
  const { view, entity, mesh, prepared, rendered, positions } = setup([0]);
  const topology = { ...mesh, geometryNormals: prepared.normals };
  try {
    view.setEntities([{ ...entity, indexedMesh: topology }], entity.id);
    view.setDeviation(entity.id, [-1, 0, 1, 0.5, 2, 1], 1);
    const expanded = rendered.geometry;
    view.setEntities([{ ...entity, indexedMesh: { ...topology } }], entity.id);
    expect(rendered.geometry).toBe(expanded);
    expect(Array.from(expanded.index!.array)).toEqual([3, 4, 5]);
    expect(expanded.getAttribute("color").array).toEqual(
      colors([-1, 0, 1, 0.5, 2, 1]),
    );
    expect(view.pickAgentView(0.75, 0.25, 10).hits[0].triangleIndex).toBe(0);
    view.setDeviation(entity.id, null, 1);
    expect((view as any).objects.get(entity.id).triangleSlots).toEqual([1]);
    expect(expanded.getAttribute("position").array).toBe(positions);
  } finally {
    view.setEntities([], null);
  }
});

it("rebuilds when prepared display normals differ from stored topology normals", () => {
  const { view, entity, mesh, positions, prepared, rendered } = setup();
  const topology = {
    ...mesh,
    geometryNormals: new Float32Array(mesh.vertices.length).fill(1),
  };
  const displayNormals = new Float32Array(mesh.vertices.length).fill(2);
  try {
    cacheScanRenderData(positions, {
      ...prepared,
      indexedMesh: topology,
      normals: displayNormals,
    });
    view.setEntities([{ ...entity, indexedMesh: topology }], entity.id);
    const original = rendered.geometry;
    expect(original.getAttribute("normal").array).toBe(displayNormals);
    view.setEntities([{ ...entity, indexedMesh: { ...topology } }], entity.id);
    expect(rendered.geometry).not.toBe(original);
    expect(rendered.geometry.getAttribute("normal").array).toBe(
      topology.geometryNormals,
    );
  } finally {
    view.setEntities([], null);
  }
});

it("rebuilds when a prepared cache selects different normals for the new wrapper", () => {
  const { view, entity, mesh, positions, prepared, rendered } = setup();
  const topology = {
    ...mesh,
    geometryNormals: new Float32Array(mesh.vertices.length).fill(1),
  };
  const replacement = { ...topology };
  const nextNormals = new Float32Array(mesh.vertices.length).fill(2);
  try {
    view.setEntities([{ ...entity, indexedMesh: topology }], entity.id);
    const original = rendered.geometry;
    expect(original.getAttribute("normal").array).toBe(
      topology.geometryNormals,
    );
    cacheScanRenderData(positions, {
      ...prepared,
      indexedMesh: replacement,
      normals: nextNormals,
    });
    view.setEntities([{ ...entity, indexedMesh: replacement }], entity.id);
    expect(rendered.geometry).not.toBe(original);
    expect(rendered.geometry.getAttribute("normal").array).toBe(nextNormals);
  } finally {
    view.setEntities([], null);
  }
});
