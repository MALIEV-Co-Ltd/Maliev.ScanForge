import { describe, expect, it } from "vitest";
import { shrinkwrapScanMesh } from "../src/scan-shrinkwrap";
const plane = new Float32Array([
  0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0,
]);
describe("continuous source constrained ShrinkWrap", () => {
  it("reports a measured supported fit and a separate generated backing", () => {
    const r = shrinkwrapScanMesh(plane);
    expect(r.positions.length).toBeGreaterThan(plane.length);
    expect(r.diagnostics?.supportedSamples).toBeGreaterThan(0);
    expect(r.diagnostics?.supportedMaxDeviation).toBeLessThanOrEqual(0.1);
    expect(r.diagnostics?.generatedTriangles).toBeGreaterThan(0);
    expect(r.diagnostics?.watertight).toBe(true);
    expect(r.diagnostics?.sampleInterval).toBe(0.5);
  });
  it("uses finer continuous fit than its binary scaffold", () => {
    const r = shrinkwrapScanMesh(plane, {
      sampleInterval: 0.125,
      maxDeviation: 0.025,
    });
    expect(r.diagnostics?.supportedMaxDeviation).toBeLessThanOrEqual(0.025);
    expect(
      Array.from(r.positions)
        .filter((_, i) => i % 3 === 2)
        .some((z) => Math.abs(z) < 0.025),
    ).toBe(true);
  });
  it("adds outward offset independently of sampling", () => {
    const a = shrinkwrapScanMesh(plane),
      b = shrinkwrapScanMesh(plane, { extraThickness: 0.2 });
    expect(b.diagnostics?.extraThickness).toBe(0.2);
    expect(b.diagnostics?.supportedMaxDeviation).toBeLessThanOrEqual(0.1);
    expect(b.diagnostics?.sampleInterval).toBe(a.diagnostics?.sampleInterval);
    expect(
      Math.max(...b.positions.filter((_, i) => i % 3 === 2)),
    ).toBeGreaterThan(Math.max(...a.positions.filter((_, i) => i % 3 === 2)));
  });
  it("exposes independent organic and gap settings and combines targets", () => {
    const r = shrinkwrapScanMesh(plane, {
      organicShape: true,
      gapFill: 0.25,
      targets: [Array.from(plane, (x) => x + 4)],
    });
    expect(r.diagnostics?.organicShape).toBe(true);
    expect(r.diagnostics?.gapFill).toBe(0.25);
    expect(r.diagnostics?.inputTriangles).toBe(4);
  });
  it.each([
    { sampleInterval: 0 },
    { gapFill: -1 },
    { maxDeviation: 0 },
    { extraThickness: -1 },
    { sampleInterval: Infinity },
  ])("rejects invalid settings %j", (options) => {
    expect(() => shrinkwrapScanMesh(plane, options)).toThrow();
  });
  it("cancels before allocating", () => {
    const c = new AbortController();
    c.abort();
    expect(() => shrinkwrapScanMesh(plane, { signal: c.signal })).toThrow(
      /cancel/i,
    );
  });
  it("rejects unsupported precision rather than relaxing deviation", () => {
    expect(() =>
      shrinkwrapScanMesh(
        Array.from(plane, (x) => x + 1e8),
        { maxDeviation: 1e-9 },
      ),
    ).toThrow();
  });
});

