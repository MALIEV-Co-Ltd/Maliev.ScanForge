import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractiveMovement } from "../src/interactive-alignment-math";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/interactive-movement-controller-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  transforms: number[][];
  cases: {
    mode: number;
    strength: number;
    previous: number[];
    current: number[];
    waiting: boolean;
    planes: number[][];
    movementBits: string[];
    dragWaiting: number;
    view: number;
  }[];
};
it.each(fixture.cases.map((c, index) => ({ ...c, index })))(
  "matches original movement controller $index",
  (c) => {
    const result = nativeInteractiveMovement({
      mode: c.mode,
      strength: c.strength,
      previousPixel: c.previous,
      currentPixel: c.current,
      waiting: c.waiting,
      previousPlane: c.planes[1],
      currentPlane: c.planes[0],
      view: fixture.transforms[c.view],
    });
    expect(result.waiting).toBe(!!c.dragWaiting);
    expect(
      result.movement
        ? [
            Buffer.from(Float32Array.from(result.movement).buffer).toString(
              "hex",
            ),
          ]
        : [],
    ).toEqual(c.movementBits);
  },
);
