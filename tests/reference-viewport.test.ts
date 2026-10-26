import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { pickCamera } from "../src/viewport-agent";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import { createFittedPlane } from "../src/primitive-fitting";
import { createReferenceDisplay } from "../src/reference-display";
import type { Entity } from "../src/types";

function reference(kind: "point" | "line", id = kind): Entity {
  return {
    id,
    name: id,
    kind: kind === "point" ? "referencePoint" : "referenceLine",
    positions: [],
    visible: true,
    color: "#abcdef",
    opacity: 1,
    constructionOrderKey: (kind === "point" ? "01" : "02").repeat(16),
    reference: {
      version: 1,
      definition:
        kind === "point"
          ? {
              version: 1,
              kind,
              mode: "coordinates",
              position: [0, 0, 0],
              sources: [],
            }
          : {
              version: 1,
              kind,
              mode: "endpoints",
              start: [-1, 0, 0],
              end: [1, 0, 0],
              sources: [],
              records: [],
            },
      geometry:
        kind === "point"
          ? { kind, position: [0.01 + 2 ** -40, -0, 0] }
          : { kind, start: [-1, 0, 0], direction: [2, 0, 0], length: 1 },
      evaluation: { completionWord: 256 },
    },
  };
}
function fixture() {
  const view = Object.create(Viewport.prototype) as Viewport;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const target = new THREE.Vector3();
  Object.assign(view, {
    camera,
    selectedId: null,
    objects: new Map(),
    scene: new THREE.Scene(),
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        }),
      },
    },
    controls: {
      target,
      update: () => {
        camera.lookAt(target);
        camera.updateMatrixWorld(true);
      },
    },
    onSelect: vi.fn(),
    onPick: vi.fn(),
  });
  return { view, state: view as any, camera, target };
}
describe("semantic reference viewport integration", () => {
  it("rejects nonrepresentable display offsets without rewriting authoritative geometry", () => {
    const entity = reference("line");
    entity.reference!.geometry = {
      kind: "line",
      start: [0, 0, 0],
      direction: [1, 0, 0],
      length: 1e100,
    };
    const before = structuredClone(entity.reference);
    expect(() => createReferenceDisplay(entity)).toThrow(
      /display extent.*Float32/i,
    );
    expect(entity.reference).toEqual(before);
  });
  it("preserves exact large-coordinate line geometry and picks a collapsed finite line", () => {
    const { view, state } = fixture(),
      entity = reference("line");
    try {
      entity.reference!.geometry = {
        kind: "line",
        start: [1e9, 0, 0],
        direction: [1, 0, 0],
        length: 0.125,
      };
      view.setEntities([entity], null);
      expect(
        Array.from(
          state.scene.children[0].geometry.getAttribute("position").array,
        ),
      ).toEqual([0, 0, 0, 0.125, 0, 0]);
      expect(state.bounds.max.x).toBe(1e9 + 0.125);
      const collapsed: Entity = {
        ...entity,
        reference: {
          ...entity.reference!,
          geometry: {
            kind: "line",
            start: [0.01, 0, 0],
            direction: [0, 0, 0],
            length: 3,
          },
        },
      };
      view.setEntities([collapsed], null);
      expect(view.pickAgentView(0.5, 0.5, 1).hits[0]).toMatchObject({
        entityId: entity.id,
        referenceKind: "line",
        point: [0.01, 0, 0],
      });
    } finally {
      view.setEntities([], null);
    }
  });
  it("uses the same scene-scaled pick tolerance when a distant visible reference is locked", () => {
    const { view, state } = fixture();
    const p = reference("point"),
      l = reference("line");
    p.reference!.geometry = { kind: "point", position: [0.1, 0, 0] };
    l.reference!.geometry = {
      kind: "line",
      start: [100, 0, 0],
      direction: [1, 0, 0],
      length: 100,
    };
    l.locked = true;
    try {
      view.setEntities([p, l], null);
      expect(state.pickAt({ clientX: 50, clientY: 50 })).toBe(p.id);
      expect(view.pickAgentView(0.5, 0.5, 1).hits[0]?.entityId).toBe(p.id);
    } finally {
      view.setEntities([], null);
    }
  });
  it("keeps decorative CAD edge lines out of semantic object picks", () => {
    const { camera } = fixture();
    const parent = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const edges = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      new THREE.LineBasicMaterial(),
    );
    parent.userData.entityId = "cad";
    parent.add(edges);
    try {
      expect(pickCamera(camera, [parent], 0.5, 0.5, 10).hits).toEqual([]);
    } finally {
      parent.geometry.dispose();
      parent.material.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
    }
  });
  it("draws actual Points and Lines, retaining precise bounds without mesh normals or topology", () => {
    const { view, state } = fixture(),
      p = reference("point"),
      l = reference("line");
    try {
      view.setEntities([p, l], p.id);
      expect(
        state.scene.children.map((row: THREE.Object3D) => row.type),
      ).toEqual(["Points", "Line"]);
      expect(state.objects.size).toBe(0);
      for (const row of state.scene.children) {
        expect(row.geometry.getAttribute("normal")).toBeUndefined();
        expect(row.geometry.boundsTree).toBeUndefined();
        expect(row.userData.entityId).toBe(row.name);
      }
      expect(state.bounds.min.toArray()).toEqual([-1, -0, 0]);
      expect(state.bounds.max.toArray()).toEqual([1, 0, 0]);
      expect(p.positions).toEqual([]);
      expect(l.positions).toEqual([]);
    } finally {
      view.setEntities([], null);
    }
  });
  it.each(["point", "line"] as const)(
    "canvas and MCP pick the same %s without facet or cloud indices",
    (kind) => {
      const { view, state } = fixture(),
        entity = reference(kind);
      try {
        view.setEntities([entity], null);
        const agent = view.pickAgentView(0.5, 0.5, 2).hits[0];
        expect(agent).toMatchObject({
          entityId: entity.id,
          referenceKind: kind,
          triangleIndex: null,
        });
        expect(agent).not.toHaveProperty("pointIndex");
        const picked = state.pickAt({ clientX: 50, clientY: 50 });
        expect(picked).toBe(entity.id);
        expect(state.onPick).toHaveBeenCalledWith(
          agent.point,
          entity.id,
          undefined,
        );
        if (kind === "point")
          expect(agent.point).toEqual(
            entity.reference!.geometry.kind === "point"
              ? entity.reference!.geometry.position
              : [],
          );
        const choices = view.selectionChoicesAt({ clientX: 50, clientY: 50 });
        expect(choices.map((row) => row.id)).toEqual([entity.id]);
        choices[0].choose();
        expect(state.onPick).toHaveBeenLastCalledWith(
          agent.point,
          entity.id,
          undefined,
        );
      } finally {
        view.setEntities([], null);
      }
    },
  );
  it.each(["point", "line"] as const)(
    "%s picking respects visibility, protection, clipping and brush exclusion",
    (kind) => {
      const { view, state } = fixture(),
        entity = reference(kind);
      try {
        for (const patch of [
          { visible: false },
          { locked: true },
          { selectable: false },
        ]) {
          view.setEntities([{ ...entity, ...patch }], null);
          expect(view.pickAgentView(0.5, 0.5, 1).hits).toEqual([]);
          expect(state.pickAt({ clientX: 50, clientY: 50 })).toBeUndefined();
        }
        Object.assign(state, {
          clipping: true,
          clippingPlane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -2),
        });
        view.setEntities([entity], null);
        expect(view.pickAgentView(0.5, 0.5, 1).hits).toEqual([]);
        expect(view.selectionChoicesAt({ clientX: 50, clientY: 50 })).toEqual(
          [],
        );
        state.clipping = false;
        view.setEntities([entity], null);
        Object.assign(state, {
          brushing: true,
          selectionTool: "wand",
          onSelection: vi.fn(),
        });
        expect(state.pickAt({ clientX: 50, clientY: 50 })).toBeUndefined();
        expect(state.onSelection).not.toHaveBeenCalled();
      } finally {
        view.setEntities([], null);
      }
    },
  );
  it("retains display buffers for metadata changes and disposes replaced and removed resources", () => {
    const { view, state } = fixture(),
      entity = reference("line");
    view.setEntities([entity], null);
    const old = state.scene.children[0];
    const geometry = vi.spyOn(old.geometry, "dispose"),
      material = vi.spyOn(old.material, "dispose");
    view.setEntities(
      [{ ...entity, opacity: 0.4, color: "#112233" }],
      entity.id,
    );
    expect(state.scene.children[0]).toBe(old);
    expect(old.material.opacity).toBe(0.4);
    expect(geometry).not.toHaveBeenCalled();
    const next: Entity = {
      ...entity,
      reference: {
        ...entity.reference!,
        geometry: {
          kind: "line",
          start: [10, 20, 30],
          direction: [0, 2, 0],
          length: 2,
        },
      },
    };
    view.setEntities([next], next.id);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(state.bounds.min.toArray()).toEqual([10, 20, 30]);
    expect(state.bounds.max.toArray()).toEqual([10, 24, 30]);
    const current = state.scene.children[0],
      disposed = vi.spyOn(current.geometry, "dispose");
    view.setEntities([], null);
    expect(disposed).toHaveBeenCalledOnce();
    expect(state.scene.children).toHaveLength(0);
  });
  it("fits a reference-only scene and an explicit reference in a mixed scene", () => {
    const { view, state, target } = fixture(),
      line = reference("line");
    line.reference!.geometry = {
      kind: "line",
      start: [10, 20, 30],
      direction: [0, 2, 0],
      length: 2,
    };
    const mesh: Entity = {
      id: "mesh",
      name: "mesh",
      kind: "mesh",
      positions: [100, 100, 100, 101, 100, 100, 100, 101, 100],
      visible: true,
      color: "#ffffff",
      opacity: 1,
    };
    try {
      view.setEntities([line], line.id);
      view.fitView();
      expect(target.toArray()).toEqual([10, 22, 30]);
      view.setEntities([mesh, line], line.id);
      view.fitView(line.id);
      expect(target.toArray()).toEqual([10, 22, 30]);
      expect(state.bounds.max.toArray()).toEqual([101, 101, 100]);
      view.setEntities([{ ...line, visible: false }], null);
      expect(state.bounds.isEmpty()).toBe(true);
    } finally {
      view.setEntities([], null);
    }
  });
  it("retires both display families when an ID changes between mesh and reference", () => {
    const { view, state } = fixture(),
      entity = reference("point");
    const mesh: Entity = {
      ...entity,
      kind: "mesh",
      reference: undefined,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    };
    try {
      view.setEntities([mesh], mesh.id);
      const oldMesh = state.scene.children[0],
        disposedMesh = vi.spyOn(oldMesh.geometry, "dispose");
      view.setEntities([entity], entity.id);
      expect(disposedMesh).toHaveBeenCalledOnce();
      expect(state.objects.size).toBe(0);
      const point = state.scene.children[0],
        disposedPoint = vi.spyOn(point.geometry, "dispose");
      view.setEntities([mesh], mesh.id);
      expect(disposedPoint).toHaveBeenCalledOnce();
      expect(state.scene.children).toHaveLength(1);
      expect(state.scene.children[0]).toBeInstanceOf(THREE.Mesh);
      expect(state.referenceObjects.size).toBe(0);
    } finally {
      view.setEntities([], null);
    }
  });
});

