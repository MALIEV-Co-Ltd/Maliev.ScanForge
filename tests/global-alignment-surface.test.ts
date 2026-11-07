import { expect, it } from "vitest";
import { BoxGeometry } from "three";
import { refineGlobalSurfaceSamples } from "../src/global-alignment-surface-core";
function fixture(partial = false) {
  const box = new BoxGeometry(20, 10, 4, 6, 5, 3),
    vertices = Float32Array.from(box.attributes.position.array),
    triangles = Uint32Array.from(box.index!.array);
  for (let i = 0; i < vertices.length; i += 3)
    if (vertices[i] > 0 && vertices[i + 1] > 0 && vertices[i + 2] > 0) {
      const bump =
        ((((vertices[i] / 10) * vertices[i + 1]) / 5) * vertices[i + 2]) / 2;
      vertices[i] += 0.7 * bump;
      vertices[i + 1] += 0.4 * bump;
      vertices[i + 2] += 0.3 * bump;
    }
  box.dispose();
  const moved = Float32Array.from(
    vertices,
    (v, i) => v + [0.12, -0.09, 0.16][i % 3],
  );
  const points = partial
    ? Float32Array.from([
        ...moved,
        ...Array.from(moved, (v, i) => v + (i % 3 === 0 ? 40 : 0)),
      ])
    : moved;
  return { vertices, triangles, moved, points };
}
it.each([false, true])(
  "recovers a known surface pose with partial/outlier samples: %s",
  (partial) => {
    const f = fixture(partial),
      before = f.triangles.slice();
    const result = refineGlobalSurfaceSamples(
      [
        { id: "fixed", points: f.vertices },
        { id: "moving", points: f.points },
      ],
      [
        { id: "fixed", vertices: f.vertices, triangles: f.triangles },
        { id: "moving", vertices: f.moved, triangles: f.triangles },
      ],
    );
    const fit = result.fits[1],
      m = fit.matrix;
    let sum = 0;
    for (let i = 0; i < f.moved.length; i += 3)
      for (let a = 0; a < 3; a++) {
        const value =
          m[a * 4] * f.moved[i] +
          m[a * 4 + 1] * f.moved[i + 1] +
          m[a * 4 + 2] * f.moved[i + 2] +
          m[a * 4 + 3];
        sum += (value - f.vertices[i + a]) ** 2;
      }
    expect(Math.sqrt(sum / (f.moved.length / 3))).toBeLessThan(0.002);
    expect(fit.rms).toBeLessThanOrEqual(fit.beforeRms!);
    expect(f.triangles).toEqual(before);
    expect(result.anchorId).toBe("fixed");
    expect(result.fits[0].matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  },
);
it("rejects malformed, nonfinite or missing surface inputs", () => {
  const f = fixture();
  const scans = [
      { id: "a", points: f.vertices },
      { id: "b", points: f.moved },
    ],
    meshes = [
      { id: "a", vertices: f.vertices, triangles: f.triangles },
      { id: "b", vertices: f.moved, triangles: f.triangles },
    ];
  expect(() =>
    refineGlobalSurfaceSamples(scans, meshes, undefined, NaN),
  ).toThrow(/Invalid/);
  expect(() =>
    refineGlobalSurfaceSamples(scans, [meshes[0], meshes[0]]),
  ).toThrow(/matching|Invalid/);
  f.vertices[0] = NaN;
  expect(() => refineGlobalSurfaceSamples(scans, meshes)).toThrow(/Invalid/);
});

it("uses a retained global hypothesis to recover a pose with no initial local overlap", () => {
  const f = fixture(),
    far = Float32Array.from(f.moved, (v, i) => v + (i % 3 === 0 ? 30 : 0));
  const seed = [1, 0, 0, -30.12, 0, 1, 0, 0.09, 0, 0, 1, -0.16];
  const result = refineGlobalSurfaceSamples(
    [
      { id: "fixed", points: f.vertices },
      { id: "moving", points: far, candidates: [seed] },
    ],
    [
      { id: "fixed", vertices: f.vertices, triangles: f.triangles },
      { id: "moving", vertices: far, triangles: f.triangles },
    ],
  );
  expect(result.fits[1].rms).toBeLessThan(0.0001);
  expect(result.fits[1].candidatesTested).toBeGreaterThan(1);
});

it("fits the bridge scan before a weakly overlapping scan", () => {
  const f = fixture();
  const mesh = (id: string, predicate: (x: number) => boolean) => {
    const indices: number[] = [];
    for (let i = 0; i < f.triangles.length; i += 3) {
      const x =
        (f.vertices[f.triangles[i] * 3] +
          f.vertices[f.triangles[i + 1] * 3] +
          f.vertices[f.triangles[i + 2] * 3]) /
        3;
      if (predicate(x))
        indices.push(f.triangles[i], f.triangles[i + 1], f.triangles[i + 2]);
    }
    const triangles = Uint32Array.from(indices),
      points = Float32Array.from(
        indices.flatMap((i) =>
          Array.from(f.vertices.subarray(i * 3, i * 3 + 3)),
        ),
      );
    return { id, vertices: f.vertices, triangles, points };
  };
  const anchor = mesh("anchor", (x) => x <= 0),
    far = mesh("far", (x) => x >= 0),
    bridge = mesh("bridge", (x) => Math.abs(x) <= 6);
  const meshes = [anchor, far, bridge];
  const result = refineGlobalSurfaceSamples(
    meshes.map((m) => ({ id: m.id, points: m.points })),
    meshes,
  );
  expect(result.order?.[1]).toBe("bridge");
  expect(result.order).toHaveLength(3);
  for (const fit of result.fits.slice(1)) {
    expect(fit.rms).toBeLessThanOrEqual(fit.beforeRms!);
    expect(fit.samplePoints).toBeGreaterThan(0);
  }
});
