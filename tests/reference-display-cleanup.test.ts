import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createReferenceDisplay } from "../src/reference-display";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";
function entity(x = 0): Entity {
  return {
    id: "reference",
    name: "Reference",
    kind: "referencePoint",
    positions: [],
    visible: true,
    color: "#bb00cc",
    opacity: 1,
    constructionOrderKey: "01".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [x, 0, 0],
        sources: [],
      },
      geometry: { kind: "point", position: [x, 0, 0] },
      evaluation: { completionWord: 256 },
    },
  };
}
function fixture() {
  const view = Object.create(Viewport.prototype) as Viewport;
  const state = view as any;
  Object.assign(state, {
    objects: new Map(),
    selectedId: null,
    scene: new THREE.Scene(),
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(),
    onPick: vi.fn(),
    onSelect: vi.fn(),
  });
  return { view, state };
}
afterEach(() => vi.restoreAllMocks());
it("does not recursively dispose resources from a disposal callback", () => {
  const display = createReferenceDisplay(entity());
  const original = display.object.geometry.dispose.bind(
    display.object.geometry,
  );
  const geometry = vi
    .spyOn(display.object.geometry, "dispose")
    .mockImplementation(() => {
      display.dispose();
      original();
    });
  const material = vi.spyOn(display.object.material, "dispose");
  display.dispose();
  display.dispose();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
});
it("attempts both resources and retries only failed geometry disposal", () => {
  const display = createReferenceDisplay(entity());
  const scene = new THREE.Scene();
  scene.add(display.object);
  const geometry = vi
    .spyOn(display.object.geometry, "dispose")
    .mockImplementationOnce(() => {
      throw Error("geometry failed");
    });
  const material = vi.spyOn(display.object.material, "dispose");
  expect(() => display.dispose()).toThrow();
  expect(material).toHaveBeenCalledOnce();
  expect(scene.children).toHaveLength(0);
  display.dispose();
  display.dispose();
  expect(geometry).toHaveBeenCalledTimes(2);
  expect(material).toHaveBeenCalledOnce();
});
it("retries only failed material disposal without repeating successful geometry work", () => {
  const display = createReferenceDisplay(entity());
  const geometry = vi.spyOn(display.object.geometry, "dispose");
  const material = vi
    .spyOn(display.object.material, "dispose")
    .mockImplementationOnce(() => {
      throw Error("material failed");
    });
  expect(() => display.dispose()).toThrow();
  display.dispose();
  display.dispose();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledTimes(2);
});
it("hides the object and attempts resources even if scene removal fails", () => {
  const display = createReferenceDisplay(entity());
  const scene = new THREE.Scene();
  scene.add(display.object);
  const remove = vi
    .spyOn(display.object, "removeFromParent")
    .mockImplementationOnce(() => {
      throw Error("remove failed");
    });
  const geometry = vi.spyOn(display.object.geometry, "dispose"),
    material = vi.spyOn(display.object.material, "dispose");
  expect(() => display.dispose()).toThrow();
  expect(display.object.visible).toBe(false);
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
  display.dispose();
  expect(scene.children).toHaveLength(0);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(geometry).toHaveBeenCalledOnce();
});
it("disposes an unpublished replacement when retiring its old display fails", () => {
  const { view, state } = fixture();
  view.setEntities([entity()], null);
  const old = state.referenceObjects.get("reference");
  const disposed: THREE.BufferGeometry[] = [];
  const original = THREE.BufferGeometry.prototype.dispose;
  vi.spyOn(THREE.BufferGeometry.prototype, "dispose").mockImplementation(
    function (this: THREE.BufferGeometry) {
      disposed.push(this);
      original.call(this);
    },
  );
  vi.spyOn(old.object.geometry, "dispose").mockImplementationOnce(() => {
    throw Error("old failed");
  });
  expect(() => view.setEntities([entity(1)], null)).toThrow();
  expect(disposed.some((item) => item !== old.object.geometry)).toBe(true);
  view.setEntities([], null);
  expect(state.referenceObjects.size).toBe(0);
  expect(state.referenceDisposals.size).toBe(0);
});
it("retains both failed retirements until a later update retries them", () => {
  const { view, state } = fixture();
  view.setEntities([entity()], null);
  const old = state.referenceObjects.get("reference");
  const original = THREE.BufferGeometry.prototype.dispose;
  let oldFailed = false,
    nextFailed = false;
  vi.spyOn(THREE.BufferGeometry.prototype, "dispose").mockImplementation(
    function (this: THREE.BufferGeometry) {
      if (this === old.object.geometry && !oldFailed) {
        oldFailed = true;
        throw Error("old failed");
      }
      if (this !== old.object.geometry && !nextFailed) {
        nextFailed = true;
        throw Error("replacement failed");
      }
      original.call(this);
    },
  );
  expect(() => view.setEntities([entity(1)], null)).toThrow();
  expect(state.referenceDisposals.size).toBe(2);
  view.setEntities([], null);
  expect(state.referenceDisposals.size).toBe(0);
  expect(state.referenceObjects.size).toBe(0);
});
it("recreates a previously retired display after a failed replacement", () => {
  const { view, state } = fixture();
  const original = entity();
  view.setEntities([original], null);
  const old = state.referenceObjects.get("reference");
  vi.spyOn(old.object.geometry, "dispose").mockImplementationOnce(() => {
    throw Error("old failed");
  });
  expect(() => view.setEntities([entity(1)], null)).toThrow();
  view.setEntities([original], null);
  const replacement = state.referenceObjects.get("reference");
  expect(replacement).not.toBe(old);
  expect(replacement.object.parent).toBe(state.scene);
  view.setEntities([], null);
});
