import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
it("exposes largest-first hole boundary indices through the shared GUI/MCP inventory", () => {
  const positions = Float32Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 14, 0, 0, 10, 4, 0,
  ]);
  const inventory = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
  }).inventory!;
  expect(inventory.holeOrder).toEqual([1, 0]);
  expect(inventory.boundaries[0].diameter).toBeLessThan(
    inventory.boundaries[1].diameter,
  );
});

it("sorts the displayed size stably and leaves open paths and source references untouched", async () => {
  const { holeListOrder } = await import("../src/scan-hole-order");
  const boundaries = [
    { closed: true, length: 3 },
    { closed: false, length: 100 },
    { closed: true, length: 12 },
    { closed: true, length: 12 },
  ];
  const original = structuredClone(boundaries);
  expect(holeListOrder(boundaries)).toEqual([2, 3, 0]);
  expect(boundaries).toEqual(original);
  expect(holeListOrder([])).toEqual([]);
});
