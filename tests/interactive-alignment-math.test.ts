import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import manifest from "./fixtures/interactive-drag-native.manifest.json";
import currentView from "./fixtures/interactive-current-view-native.json";
import {
  nativeInteractiveDrag,
  nativeInteractiveCurrentView,
} from "../src/interactive-alignment-math";

// Runtime loading avoids a multi-megabyte TypeScript JSON syntax tree.
const compressed = readFileSync(
  new URL("./fixtures/interactive-drag-native.json.gz", import.meta.url),
);
const raw = gunzipSync(compressed);
const native = JSON.parse(raw.toString("utf8")) as {
  frames: number[][];
  originals: number[][];
  views: number[][];
  cases: {
    mode: number;
    frame: number;
    original: number;
    view: number;
    delta: number[];
    screen: number[];
    previousScreen: number[];
    pivotScreen: number[];
    viewScale: number;
    returned: number;
    activeBits: string;
    basisBits: string;
  }[];
};
const bits = (matrix: readonly number[]) =>
  Buffer.from(new Float64Array(matrix).buffer).toString("hex");
it("matches every original manipulator return and both output frames", () => {
  const failures: unknown[] = [];
  for (const sample of native.cases) {
    const result = nativeInteractiveDrag({
      mode: sample.mode,
      frame: native.frames[sample.frame],
      original: native.originals[sample.original],
      delta: sample.delta,
      previousScreen: sample.previousScreen,
      screen: sample.screen,
      pivotScreen: sample.pivotScreen,
      viewSize: sample.viewScale,
      view: native.views[sample.view],
    });
    if (
      Number(result.accepted) !== sample.returned ||
      bits(result.matrix) !== sample.activeBits ||
      bits(result.frame) !== sample.basisBits
    )
      failures.push({
        sample,
        actual: result,
        activeExact: bits(result.matrix) === sample.activeBits,
        basisExact: bits(result.frame) === sample.basisBits,
      });
  }
  expect(native.cases).toHaveLength(46368);
  expect(failures.length, JSON.stringify(failures.slice(0, 3))).toBe(0);
});

it("retains the complete original capture bytes in a compact fixture", () => {
  expect(createHash("sha256").update(compressed).digest("hex")).toBe(
    manifest.gzipSha256,
  );
  expect(createHash("sha256").update(raw).digest("hex")).toBe(
    manifest.captureSha256,
  );
  expect(native.cases.filter((sample) => sample.returned).length).toBe(
    manifest.accepted,
  );
});

it.each(currentView.cases.map((sample, index) => ({ ...sample, index })))(
  "matches original As Current View matrix $index",
  (sample) => {
    expect(
      bits(
        nativeInteractiveCurrentView(
          currentView.rotations[sample.rotation],
          sample.position,
        ),
      ),
    ).toBe(sample.matrixBits);
    expect(sample.dialogPreserved).toBe(true);
    expect(
      sample.events
        .filter((event) => event.kind === "state")
        .map((event) => event.mode),
    ).toEqual([sample.modeFlag ? 4 : 2]);
  },
);

it("preserves both original As Current View camera-reset frames including Float32 angle residual", async () => {
  const { nativeInteractiveResetView } =
    await import("../src/interactive-alignment-math");
  const reset = JSON.parse(
    readFileSync(
      new URL("./fixtures/interactive-reset-view-native.json", import.meta.url),
      "utf8",
    ),
  );
  for (const flag of [0, 1]) {
    const capture = reset.cases.find(
      (sample: { contextFlag: number; mode: number }) =>
        sample.contextFlag === flag && sample.mode === (flag ? 4 : 2),
    );
    expect(bits(nativeInteractiveResetView(!!flag))).toBe(capture.matrixBits);
  }
});
