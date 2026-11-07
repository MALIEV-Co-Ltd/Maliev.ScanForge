import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { analyzeMesh } from "../src/mesh-processing";
it("closes a manufactured 18425-facet patch within the existing refinement budget", () => {
  const positions: number[] = [],
    mask: number[] = [];
  const height = (x: number, y: number) =>
    0.001 * x * x + 0.0007 * y * y + 0.0004 * x * y;
  const point = (x: number, y: number) => [
    x,
    y,
    height(x, y) +
      (Math.abs(x) < 44 && Math.abs(y) < 44
        ? 2 + 0.3 * Math.cos(x * 0.1) * Math.cos(y * 0.1)
        : 0),
  ];
  for (let y = -64; y < 64; y++)
    for (let x = -64; x < 64; x++) {
      positions.push(
        ...point(x, y),
        ...point(x + 1, y),
        ...point(x + 1, y + 1),
        ...point(x, y),
        ...point(x + 1, y + 1),
        ...point(x, y + 1),
      );
      const selected = +(x >= -48 && x < 48 && y >= -48 && y < 48);
      mask.push(selected, selected);
    }
  let n = 0;
  for (let i = 0; i < mask.length && n < 7; i++)
    if (mask[i]) {
      mask[i] = 0;
      n++;
    }
  const source = Float32Array.from(positions),
    selection = Uint8Array.from(mask),
    before = source.slice();
  expect(selection.reduce((a, b) => a + b, 0)).toBe(18425);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "defeature",
    positions: source,
    selection,
  });
  expect(result.diagnostics.curvaturePatches).toBe(1);
  expect(result.diagnostics.insertedVertices).toBeLessThanOrEqual(4096);
  const retained = source.filter((_, i) => !selection[Math.floor(i / 9)]);
  expect(result.positions!.subarray(0, retained.length)).toEqual(retained);
  const topology = analyzeMesh(result.positions!);
  expect(topology.boundaryLoops).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  let worst = 0;
  for (let i = retained.length; i < result.positions!.length; i += 9) {
    const t = result.positions!.subarray(i, i + 9);
    const x = (t[0] + t[3] + t[6]) / 3,
      y = (t[1] + t[4] + t[7]) / 3,
      z = (t[2] + t[5] + t[8]) / 3;
    worst = Math.max(worst, Math.abs(z - height(x, y)));
  }
  expect(worst).toBeLessThan(0.02);
  expect(source).toEqual(before);
  expect(selection).toEqual(Uint8Array.from(mask));
}, 30000);
