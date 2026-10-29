import { expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Entity } from "../src/types";
import {
  createReferenceDisplay,
  updateReferenceDisplay,
} from "../src/reference-display";
const entity = (): Entity => ({
  id: "frame",
  name: "Coordinate system",
  kind: "referenceFrame",
  positions: [],
  color: "#ffbb44",
  opacity: 1,
  visible: true,
  coordinateFrame: {
    version: 1,
    frame: {
      origin: [100000000.125, 3, 4],
      u: [0, 1, 0],
      v: [-1, 0, 0],
      normal: [0, 0, 1],
    },
    displaySize: 10,
  },
});
it("renders three local axes with authoritative world bounds and exact semantic picking", () => {
  const frame = entity(),
    display = createReferenceDisplay(frame);
  expect(display.object.type).toBe("LineSegments");
  expect(display.object.position.toArray()).toEqual([100000000.125, 3, 4]);
  expect(display.object.geometry.getAttribute("position").count).toBe(6);
  expect(display.bounds.min.toArray()).toEqual([99999990.125, 3, 4]);
  expect(display.bounds.max.toArray()).toEqual([100000000.125, 13, 14]);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(100000000.125, 8, 100),
    new THREE.Vector3(0, 0, -1),
  );
  ray.params.Line.threshold = 0.1;
  const hits: THREE.Intersection[] = [];
  display.object.raycast(ray, hits);
  expect(hits).toHaveLength(1);
  expect(hits[0].point.toArray()).toEqual([100000000.125, 8, 4]);
  expect(display.object.userData.entityId).toBe("frame");
  updateReferenceDisplay(display, { ...frame, locked: true, visible: false });
  expect(display.object.visible).toBe(false);
  expect(display.object.userData.objectPickable).toBe(false);
  const geometry = vi.spyOn(display.object.geometry, "dispose"),
    material = vi.spyOn(display.object.material, "dispose");
  display.dispose();
  display.dispose();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
});
