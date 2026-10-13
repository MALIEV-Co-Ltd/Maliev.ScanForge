import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";

it("reduces selected surface noise more than the old preset without moving unselected vertices", () => {
  const coordinates: number[] = [];
  const mask: number[] = [];
  const point = (x: number, y: number) => [
    x,
    y,
    0.3 * Math.sin(x * 0.65) * Math.cos(y * 0.7),
  ];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      coordinates.push(
        ...point(x, y),
        ...point(x + 1, y),
        ...point(x + 1, y + 1),
        ...point(x, y),
        ...point(x + 1, y + 1),
        ...point(x, y + 1),
      );
      const selected = Number(x >= 3 && x < 13 && y >= 3 && y < 13);
      mask.push(selected, selected);
    }
  const positions = new Float32Array(coordinates);
  const selection = new Uint8Array(mask);
  const request = {
    kind: "scanEdit",
    action: "smoothSelected",
    positions,
    selection,
  } as const;
  const old = runScanEdit({
    ...request,
    iterations: 2,
    strength: 0.5,
  }).positions!;
  const current = runScanEdit(request).positions!;
  const explicit = runScanEdit({
    ...request,
    iterations: 6,
    strength: 0.5,
  }).positions!;
  expect(current).toEqual(explicit);
  const rms = (values: Float32Array | Float64Array) =>
    Math.sqrt(
      Array.from(values).reduce(
        (sum, v, i) =>
          sum + (i % 3 === 2 && selection[Math.floor(i / 9)] ? v * v : 0),
        0,
      ) / 600,
    );
  expect(rms(current)).toBeLessThan(rms(old) * 0.8);
  const selectedVertices = new Set<string>();
  for (let i = 0; i < positions.length; i += 3)
    if (selection[Math.floor(i / 9)])
      selectedVertices.add(Array.from(positions.slice(i, i + 3)).join(","));
  for (let i = 0; i < positions.length; i += 3)
    if (!selectedVertices.has(Array.from(positions.slice(i, i + 3)).join(",")))
      expect(current.slice(i, i + 3)).toEqual(positions.slice(i, i + 3));
  expect(Array.from(positions)).toEqual(
    Array.from(new Float32Array(coordinates)),
  );
  expect(
    runScanEdit({ ...request, iterations: 1, strength: 0.25 }).positions,
  ).not.toEqual(current);
});