it("canvas and MCP pick a coordinate frame without triangle or cloud indices", () => {
  const { view, state } = fixture();
  const frame: Entity = {
    id: "frame",
    name: "Named frame",
    kind: "referenceFrame",
    positions: [],
    visible: true,
    color: "#ffbb44",
    opacity: 1,
    coordinateFrame: {
      version: 1,
      frame: {
        origin: [0, 0, 0],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
      displaySize: 2,
    },
  };
  try {
    view.setEntities([frame], frame.id);
    expect(state.objects.size).toBe(0);
    const hit = view.pickAgentView(0.5, 0.5, 1).hits[0];
    expect(hit).toMatchObject({
      entityId: "frame",
      referenceKind: "frame",
      triangleIndex: null,
    });
    expect(hit).not.toHaveProperty("pointIndex");
    expect(state.pickAt({ clientX: 50, clientY: 50 })).toBe("frame");
    expect(state.onPick).toHaveBeenCalledWith(hit.point, "frame", undefined);
  } finally {
    view.setEntities([], null);
  }
});

it("renders and picks a small numeric plane at a large origin without narrowing world geometry", () => {
  const { view, state, camera, target } = fixture();
  const plane = createNumericDatumPlane(
    numericDatumFrame([100000000.125, -20, 30], [0, 0, 1], [1, 0, 0]),
    0.125,
    "plane",
    "Precise plane",
  );
  const source = plane.positions,
    before = Array.from(source);
  target.set(100000000.125, -20, 30);
  camera.position.set(100000000.125, -20, 40);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  try {
    view.setEntities([plane], plane.id);
    const item = state.objects.get(plane.id),
      mesh = item.mesh;
    expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual([
      -0.0625, -0.0625, 0, 0.0625, -0.0625, 0, 0.0625, 0.0625, 0, -0.0625,
      -0.0625, 0, 0.0625, 0.0625, 0, -0.0625, 0.0625, 0,
    ]);
    expect(state.bounds.min.toArray()).toEqual([100000000.0625, -20.0625, 30]);
    expect(state.bounds.max.toArray()).toEqual([100000000.1875, -19.9375, 30]);
    expect(view.pickAgentView(0.5, 0.5, 1).hits[0]).toMatchObject({
      entityId: "plane",
      point: [100000000.125, -20, 30],
    });
    expect(state.pickAt({ clientX: 50, clientY: 50 })).toBe("plane");
    expect(plane.positions).toBe(source);
    expect(Array.from(source)).toEqual(before);
    view.setEntities(
      [{ ...plane, kind: "mesh", planeFrame: undefined }],
      plane.id,
    );
    expect(state.objects.get(plane.id).mesh.matrix.elements).toEqual(
      new THREE.Matrix4().elements,
    );
  } finally {
    view.setEntities([], null);
  }
});

it("keeps numeric-plane selection overlays in the same precise local coordinate space", () => {
  const { view, state } = fixture();
  state.triangleSelection = new THREE.Group();
  const plane = createNumericDatumPlane(
    numericDatumFrame([100000000.125, -20, 30], [0, 0, 1]),
    0.125,
    "p",
    "p",
  );
  try {
    view.setEntities([plane], plane.id);
    view.setTriangleSelection(plane.positions, Uint8Array.of(1, 0));
    expect(state.triangleSelection.position.toArray()).toEqual([
      100000000.125, -20, 30,
    ]);
    expect(
      Array.from(
        state.triangleSelection.children[0].geometry.getAttribute("position")
          .array,
      ),
    ).toEqual([-0.0625, -0.0625, 0, 0.0625, -0.0625, 0, 0.0625, 0.0625, 0]);
    view.setEntities(
      [{ ...plane, kind: "mesh", planeFrame: undefined }],
      plane.id,
    );
    view.setTriangleSelection(plane.positions, Uint8Array.of(1, 0));
    expect(state.triangleSelection.position.toArray()).toEqual([0, 0, 0]);
  } finally {
    view.setTriangleSelection();
    view.setEntities([], null);
  }
});
it("keeps expanded indexed-plane deviation geometry local and restores its compact carrier", () => {
  const { view, state } = fixture();
  const plane = createNumericDatumPlane(
    numericDatumFrame([100000000.125, -20, 30], [0, 0, 1]),
    0.125,
    "p",
    "p",
  );
  plane.indexedMesh = {
    vertices: [
      100000000.0625, -20.0625, 30, 100000000.1875, -20.0625, 30,
      100000000.1875, -19.9375, 30, 100000000.0625, -19.9375, 30,
    ],
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    geometryNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  };
  try {
    view.setEntities([plane], plane.id);
    const mesh = state.objects.get(plane.id).mesh,
      original = mesh.geometry;
    expect(original.getAttribute("position").count).toBe(4);
    view.setDeviation(plane.id, [1, 2, 3, 4, 5, 6], 1);
    expect(mesh.geometry).not.toBe(original);
    expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual([
      -0.0625, -0.0625, 0, 0.0625, -0.0625, 0, 0.0625, 0.0625, 0, -0.0625,
      -0.0625, 0, 0.0625, 0.0625, 0, -0.0625, 0.0625, 0,
    ]);
    view.setDeviation(plane.id, null, 1);
    expect(mesh.geometry).toBe(original);
  } finally {
    view.setEntities([], null);
  }
});

it("uses the same local render precision for fitted planes", () => {
  const { view, state } = fixture();
  const plane = createFittedPlane(
    {
      kind: "plane",
      center: [100000000.125, -20, 30],
      axis: [0, 0, 1],
      rms: 0,
      maxError: 0,
    },
    0.125,
  );
  try {
    view.setEntities([plane], plane.id);
    expect(
      state.objects
        .get(plane.id)
        .mesh.geometry.getAttribute("position")
        .getX(0),
    ).toBe(-0.0625);
    expect(state.bounds.max.x - state.bounds.min.x).toBe(0.125);
  } finally {
    view.setEntities([], null);
  }
});

it.each(["numeric", "fitted"] as const)(
  "retains unit display normals on a small %s plane at a large origin",
  (kind) => {
    const { view, state } = fixture();
    const plane =
      kind === "numeric"
        ? createNumericDatumPlane(
            numericDatumFrame([100000000.125, -20, 30], [0, 0, 1], [1, 0, 0]),
            0.125,
            "plane",
            "Precise plane",
          )
        : createFittedPlane(
            {
              kind: "plane",
              center: [100000000.125, -20, 30],
              axis: [0, 0, 1],
              rms: 0,
              maxError: 0,
            },
            0.125,
          );
    try {
      view.setEntities([plane], plane.id);
      const normals = state.objects
        .get(plane.id)
        .mesh.geometry.getAttribute("normal");
      expect(normals.count).toBe(plane.positions.length / 3);
      for (let i = 0; i < normals.count; i++) {
        const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)];
        expect(normal.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...normal)).toBeCloseTo(1, 7);
        expect(normal).toEqual([0, 0, 1]);
      }
    } finally {
      view.setEntities([], null);
    }
  },
);

