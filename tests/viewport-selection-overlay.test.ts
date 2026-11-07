import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { SelectionProcessingHighlight } from "../src/selection-processing-highlight";

it("discards stale selection slots on geometry changes instead of uploading NaN vertices", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const triangleSelection = new THREE.Group();
  Object.assign(view, { triangleSelection, invalidate: vi.fn() });
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  view.setTriangleSelection(positions, new Uint8Array([1, 1]));
  expect(triangleSelection.children).toHaveLength(0);
  view.setTriangleSelection(positions, new Uint8Array([1]));
  expect(triangleSelection.children).toHaveLength(1);
  const mesh = triangleSelection.children[0] as THREE.Mesh;
  expect(
    Array.from(mesh.geometry.getAttribute("position").array).every(
      Number.isFinite,
    ),
  ).toBe(true);
  view.setTriangleSelection(positions, new Uint8Array([1, 1]));
  expect(triangleSelection.children).toHaveLength(0);
});

it("renders a closed selected surface without adding an absent boundary outline", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const triangleSelection = new THREE.Group();
  Object.assign(view, {
    triangleSelection,
    selectionProcessing: new SelectionProcessingHighlight(),
    invalidate: vi.fn(),
  });
  const source = new THREE.BoxGeometry().toNonIndexed();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const positions = source.getAttribute("position").array as Float32Array;
    view.setTriangleSelection(
      positions,
      new Uint8Array(positions.length / 9).fill(1),
    );
    expect(triangleSelection.children).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
    source.dispose();
    view.setTriangleSelection();
  }
});
