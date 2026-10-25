import { expect, it } from "vitest";
import native from "./fixtures/alignment-adjacency-global.json";
import { executeGlobalAlignmentInputPreparation } from "../src/global-alignment-input-core";
import { nativeGlobalPrepareScene } from "../src/scan-native-global-scene";

it.each(native.cases)(
  "keeps group-command source vertices eligible: $name",
  (c) => {
    const vertices = Float32Array.from(c.vertices.flat());
    const triangles = Uint32Array.from(c.triangles);
    const before = [vertices.slice(), triangles.slice()];
    const expected = new Uint32Array(vertices.length / 3);
    const result = executeGlobalAlignmentInputPreparation({
      vertices,
      triangles,
    });
    expect(result.flags).toEqual(expected);
    expect(vertices).toEqual(before[0]);
    expect(triangles).toEqual(before[1]);
  },
);

it("rejects returned flags before exceeding supplied storage admission", () => {
  expect(() =>
    executeGlobalAlignmentInputPreparation({
      vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      triangles: Uint32Array.of(0, 1, 2),
      storage: { limit: 100, reserved: 90 },
    }),
  ).toThrow(/storage admission/);
});

it("does not allocate boundary adjacency for the group command", () => {
  const result = executeGlobalAlignmentInputPreparation({
    vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    triangles: Uint32Array.of(0, 1, 2),
    storage: { limit: 100, reserved: 88 },
  });
  expect(result.flags).toEqual(new Uint32Array(3));
});

it("retains boundary vertices in the command's source sampler", () => {
  // Each scan needs at least 100 normals in a source bin before sampling.
  const size = 16;
  const vertices = Float32Array.from(
    Array.from({ length: size * size }, (_, id) => [
      id % size,
      Math.floor(id / size),
      0,
    ]).flat(),
  );
  const triangles: number[] = [];
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const a = y * size + x,
        b = a + 1;
      triangles.push(a, b, a + size, b, b + size, a + size);
    }
  const mesh = executeGlobalAlignmentInputPreparation({
    vertices,
    triangles: Uint32Array.from(triangles),
  });
  const geometry = {
    points: mesh.vertices,
    normals: mesh.normals,
    flags: mesh.flags,
  };
  const scene = nativeGlobalPrepareScene(
    [
      { id: "a", geometry },
      { id: "b", geometry },
    ],
    {
      radius: 0.5,
      spacing: 12,
      budget: 1000,
      mask: 0,
      clock: () => 123,
    },
  );
  const selected = scene.selected.flat(2);
  expect(new Set(selected).size).toBe(size * size);
  expect(selected.every((id) => mesh.flags[id] === 0)).toBe(true);
  expect(mesh.flags.some((flag) => flag !== 0)).toBe(false);
});
