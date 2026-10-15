import * as THREE from "three";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  captureInteractiveCamera,
  interactiveDragForCamera,
} from "../src/interactive-camera";
const native = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/interactive-world-projection-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: any[] };
it.each(
  native.cases.filter(
    (c) => c.frame === 1 && c.anchor.every((n: number) => n === 0) && !c.setup,
  ),
)(
  "adapts the real camera to native projection for $point / screen=$pixelMode",
  (c) => {
    const camera = c.pixelMode
      ? new THREE.PerspectiveCamera()
      : new THREE.OrthographicCamera(-100, 100, 50, -50);
    camera.position.set(-3.125, 2.5, 20);
    const target = new THREE.Vector3(-3.125, 2.5, -50000.1);
    camera.lookAt(target);
    camera.projectionMatrix.fromArray(c.projection);
    const context = captureInteractiveCamera(
      camera,
      target,
      new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
      800,
      600,
    );
    const projected = context.project(c.point);
    expect(
      Buffer.from(Float64Array.from(projected).buffer).toString("hex"),
    ).toBe(c.outputBits);
  },
);
it("uses the native threshold then produces incremental drag input in both projections", () => {
  for (const camera of [
    new THREE.OrthographicCamera(-100, 100, 75, -75),
    new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000),
  ]) {
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    const context = captureInteractiveCamera(
      camera,
      new THREE.Vector3(),
      new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
      800,
      600,
    );
    const input = {
      handle: 4,
      from: [0.5, 0.5],
      to: [0.505, 0.5],
      pivot: [0, 0, 0],
      strength: 100,
    };
    expect(interactiveDragForCamera(context, input)).toBe(null);
    const active = interactiveDragForCamera(context, {
      ...input,
      continuation: true,
    });
    expect(active).not.toBe(null);
    expect(active!.mode).toBe(4);
    expect(active!.delta[0]).toBeGreaterThan(0);
    expect(active!.original).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  }
});
