import { expect, it } from "vitest";
import * as THREE from "three";
import { installSelectionBoundaryAttributes } from "../src/selection-boundary-highlight";

it("glows around the selection outline without glowing on the shared diagonal", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
      3,
    ),
  );
  const segments = installSelectionBoundaryAttributes(geometry);
  expect(segments).toHaveLength(24);
  const flags = geometry.getAttribute("processingBoundary");
  expect(Array.from(flags.array)).toEqual([
    1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0,
  ]);
  expect(
    Array.from(geometry.getAttribute("processingBarycentric").array),
  ).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  geometry.dispose();
});
