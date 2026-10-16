import { describe, expect, it } from "vitest";
import {
  trianglesIntersectBeyondSharedTopology as intersects,
  isDegenerateFloat32Triangle,
} from "../src/scan-self-intersection-predicate";

type P = [number, number, number];
const soup = (a: P[], b: P[]) => new Float32Array([...a.flat(), ...b.flat()]);
const base: P[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 2, 0],
];
const cases: [string, P[], boolean][] = [
  [
    "proper piercing",
    [
      [0.5, 0.5, -1],
      [0.5, 0.5, 1],
      [1.5, 0.5, 0],
    ],
    true,
  ],
  [
    "near parallel miss below old epsilon",
    [
      [0, 0, 1e-10],
      [2, 0, 1e-10],
      [0, 2, 1e-10],
    ],
    false,
  ],
  [
    "coplanar containment",
    [
      [0.1, 0.1, 0],
      [0.4, 0.1, 0],
      [0.1, 0.4, 0],
    ],
    true,
  ],
  [
    "partial coplanar overlap",
    [
      [1, -0.5, 0],
      [2, 1, 0],
      [0.5, 1, 0],
    ],
    true,
  ],
  [
    "proper shared edge adjacency",
    [
      [2, 0, 0],
      [2, 2, 0],
      [0, 2, 0],
    ],
    false,
  ],
  [
    "folded shared edge overlap",
    [
      [0, 0, 0],
      [2, 0, 0],
      [0.5, 0.5, 0],
    ],
    true,
  ],
  [
    "noncoplanar shared edge",
    [
      [0, 0, 0],
      [2, 0, 0],
      [0, 0, 1],
    ],
    false,
  ],
  [
    "isolated shared vertex",
    [
      [0, 0, 0],
      [-1, 0, 1],
      [0, -1, 1],
    ],
    false,
  ],
  [
    "shared vertex extended crossing",
    [
      [0, 0, 0],
      [1, 1, -1],
      [1, 1, 1],
    ],
    true,
  ],
  [
    "tiny shared vertex crossing",
    [
      [0, 0, 0],
      [1, 1, -1e-10],
      [1, 1, 1e-10],
    ],
    true,
  ],
  [
    "proper coplanar shared vertex fan",
    [
      [0, 0, 0],
      [-1, 0, 0],
      [0, -1, 0],
    ],
    false,
  ],
  [
    "nonadjacent isolated coplanar contact",
    [
      [1, 1, 0],
      [2, 2, 0],
      [2, 1, 0],
    ],
    true,
  ],
  [
    "shared vertex collinear overlap",
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
    ],
    true,
  ],
  [
    "nonadjacent vertex on edge",
    [
      [1, 0, 0],
      [1, -1, 1],
      [1, -1, -1],
    ],
    true,
  ],
  [
    "nonadjacent coplanar edge contact",
    [
      [0.5, 0, 0],
      [1.5, 0, 0],
      [1, -1, 0],
    ],
    true,
  ],
  [
    "coplanar disjoint",
    [
      [3, 0, 0],
      [4, 0, 0],
      [3, 1, 0],
    ],
    false,
  ],
  ["duplicate opposite winding", [base[0], base[2], base[1]], true],
];
describe("exact Float32 intersection beyond shared topology", () => {
  it.each(cases)("%s", (_name, b, expected) => {
    const positions = soup(base, b);
    expect(intersects(positions, 0, 1)).toBe(expected);
    expect(intersects(positions, 1, 0)).toBe(expected);
    expect(intersects(soup([...base].reverse(), [...b].reverse()), 0, 1)).toBe(
      expected,
    );
  });
  it.each([2 ** -140, 2 ** -30, 1, 2 ** 30, 2 ** 100])(
    "is scale invariant at %s",
    (scale) => {
      for (const [, b, expected] of cases.filter(
        ([name]) => !name.includes("near") && !name.includes("tiny"),
      )) {
        const p = soup(base, b).map((x) => x * scale);
        expect(intersects(p, 0, 1)).toBe(expected);
      }
    },
  );
  it("is independent of all corner permutations and coordinate-axis permutations", () => {
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const [, b, expected] of cases)
      for (const pa of permutations)
        for (const pb of permutations) {
          expect(
            intersects(
              soup(
                pa.map((i) => base[i]),
                pb.map((i) => b[i]),
              ),
              0,
              1,
            ),
          ).toBe(expected);
        }
    for (const axes of permutations)
      for (const [, b, expected] of cases) {
        const transform = (p: P): P => axes.map((i) => p[i]) as P;
        expect(
          intersects(soup(base.map(transform), b.map(transform)), 0, 1),
        ).toBe(expected);
      }
  });
  it("treats negative zero as the same shared point", () => {
    expect(
      intersects(
        soup(base, [
          [-0, -0, -0],
          [-1, 0, 1],
          [0, -1, 1],
        ]),
        0,
        1,
      ),
    ).toBe(false);
  });
  it("handles translation without a world origin tolerance", () => {
    const p = soup(base, [
      [0.5, 0.5, -1],
      [0.5, 0.5, 1],
      [1.5, 0.5, 0],
    ]).map((x) => x + 16384);
    expect(intersects(p, 0, 1)).toBe(true);
  });
  it("rejects invalid face indices and degenerate or nonfinite inputs", () => {
    expect(() => intersects(soup(base, base), -1, 1)).toThrow();
    expect(() =>
      intersects(
        soup(base, [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ]),
        0,
        1,
      ),
    ).toThrow();
    expect(() =>
      intersects(
        soup(base, [
          [NaN, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ]),
        0,
        1,
      ),
    ).toThrow();
  });
  it("detects degeneracy exactly, including subnormal-scale facets", () => {
    const tiny = 2 ** -149;
    expect(
      isDegenerateFloat32Triangle(
        soup(base, [
          [0, 0, 0],
          [tiny, 0, 0],
          [0, tiny, 0],
        ]),
        1,
      ),
    ).toBe(false);
    expect(
      isDegenerateFloat32Triangle(
        soup(base, [
          [0, 0, 0],
          [tiny, tiny, tiny],
          [2 * tiny, 2 * tiny, 2 * tiny],
        ]),
        1,
      ),
    ).toBe(true);
    expect(
      isDegenerateFloat32Triangle(
        soup(base, [
          [0, 0, 0],
          [1, 1, 1],
          [2, 2, 2],
        ]),
        1,
      ),
    ).toBe(true);
  });
  it("distinguishes a nonzero determinant hidden by rounded products", () => {
    const n = 2 ** 23;
    const triangle: P[] = [
      [0, 0, 0],
      [n, n - 1, 0],
      [n - 1, n - 2, 0],
    ];
    expect(isDegenerateFloat32Triangle(soup(triangle, base), 0)).toBe(false);
  });
});