function coordinateGestureFixture(tool: "line" | "trim") {
  const f = fixture();
  const capture = new Set<number>();
  Object.assign(f.state.renderer.domElement, {
    style: {},
    setPointerCapture: (id: number) => capture.add(id),
    hasPointerCapture: (id: number) => capture.has(id),
    releasePointerCapture: (id: number) => capture.delete(id),
  });
  const beginDraw = vi.fn(() => 17),
    beginTrim = vi.fn(() => 17);
  const onDraw = vi.fn(),
    onTrim = vi.fn();
  Object.assign(f.state, {
    sketchEditor: {
      sketch: { version: 1, points: [], segments: [], constraints: [] },
      tool,
      constraints: false,
      trimRadiusMm: 0.25,
      beginDraw,
      beginTrim,
      onDraw,
      onTrim,
      onError: vi.fn(),
    },
    sketchGeometry: new THREE.Group(),
    sketchPreview: new THREE.Group(),
    sketchCurvePoints: [],
    sketchCurveRawPoints: [],
    sketchPlanePoint: vi.fn(() => [1, 2]),
    renderSketchDrag: vi.fn(),
    setBrush: vi.fn((enabled: boolean) => {
      f.state.brushing = enabled;
    }),
    paintTrail: { setAttribute: vi.fn() },
    selectionOverlay: { hidden: true },
  });
  return { ...f, capture, beginDraw, beginTrim, onDraw, onTrim };
}

