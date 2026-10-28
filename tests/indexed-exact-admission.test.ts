import { expect, it, vi } from "vitest";
import { indexedExactAdmission } from "../src/indexed-exact-admission";

it("accepts exact indexed corners and rejects signed-zero or coordinate differences", async () => {
  const mesh = {
    vertices: [0, -0, 3, 1, 2, 3, 4, 5, 6],
    triangles: new Uint32Array([0, 1, 2]),
  };
  const positions = [0, -0, 3, 1, 2, 3, 4, 5, 6];
  expect(await indexedExactAdmission(mesh, positions)).toBe(true);
  expect(await indexedExactAdmission(mesh, [0, 0, 3, 1, 2, 3, 4, 5, 6])).toBe(
    false,
  );
  expect(await indexedExactAdmission(mesh, [0, -0, 3, 1, 2, 3, 4, 5, 7])).toBe(
    false,
  );
  expect(
    await indexedExactAdmission(
      { ...mesh, triangles: new Uint32Array([0, 1, 99]) },
      positions,
    ),
  ).toBe(false);
  expect(
    await indexedExactAdmission(
      { ...mesh, vertices: [...mesh.vertices, NaN, 0, 0] },
      positions,
    ),
  ).toBe(false);
});

it("yields during validation and checks cancellation before further work", async () => {
  const triangles = new Uint32Array(65538);
  const positions = new Array<number>(triangles.length * 3).fill(0);
  const mesh = { vertices: [0, 0, 0], triangles };
  const check = vi.fn();
  const pause = vi.fn(async () => {});
  expect(await indexedExactAdmission(mesh, positions, { check, pause })).toBe(
    true,
  );
  expect(pause).toHaveBeenCalled();
  expect(check.mock.calls.length).toBeGreaterThan(1);
  const stopped = new Error("cancelled");
  const cancel = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw stopped;
    });
  await expect(
    indexedExactAdmission(mesh, positions, { check: cancel, pause }),
  ).rejects.toBe(stopped);
});

it("preserves signed zero for each coordinate and rejects nonfinite input", async () => {
  for (let axis = 0; axis < 3; axis++) {
    const vertices = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    vertices[axis] = -0;
    const positions = Array.from(vertices);
    const mesh = { vertices, triangles: new Uint32Array([0, 1, 2]) };
    expect(await indexedExactAdmission(mesh, positions)).toBe(true);
    positions[axis] = 0;
    expect(await indexedExactAdmission(mesh, positions)).toBe(false);
    positions[axis] = Number.NaN;
    expect(await indexedExactAdmission(mesh, positions)).toBe(false);
    vertices[axis] = Infinity;
    positions[axis] = Infinity;
    expect(await indexedExactAdmission(mesh, positions)).toBe(false);
  }
});

it("rejects malformed and Float32-overflowing normal caches", async () => {
  const mesh = {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    triangles: new Uint32Array([0, 1, 2]),
  };
  for (const invalid of [NaN, Infinity, -Infinity, "1", undefined]) {
    const normals = [0, 0, 0, 0, 0, 0, 0, 0, invalid] as number[];
    expect(
      await indexedExactAdmission({ ...mesh, normals }, mesh.vertices),
    ).toBe(false);
  }
  const geometryNormals = [0, 0, 0, 0, 0, 0, 0, 0, Number.MAX_VALUE];
  expect(
    await indexedExactAdmission({ ...mesh, geometryNormals }, mesh.vertices),
  ).toBe(false);
});
