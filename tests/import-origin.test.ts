import { afterEach, expect, it, vi } from "vitest";
import { placeScanOnOrigin } from "../src/import-origin";
import { convertScanUnits } from "../src/import-units";

function bounds(p: Float32Array) {
  const axes = [0, 1, 2].map((axis) =>
    Array.from(p).filter((_, i) => i % 3 === axis),
  );
  return axes.map((v) => [Math.min(...v), Math.max(...v)]);
}
it.each([120, -120])(
  "centers distant scan coordinates and grounds the base at offset %i",
  (offset) => {
    const p = new Float32Array([
      offset,
      200,
      900,
      offset + 20,
      200,
      900,
      offset,
      240,
      910,
    ]);
    const result = placeScanOnOrigin(p);
    expect(result).toBe(p);
    expect(bounds(result)).toEqual([
      [-10, 10],
      [-20, 20],
      [0, 10],
    ]);
    expect(placeScanOnOrigin(result)).toEqual(result);
  },
);
it("converts file units before placement without changing dimensions or winding", () => {
  const p = new Float32Array([10, 20, 30, 12, 20, 30, 10, 24, 31]);
  const result = placeScanOnOrigin(convertScanUnits(p, "in"));
  const b = bounds(result);
  expect(b[0][0]).toBeCloseTo(-25.4, 3);
  expect(b[0][1]).toBeCloseTo(25.4, 3);
  expect(b[1][0]).toBeCloseTo(-50.8, 3);
  expect(b[2][0]).toBe(0);
  expect(b[2][1]).toBeCloseTo(25.4, 3);
  expect(result[3]).toBeGreaterThan(result[0]);
  expect(result[7]).toBeGreaterThan(result[1]);
});
it("rejects invalid geometry before modifying it", () => {
  for (const p of [
    new Float32Array(),
    new Float32Array([1, 2, 3]),
    new Float32Array([1, 2, 3, 4, 5, 6, NaN, 8, 9]),
    new Float32Array([0, 0, -3e38, 1, 0, 3e38, 0, 1, 0]),
  ]) {
    const before = p.slice();
    expect(() => placeScanOnOrigin(p)).toThrow();
    expect(p).toEqual(before);
  }
});
afterEach(() => vi.unstubAllGlobals());
it("routes placement through the import worker after millimeter conversion", async () => {
  const messages: { positions?: Float32Array }[] = [];
  const scope = {
    onmessage: null as unknown as (event: unknown) => Promise<void>,
    postMessage: (message: { positions?: Float32Array }) =>
      messages.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/import-worker");
  const text =
    "solid scan\nfacet normal 0 0 1\nouter loop\nvertex 10 20 30\nvertex 12 20 30\nvertex 10 24 31\nendloop\nendfacet\nendsolid scan";
  const file = new File([text], "scan.stl");
  await scope.onmessage({
    data: { file, extension: "stl", unit: "in", placeAtOrigin: true },
  });
  const placed = messages.find((m) => m.positions)?.positions;
  expect(placed).toBeDefined();
  expect(bounds(placed!)[2][0]).toBe(0);
  expect(bounds(placed!)[0][0]).toBeCloseTo(-25.4, 3);
  messages.length = 0;
  await scope.onmessage({ data: { file, extension: "stl", unit: "mm" } });
  expect(bounds(messages.find((m) => m.positions)!.positions!)).toEqual([
    [10, 12],
    [20, 24],
    [30, 31],
  ]);
});
