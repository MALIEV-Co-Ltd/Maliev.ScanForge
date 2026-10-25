import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { pickCamera } from "../src/viewport-agent";
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