it("fails closed when a continuous fit reverses a scaffold triangle", async () => {
  const { extractShrinkwrapScaffold } =
    await import("../src/scan-shrinkwrap-extraction");
  expect(() =>
    extractShrinkwrapScaffold(plane, {
      gapFill: 0,
      advance: () => {},
      transform: (_key, _expires, p) => ({
        point: [-p[0], p[1], p[2]],
        supported: true,
      }),
    }),
  ).toThrow(/inverted|collapsed/);
});
it("measures captured coverage independently of fitted vertex provenance", () => {
  const r = shrinkwrapScanMesh(plane);
  expect(r.diagnostics?.sourceCoverageSamples).toBe(8);
  expect(r.diagnostics?.sourceCoverageMaxDeviation).toBeLessThanOrEqual(0.1);
  expect(r.diagnostics?.coverageCertified).toBe(false);
});
it("offsets generated backing outward as well as captured surfaces", () => {
  const a = shrinkwrapScanMesh(plane),
    b = shrinkwrapScanMesh(plane, { extraThickness: 0.2 });
  const z = (p: Float32Array) => Array.from(p).filter((_, i) => i % 3 === 2);
  expect(Math.min(...z(b.positions))).toBeLessThan(
    Math.min(...z(a.positions)) - 0.1,
  );
});
it("independently samples front facet centroids against the analytic plane", () => {
  const r = shrinkwrapScanMesh(plane);
  let measured = 0,
    maximum = 0;
  for (let i = 0; i < r.positions.length; i += 9) {
    const p = r.positions,
      ux = p[i + 3] - p[i],
      uy = p[i + 4] - p[i + 1],
      uz = p[i + 5] - p[i + 2],
      vx = p[i + 6] - p[i],
      vy = p[i + 7] - p[i + 1],
      vz = p[i + 8] - p[i + 2];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx],
      length = Math.hypot(...normal);
    const centroid = [0, 1, 2].map(
      (a) => (p[i + a] + p[i + 3 + a] + p[i + 6 + a]) / 3,
    );
    if (
      normal[2] / length > 0.95 &&
      Math.abs(centroid[2]) < 0.1 &&
      centroid[0] > 0.1 &&
      centroid[0] < 1.9 &&
      centroid[1] > 0.1 &&
      centroid[1] < 1.9
    ) {
      measured++;
      maximum = Math.max(maximum, Math.abs(centroid[2]));
    }
  }
  expect(measured).toBeGreaterThan(0);
  expect(maximum).toBeLessThanOrEqual(0.1);
});
it("rejects a lost captured sheet even when Euclidean tolerance exceeds its separation", () => {
  const second = Array.from(plane, (v, i) => v + (i % 3 === 2 ? 0.02 : 0));
  expect(() =>
    shrinkwrapScanMesh(plane, {
      targets: [second],
      sampleInterval: 0.5,
      gapFill: 0,
      maxDeviation: 0.1,
    }),
  ).toThrow(/captured.*gap|separate.*sheet/i);
});
it("retriangulates a continuously deformed contour when its old diagonal folds", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const after = new Float32Array([0, 0, 0, 0.3, 0.7, 0, 1, 1, 0, 0, 1, 0]);
  const result = fitShrinkwrapContour(
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    before,
    after,
  );
  expect(result).toHaveLength(2);
  expect(result.some((t: number[]) => t.includes(1) && t.includes(3))).toBe(
    true,
  );
});
it("allows deliberate gap filling to merge close captured sheets", () => {
  const second = Array.from(plane, (v, i) => v + (i % 3 === 2 ? 0.02 : 0));
  const r = shrinkwrapScanMesh(plane, {
    targets: [second],
    sampleInterval: 0.5,
    gapFill: 0.03,
    maxDeviation: 0.15,
  });
  expect(r.diagnostics?.deliberateGapSamples).toBeGreaterThan(0);
  expect(r.diagnostics?.watertight).toBe(true);
});
it("rejects a captured thin wall when inferred backing would hide its faces", async () => {
  const { BoxGeometry } = await import("three");
  const g = new BoxGeometry(2, 2, 0.02).toNonIndexed();
  try {
    expect(() =>
      shrinkwrapScanMesh(g.getAttribute("position").array as Float32Array, {
        sampleInterval: 0.5,
        maxDeviation: 0.1,
      }),
    ).toThrow(/coverage exceeds|resolve captured thin walls/);
  } finally {
    g.dispose();
  }
});
it("fits curved captured facets within the same independent deviation bound", async () => {
  const { SphereGeometry } = await import("three");
  const g = new SphereGeometry(2, 24, 16).toNonIndexed();
  try {
    const r = shrinkwrapScanMesh(
      g.getAttribute("position").array as Float32Array,
      { sampleInterval: 0.5, maxDeviation: 0.1 },
    );
    expect(r.diagnostics?.sourceCoverageMaxDeviation).toBeLessThanOrEqual(0.1);
    expect(r.diagnostics?.watertight).toBe(true);
  } finally {
    g.dispose();
  }
});
it("retains sharp captured box faces under a separate fit constraint", async () => {
  const { BoxGeometry } = await import("three");
  const g = new BoxGeometry(2, 2, 2).toNonIndexed();
  try {
    const r = shrinkwrapScanMesh(
      g.getAttribute("position").array as Float32Array,
      { sampleInterval: 0.125, maxDeviation: 0.1 },
    );
    expect(r.diagnostics?.sourceCoverageMaxDeviation).toBeLessThanOrEqual(0.1);
    expect(r.diagnostics?.watertight).toBe(true);
  } finally {
    g.dispose();
  }
});
it("accepts a bent transition whose source orientation is valid beyond 90 degrees", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([
    -313.941864, -146.226593, 0, -313.941864, -146.476593, -0.25, -314.191864,
    -146.476593, 0,
  ]);
  const after = new Float32Array([
    -313.941864, -146.226593, 0, -313.941864, -146.476593, -0.25, -313.699676,
    -146.583786, 0.113641,
  ]);
  const orientation = {
    normals: new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0]),
    regions: new Int8Array([0, -1, 1]),
  };
  const triangle = fitShrinkwrapContour(
    [[0, 1, 2]],
    before,
    after,
    undefined,
    orientation,
  )[0];
  const start = triangle.indexOf(0);
  expect([
    triangle[start],
    triangle[(start + 1) % 3],
    triangle[(start + 2) % 3],
  ]).toEqual([0, 1, 2]);
});
it("still rejects a reflected captured patch against its source normals", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    after = new Float32Array([0, 0, 0, -1, 0, 0, 0, 1, 0]);
  const orientation = {
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    regions: new Int8Array([1, 1, 1]),
  };
  expect(() =>
    fitShrinkwrapContour([[0, 1, 2]], before, after, undefined, orientation),
  ).toThrow(/inverted|collapsed/);
});

