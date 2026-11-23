import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ReferencePreviewDisplay } from "../src/reference-preview-display";
import type { ReferenceConstructionCachedPreview } from "../src/reference-construction-session";
function point(x = 0): ReferenceConstructionCachedPreview {
  return {
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [x, 0, 1],
      sources: [],
    },
    preview: {
      geometry: { kind: "point", position: [x, 0, 1] },
      state: { completionWord: 256 },
      outcome: "unchanged",
      diagnostics: {
        reason: "stored-coordinates",
        sourceCount: 0,
        recordCount: 0,
      },
    },
  };
}
afterEach(() => vi.restoreAllMocks());
it("blocks reentrant owner mutation during disposal", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  display.show("a", point());
  const object = scene.children[0] as THREE.Points;
  object.geometry.addEventListener("dispose", () => {
    expect(() => display.clear("a")).toThrow(/transition/);
  });
  expect(display.clear("a")).toBe(true);
  expect(display.inspect()).toEqual({ active: false });
});
it("renders a detached semantic preview without admitting it as a selectable object", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  const candidate = point(0.25);
  display.show("owner", candidate);
  expect(scene.children).toHaveLength(1);
  expect(scene.children[0].userData.objectPickable).toBe(false);
  const state = display.inspect();
  expect(state).toMatchObject({
    active: true,
    ownerId: "owner",
    state: "ready",
    geometry: { kind: "point", position: [0.25, 0, 1] },
    bounds: { min: [0.25, 0, 1], max: [0.25, 0, 1] },
  });
  if (!state.active || !state.geometry || state.geometry.kind !== "point")
    throw Error("Expected point");
  Reflect.set(state.geometry.position, 0, 99);
  expect(display.inspect()).toMatchObject({
    geometry: { position: [0.25, 0, 1] },
  });
  display.clear("owner");
  expect(scene.children).toHaveLength(0);
});
it("rejects another owner and ignores its clear without touching the current display", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  display.show("a", point());
  const object = scene.children[0];
  expect(() => display.show("b", point(1))).toThrow(/owner/);
  expect(display.clear("b")).toBe(false);
  expect(scene.children[0]).toBe(object);
  display.dispose();
});
it("preserves the existing display when a proposed extent cannot be represented", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  display.show("a", point());
  const object = scene.children[0];
  const candidate: ReferenceConstructionCachedPreview = {
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [0, 0, 0],
      end: [1, 0, 0],
      sources: [],
      records: [],
    },
    preview: {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 1e100,
      },
      state: { completionWord: 256 },
      outcome: "unchanged",
      diagnostics: {
        reason: "stored-coordinates",
        sourceCount: 0,
        recordCount: 0,
      },
    },
  };
  expect(() => display.show("a", candidate)).toThrow(/Float32/);
  expect(scene.children[0]).toBe(object);
  expect(object.visible).toBe(true);
  display.dispose();
});
it("retains only unfinished cleanup and clears the same owner on retry", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  display.show("a", point());
  const object = scene.children[0] as THREE.Points;
  const geometry = vi
      .spyOn(object.geometry, "dispose")
      .mockImplementationOnce(() => {
        throw Error("geometry failed");
      }),
    material = vi.spyOn(object.material as THREE.Material, "dispose");
  expect(() => display.clear("a")).toThrow();
  expect(display.inspect()).toMatchObject({
    active: true,
    ownerId: "a",
    state: "retiring",
    pendingDisposals: 1,
  });
  expect(material).toHaveBeenCalledOnce();
  expect(display.clear("a")).toBe(true);
  expect(geometry).toHaveBeenCalledTimes(2);
  expect(material).toHaveBeenCalledOnce();
  expect(display.inspect()).toEqual({ active: false });
});
it("retains failed current and staged display disposal until the owner retries", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  display.show("a", point());
  const old = (scene.children[0] as THREE.Points).geometry;
  const original = THREE.BufferGeometry.prototype.dispose;
  let first = true,
    second = true;
  vi.spyOn(THREE.BufferGeometry.prototype, "dispose").mockImplementation(
    function (this: THREE.BufferGeometry) {
      if (this === old && first) {
        first = false;
        throw Error("old failed");
      }
      if (this !== old && second) {
        second = false;
        throw Error("staged failed");
      }
      original.call(this);
    },
  );
  expect(() => display.show("a", point(1))).toThrow();
  expect(display.inspect()).toMatchObject({
    active: true,
    state: "retiring",
    pendingDisposals: 2,
  });
  display.clear("a");
  expect(display.inspect()).toEqual({ active: false });
  expect(scene.children).toHaveLength(0);
});
it("applies clipping to newly shown and updated preview materials", () => {
  const scene = new THREE.Scene(),
    display = new ReferencePreviewDisplay(scene);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.5);
  display.setClippingPlanes([plane]);
  display.show("a", point());
  expect((scene.children[0] as THREE.Points).material).toMatchObject({
    clippingPlanes: [plane],
  });
  display.setClippingPlanes([]);
  expect((scene.children[0] as THREE.Points).material).toMatchObject({
    clippingPlanes: [],
  });
  display.dispose();
  display.dispose();
});
