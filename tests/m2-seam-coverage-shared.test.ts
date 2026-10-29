import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";

it("rejects an unrepresentable large-coordinate seam without mutating its inputs", () => {
  const x = 1e16;
  const source = [x, 0, 0, x + 2, 8, 0, x - 2, 16, 0];
  const cutter = [
    x,
    0,
    -1,
    x + 2,
    8,
    -1,
    x,
    0,
    1,
    x + 2,
    8,
    -1,
    x + 2,
    8,
    1,
    x,
    0,
    1,
  ];
  const beforeSource = source.slice(),
    beforeCutter = cutter.slice();
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions: source,
      target: cutter,
    }),
  ).toThrow(/coverage|precision/i);
  expect(source).toEqual(beforeSource);
  expect(cutter).toEqual(beforeCutter);
});
