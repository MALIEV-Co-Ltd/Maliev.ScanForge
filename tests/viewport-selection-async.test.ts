import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";

function fixture() {
  let resolve!: (mask: Uint8Array) => void;
  let reject!: (error: Error) => void;
  const index = {
    select: vi.fn(
      () =>
        new Promise<Uint8Array>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    ),
    cancel: vi.fn(),
  };
  const item = {
    mesh: { visible: true, material: { clippingPlanes: [] } },
    selectionIndex: index,
  };
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    selectedId: "scan",
    objects: new Map([["scan", item]]),
    camera: new THREE.OrthographicCamera(),
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ width: 640, height: 480 }),
      },
    },
    onSelection: vi.fn(),
    onSelectionStatus: vi.fn(),
    onSelectionError: vi.fn(),
    selectionGeneration: 1,
  });
  const start = () =>
    view.applyScreenRegion(
      { altKey: true },
      {
        kind: "lasso",
        points: [
          [20, 20],
          [40, 20],
          [40, 40],
        ],
        radius: 2,
      },
    );
  return {
    view,
    item,
    index,
    start,
    resolve: (mask: Uint8Array) => resolve(mask),
    reject: (error: Error) => reject(error),
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
it("rejects a pending selection when clipping limits change", async () => {
  const f = fixture();
  f.view.invalidate = vi.fn();
  f.start();
  f.view.setMeshClipBox("scan", { min: [0, 0, 0], max: [1, 1, 1] });
  f.resolve(new Uint8Array([1]));
  await flush();
  expect(f.view.onSelection).not.toHaveBeenCalled();
  expect(f.index.cancel).toHaveBeenCalled();
});

it("commits the worker result asynchronously and preserves Alt subtraction", async () => {
  const f = fixture();
  f.start();
  expect(f.view.onSelection).not.toHaveBeenCalled();
  expect(f.view.onSelectionStatus).toHaveBeenCalledWith("pending");
  const mask = new Uint8Array([1, 0, 1]);
  f.resolve(mask);
  await flush();
  expect(f.view.onSelection).toHaveBeenCalledExactlyOnceWith(
    "scan",
    mask,
    true,
  );
  expect(f.view.onSelectionStatus).toHaveBeenLastCalledWith("complete");
});
it.each(["generation", "index", "item", "selected", "disposed"])(
  "rejects stale selection results after %s changes",
  async (change) => {
    const f = fixture();
    f.start();
    if (change === "generation") f.view.selectionGeneration++;
    else if (change === "index") f.item.selectionIndex = { ...f.index };
    else if (change === "item") f.view.objects.set("scan", { ...f.item });
    else if (change === "selected") f.view.selectedId = "other";
    else f.view.disposed = true;
    f.resolve(new Uint8Array([1]));
    await flush();
    expect(f.view.onSelection).not.toHaveBeenCalled();
  },
);
it("silently handles superseded worker requests", async () => {
  const f = fixture();
  f.start();
  f.reject(new DOMException("superseded", "AbortError"));
  await flush();
  expect(f.view.onSelectionError).not.toHaveBeenCalled();
  expect(f.view.onSelectionStatus).toHaveBeenLastCalledWith("complete");
});