it("rejects a self-crossed transition boundary", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    after = new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const orientation = {
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    regions: new Int8Array([0, 0, 0, 0]),
  };
  expect(() =>
    fitShrinkwrapContour(
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
      before,
      after,
      undefined,
      orientation,
    ),
  ).toThrow(/cross|collapsed/);
});
it("preserves untouched backing whose rim normal differs from the nearest captured facet", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([0, 0.25, 0, 0.25, 0.25, -0.25, 0.25, 0, 0]);
  const orientation = {
    normals: new Float32Array([
      -0.736450076, -0.211746991, 0.642498612, -0.736450076, -0.211746991,
      0.642498612, -0.736450076, -0.211746991, 0.642498612,
    ]),
    regions: new Int8Array([-1, -1, -1]),
  };
  expect(
    fitShrinkwrapContour(
      [[0, 1, 2]],
      before,
      before.slice(),
      undefined,
      orientation,
    ),
  ).toEqual([[0, 1, 2]]);
});
it("accepts a valid noncoplanar transition even when axis projections cross", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([
    0, 0, 0, 0, 0.5, 0, 0.25, 0, -0.25, 0.25, 0.5, -0.25,
  ]);
  const after = new Float32Array([
    0.3403, 0.09784, -0.29689, 0, 0.5, 0, 0.25, 0, -0.25, 0.25, 0.5, -0.25,
  ]);
  const orientation = {
    normals: new Float32Array(12),
    regions: new Int8Array(4),
  };
  expect(
    fitShrinkwrapContour(
      [
        [1, 2, 0],
        [2, 1, 3],
      ],
      before,
      after,
      undefined,
      orientation,
    ),
  ).toEqual([
    [1, 2, 0],
    [2, 1, 3],
  ]);
});
it("rejects real local intersections beyond shared topology", async () => {
  const { hasShrinkwrapLocalIntersection } =
    await import("../src/scan-shrinkwrap-embedding");
  const crossing = new Float32Array([
    0, 0, 0, 2, 0, 0, 0, 2, 0, 0.5, 0.5, -1, 0.5, 0.5, 1, 1.5, 0.5, 0,
  ]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [3, 4, 5],
      ],
      crossing,
    ),
  ).toBe(true);
  const coplanar = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [0, 3, 2],
      ],
      coplanar,
    ),
  ).toBe(true);
});
it("distinguishes coplanar adjacency from positive-area shared-edge overlap", async () => {
  const { hasShrinkwrapLocalIntersection } =
    await import("../src/scan-shrinkwrap-embedding");
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [1, 3, 2],
      ],
      p,
    ),
  ).toBe(false);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [0, 3, 2],
      ],
      p,
    ),
  ).toBe(true);
});
it("accepts near but disjoint facets and legitimate shared-vertex fans", async () => {
  const { hasShrinkwrapLocalIntersection } =
    await import("../src/scan-shrinkwrap-embedding");
  const separated = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0.0001, 0.0001, 0.0001, 0.2, 0.0001, 0.0001,
    0.0001, 0.2, 0.0001,
  ]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [3, 4, 5],
      ],
      separated,
    ),
  ).toBe(false);
  const fan = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 1, 0, -1, 1]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [0, 3, 4],
      ],
      fan,
    ),
  ).toBe(false);
});
it("rejects an intersection extending beyond a shared vertex", async () => {
  const { hasShrinkwrapLocalIntersection } =
    await import("../src/scan-shrinkwrap-embedding");
  const p = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 1, -1, 1, 1, 1]);
  expect(
    hasShrinkwrapLocalIntersection(
      [
        [0, 1, 2],
        [0, 3, 4],
      ],
      p,
    ),
  ).toBe(true);
});
it("rejects orientation-preserving overlaps between disconnected contour loops", async () => {
  const { fitShrinkwrapContour } =
    await import("../src/scan-shrinkwrap-contours");
  const before = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
  ]);
  const after = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0.2, 0.2, 0, 1.2, 0.2, 0, 0.2, 1.2, 0,
  ]);
  expect(() =>
    fitShrinkwrapContour(
      [
        [0, 1, 2],
        [3, 4, 5],
      ],
      before,
      after,
    ),
  ).toThrow(/intersect|cross/);
});
it("recognizes every undeformed scaffold contour template as locally embedded", async () => {
  const { hasShrinkwrapLocalIntersection } =
    await import("../src/scan-shrinkwrap-embedding");
  const { cubeContours } = await import("../src/scan-reconstruction-cubes");
  const invalid: number[] = [];
  cubeContours.forEach((template, mask) => {
    if (
      hasShrinkwrapLocalIntersection(
        template.triangles,
        new Float32Array(template.points.flat()),
      )
    )
      invalid.push(mask);
  });
  expect(invalid).toEqual([]);
});
it("uses gap fill to connect separated rims without shifting the captured plane", () => {
  const second = Array.from(plane, (v, i) => v + (i % 3 === 0 ? 3 : 0));
  const a = shrinkwrapScanMesh(plane, {
    targets: [second],
    sampleInterval: 0.25,
    maxDeviation: 0.15,
  });
  const b = shrinkwrapScanMesh(plane, {
    targets: [second],
    sampleInterval: 0.25,
    gapFill: 1,
    maxDeviation: 0.15,
  });
  expect(a.topology?.components).toBe(2);
  expect(b.topology?.components).toBe(1);
  expect(b.diagnostics?.sourceCoverageMaxDeviation).toBeLessThanOrEqual(0.15);
  const zs = (p: Float32Array) => Array.from(p).filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs(a.positions))).toBeCloseTo(
    Math.max(...zs(b.positions)),
    2,
  );
});
it("organic continuation changes inferred backing while retaining the captured front", () => {
  const a = shrinkwrapScanMesh(plane),
    b = shrinkwrapScanMesh(plane, { organicShape: true });
  const zs = (p: Float32Array) => Array.from(p).filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs(b.positions))).toBeLessThan(
    Math.min(...zs(a.positions)) - 0.2,
  );
  expect(Math.max(...zs(b.positions))).toBeCloseTo(
    Math.max(...zs(a.positions)),
    2,
  );
});
it("explicitly validates the GUI parity fixture capsule settings", async () => {
  const { BoxGeometry } = await import("three");
  const g = new BoxGeometry(2, 2, 2).toNonIndexed();
  try {
    expect(() =>
      shrinkwrapScanMesh(g.getAttribute("position").array as Float32Array, {
        sampleInterval: 0.5,
        gapFill: 1,
        organicShape: true,
        extraThickness: 0.1,
        maxDeviation: 0.2,
      }),
    ).toThrow(/coverage exceeds/);
  } finally {
    g.dispose();
  }
});
it("accepts the explicit GUI parity fixture at its finer .25mm sample interval", async () => {
  const { BoxGeometry } = await import("three");
  const g = new BoxGeometry(2, 2, 2).toNonIndexed();
  try {
    const result = shrinkwrapScanMesh(
      g.getAttribute("position").array as Float32Array,
      {
        sampleInterval: 0.25,
        gapFill: 1,
        organicShape: true,
        extraThickness: 0.1,
        maxDeviation: 0.3,
      },
    );
    expect(result.topology).toMatchObject({ watertight: true });
    expect(result.diagnostics?.sourceCoverageMaxDeviation).toBeLessThanOrEqual(
      0.3,
    );
  } finally {
    g.dispose();
  }
});