it.each(["line", "trim"] as const)(
  "suspends active sketch %s gestures while acquiring a reference coordinate",
  (tool) => {
    const f = coordinateGestureFixture(tool);
    f.view.setReferenceCoordinatePicking(true);
    const event = {
      clientX: 50,
      clientY: 50,
      button: 0,
      isPrimary: true,
      pointerId: 9,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as PointerEvent;
    expect(f.state.beginSketchDrag(event)).toBe(false);
    expect(f.beginDraw).not.toHaveBeenCalled();
    expect(f.beginTrim).not.toHaveBeenCalled();
    expect(f.onDraw).not.toHaveBeenCalled();
    expect(f.onTrim).not.toHaveBeenCalled();
    expect(f.state.sketchDrag).toBeUndefined();
    expect(f.capture.size).toBe(0);
    // Exiting acquisition resumes the same editor, without publishing a drawing.
    f.view.setReferenceCoordinatePicking(false);
    expect(f.state.beginSketchDrag(event)).toBe(true);
    expect(tool === "trim" ? f.beginTrim : f.beginDraw).toHaveBeenCalledOnce();
    f.state.cancelSketchDrag();
    expect(f.onDraw).not.toHaveBeenCalled();
    expect(f.onTrim).not.toHaveBeenCalled();
  },
);

it("retires pending sketch capture, defining picks and trim preview when entering reference coordinate acquisition", () => {
  const f = coordinateGestureFixture("line");
  const controller = new AbortController();
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial();
  const disposed = vi.spyOn(geometry, "dispose");
  f.state.sketchPreview.add(new THREE.Line(geometry, material));
  f.capture.add(17);
  Object.assign(f.state, {
    sketchDrag: { id: 17, start: [0, 0], end: [1, 2], tolerance: 0.1 },
    sketchCurvePoints: [
      [1, 2],
      [3, 4],
    ],
    sketchCurveRawPoints: [
      [1.1, 2.1],
      [3.1, 4.1],
    ],
    sketchCurveRevision: 17,
    trimPreviewPending: true,
    trimPreviewController: controller,
  });
  f.view.setReferenceCoordinatePicking(true);
  expect(f.capture.size).toBe(0);
  expect(f.state.sketchDrag).toBeUndefined();
  expect(f.state.sketchCurvePoints).toEqual([]);
  expect(f.state.sketchCurveRawPoints).toEqual([]);
  expect(f.state.sketchCurveRevision).toBeUndefined();
  expect(f.state.trimPreviewPending).toBe(false);
  expect(controller.signal.aborted).toBe(true);
  expect(f.state.sketchPreview.children).toHaveLength(0);
  expect(disposed).toHaveBeenCalledOnce();
  expect(f.onDraw).not.toHaveBeenCalled();
  expect(f.onTrim).not.toHaveBeenCalled();
});
