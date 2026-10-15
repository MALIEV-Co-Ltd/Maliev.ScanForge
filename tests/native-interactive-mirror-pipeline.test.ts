import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import manifest from "./fixtures/interactive-mirror-pipeline-native.manifest.json";
import {
  nativeInteractiveViewPoint,
  nativeInteractiveMirrorDirection,
  nativeInteractiveMirrorModelMatrix,
  nativeInteractiveMirrorPlane,
} from "../src/interactive-mirror-view";
const compressed = readFileSync(
  new URL(
    "./fixtures/interactive-mirror-pipeline-native.json.gz",
    import.meta.url,
  ),
);
const raw = gunzipSync(compressed);
const native = JSON.parse(raw.toString()) as {
  frames: number[][];
  anchors: number[][];
  poses: number[][];
  pointCases: {
    frame: number;
    anchor: number;
    point: number[];
    resultBits: string;
  }[];
  cases: {
    frame: number;
    anchor: number;
    pose: number;
    plane: number;
    backfaces: boolean;
    draw: { directionBits: string; matrices: number[][] };
  }[];
  wrapper: {
    cases: { plane: number; events: { kind: string; bits?: string }[] }[];
  };
};
const doubleBits = (v: readonly number[]) =>
  Buffer.from(new Float64Array(v).buffer).toString("hex");
const floatBits = (v: ArrayLike<number>) =>
  Buffer.from(Float32Array.from(v).buffer).toString("hex");
it("binds complete native camera and renderer captures to their immutable fixture", () => {
  expect(createHash("sha256").update(raw).digest("hex")).toBe(
    manifest.rawSha256,
  );
  expect(createHash("sha256").update(compressed).digest("hex")).toBe(
    manifest.compressedSha256,
  );
  expect(native.pointCases).toHaveLength(48);
  expect(native.cases).toHaveLength(288);
});
it.each(native.pointCases.map((c, index) => ({ ...c, index })))(
  "matches native view-point Double bytes $index",
  (c) => {
    expect(
      doubleBits(
        nativeInteractiveViewPoint(
          native.frames[c.frame],
          native.anchors[c.anchor],
          c.point,
        ),
      ),
    ).toBe(c.resultBits);
  },
);
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches complete renderer direction and Float32 pose submission $index",
  (c) => {
    expect(
      floatBits(
        nativeInteractiveMirrorDirection(
          native.frames[c.frame],
          native.anchors[c.anchor],
        ),
      ),
    ).toBe(c.draw.directionBits);
    expect(
      floatBits(nativeInteractiveMirrorModelMatrix(native.poses[c.pose])),
    ).toBe(floatBits(c.draw.matrices.at(-1)!));
  },
);
it("matches reflection matrices emitted by the complete original wrapper", () => {
  let matched = 0;
  for (const c of native.wrapper.cases)
    for (const event of c.events)
      if (event.kind === "matrix") {
        expect(doubleBits(nativeInteractiveMirrorPlane(c.plane))).toBe(
          event.bits,
        );
        matched++;
      }
  expect(matched).toBe(6);
});
it("retains Float32 endpoint cancellation instead of normalizing a camera axis", () => {
  expect(
    nativeInteractiveMirrorDirection(native.frames[0], native.anchors[2]),
  ).toEqual([0, 0, 0]);
  expect(
    nativeInteractiveMirrorDirection(native.frames[3], native.anchors[1]),
  ).toEqual([4, 0, 0]);
});
it("rejects malformed or nonfinite view/pose inputs before display publication", () => {
  expect(() => nativeInteractiveViewPoint([], [0, 0, 0], [0, 0, 0])).toThrow();
  expect(() =>
    nativeInteractiveMirrorDirection(native.frames[0], [Infinity, 0, 0]),
  ).toThrow();
  expect(() =>
    nativeInteractiveMirrorModelMatrix(
      native.poses[0].map((v, i) => (i === 3 ? 1e40 : v)),
    ),
  ).toThrow();
  expect(() => nativeInteractiveMirrorPlane(3)).toThrow();
});
