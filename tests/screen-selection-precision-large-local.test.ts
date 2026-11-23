/// <reference types="node" />
import { expect, it } from "vitest";
import * as THREE from "three";
import { ScreenSelectionIndex } from "../src/screen-selection";
it.skipIf(!process.env.SCANFORGE_M2_LARGE_SELECTION)(
  "selects a large precise mesh under the job limit",
  () => {
    const count = 400000,
      values = new Array<number>(count * 9),
      x = 100000000;
    for (let i = 0; i < count; i++) {
      const a = x + (i % 1000) * 8,
        b = Math.floor(i / 1000) * 8,
        j = i * 9;
      values[j] = a;
      values[j + 1] = b;
      values[j + 2] = 0;
      values[j + 3] = a + 4;
      values[j + 4] = b;
      values[j + 5] = 0;
      values[j + 6] = a + 4;
      values[j + 7] = b + 4;
      values[j + 8] = 0;
    }
    const index = new ScreenSelectionIndex(values),
      camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
    camera.position.set(x + 2, 2, 10);
    camera.lookAt(x + 2, 2, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    try {
      const mask = index.select(
        camera,
        { kind: "rectangle", start: [0, 0], end: [200, 200] },
        { width: 200, height: 200, through: false },
      );
      expect(mask.length).toBe(count);
      expect(mask[0]).toBe(1);
      expect(mask.reduce((s, n) => s + n, 0)).toBe(1);
      expect(values[3]).toBe(x + 4);
    } finally {
      index.dispose();
    }
  },
);
