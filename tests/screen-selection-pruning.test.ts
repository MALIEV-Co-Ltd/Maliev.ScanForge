import { expect, it } from "vitest";
import * as THREE from "three";
import {
  ScreenSelectionIndex,
  type ScreenRegion,
} from "../src/screen-selection";
import captures from "./fixtures/screen-selection-linear-masks.json";

// Frozen masks from the previous full-triangle scan, using synthetic geometry.
// Cover both projections, eye-plane crossings, hidden-slot mapping and occlusion.
it("spatial pruning preserves all 64 captured linear-scan facet masks", () => {
  let state = 9137;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const positions = new Float32Array(512 * 9);
  for (let i = 0; i < 512; i++) {
    const x = random() * 10 - 5,
      y = random() * 10 - 5,
      z = random() * 10 - 5;
    positions.set([x, y, z, x + random(), y, z, x, y + random(), z], i * 9);
  }
  const regions: ScreenRegion[] = [
    { kind: "rectangle", start: [50, 80], end: [280, 250] },
    { kind: "circle", start: [80, 80], end: [250, 260] },
    {
      kind: "lasso",
      points: [
        [70, 100],
        [250, 80],
        [210, 170],
        [290, 260],
        [90, 250],
      ],
      radius: 8,
    },
    {
      kind: "brush",
      points: [
        [90, 90],
        [170, 250],
        [280, 160],
      ],
      radius: 12,
    },
  ];
  for (const ortho of [true, false])
    for (const crossing of [false, true])
      for (const hidden of [false, true]) {
        const index = new ScreenSelectionIndex(
          positions,
          hidden ? Array.from({ length: 47 }, (_, i) => i * 11) : [],
        );
        const camera = ortho
          ? new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 30)
          : new THREE.PerspectiveCamera(55, 1, 0.1, 30);
        camera.position.set(0, 0, crossing ? 0.3 : 12);
        camera.lookAt(0, 0, -2);
        camera.updateMatrixWorld();
        try {
          for (const capture of captures.filter(
            (c) =>
              c.ortho === ortho &&
              c.crossing === crossing &&
              c.hidden === hidden,
          )) {
            const mask = index.select(camera, regions[capture.region], {
              width: 320,
              height: 320,
              through: capture.through,
            });
            expect(
              Array.from(mask).flatMap((value, slot) => (value ? [slot] : [])),
            ).toEqual(capture.slots);
            expect(mask.reduce((a, b) => a + b, 0)).toBe(capture.count);
          }
        } finally {
          index.dispose();
        }
      }
});
