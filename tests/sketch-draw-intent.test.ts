import { describe, expect, it, vi } from "vitest";
import {
  applySketchDrawIntent,
  SKETCH_DRAW_LIMITS,
  type SketchDrawIntent,
} from "../src/sketch-draw-intent";
import {
  drawSketchLine,
  drawSketchCircle,
  drawThreePointCurve,
  moveSketchEndpoint,
} from "../src/sketch-drawing";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { rectangleSketch, type Sketch } from "../src/sketch";

const grid = { enabled: false, spacingMm: 1 };
const empty = (): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  constraints: [],
  frame: coordinateSketchFrame("OXZ", 17),
  reference: {
    kind: "section",
    sourceId: "scan",
    axis: "y",
    offset: 17,
    onSlicingPlane: true,
    selectedOnly: false,
    sampled: false,
    segments: [0, 0, 2, 2],
  },
});
function canonical(sketch: Sketch) {
  const ids = new Map([
    ...sketch.points.map((p, i) => [p.id, `p${i}`] as const),
    ...[...sketch.segments, ...(sketch.arcs ?? [])].map(
      (p, i) => [p.id, `c${i}`] as const,
    ),
    ...sketch.constraints.map((p, i) => [p.id, `r${i}`] as const),
  ]);
  return JSON.parse(
    JSON.stringify(sketch, (_key, value) =>
      typeof value === "string" ? (ids.get(value) ?? value) : value,
    ),
  );
}

describe("shared sketch drawing intents", () => {
  it.each([
    {
      kind: "line",
      points: [
        [0.1, 0.1],
        [5, 0.2],
      ],
      autoConstraints: true,
      snapToleranceMm: 0.3,
    },
    {
      kind: "circle",
      points: [
        [3, 4],
        [8, 4],
      ],
    },
    {
      kind: "arc3",
      points: [
        [5, 0],
        [0, 5],
        [-5, 0],
      ],
    },
    {
      kind: "circle3",
      points: [
        [5, 0],
        [0, -5],
        [-5, 0],
      ],
    },
  ] as SketchDrawIntent[])(
    "retains existing $kind geometry/relations while returning owned results",
    (intent) => {
      const source = empty(),
        before = structuredClone(source);
      const expected =
        intent.kind === "line"
          ? drawSketchLine(
              source,
              ...intent.points,
              intent.snapToleranceMm,
              intent.autoConstraints,
            )
          : intent.kind === "circle"
            ? drawSketchCircle(source, ...intent.points)
            : drawThreePointCurve(
                source,
                (
                  intent as Extract<
                    SketchDrawIntent,
                    { kind: "arc3" | "circle3" }
                  >
                ).points,
                intent.kind as "arc3" | "circle3",
              );
      const result = applySketchDrawIntent(source, intent, grid);
      expect(canonical(result.sketch)).toEqual(canonical(expected));
      expect(result.changed).toBe(true);
      expect(result.createdPointIds).toEqual(
        result.sketch.points.map((p) => p.id),
      );
      expect(result.createdCurveIds).toEqual(
        [...result.sketch.segments, ...(result.sketch.arcs ?? [])].map(
          (p) => p.id,
        ),
      );
      expect(result.createdConstraintIds).toEqual(
        result.sketch.constraints.map((p) => p.id),
      );
      expect(result.usedPoints).toEqual(
        intent.kind === "move" ? [intent.position] : intent.points,
      );
      expect(source).toEqual(before);
      expect(result.sketch.frame).toEqual(source.frame);
      expect(result.sketch.reference).toEqual(source.reference);
      result.sketch.frame!.origin[1] = 99;
      result.sketch.reference!.segments[0] = 99;
      result.usedPoints[0][0] = 99;
      expect(source).toEqual(before);
    },
  );

  it("grid-snaps raw inputs with the existing negative-half/signed-zero rule", () => {
    const result = applySketchDrawIntent(
      empty(),
      {
        kind: "circle",
        points: [
          [-0.5, -0.5],
          [1.6, 0.1],
        ],
      },
      { enabled: true, spacingMm: 1 },
    );
    expect(result.usedPoints).toEqual([
      [-0, -0],
      [2, 0],
    ]);
    expect(result.sketch.points[0]).toMatchObject({ x: -0, y: -0 });
  });

  it("reuses line endpoints and returns only newly created identities", () => {
    const source = drawSketchLine(empty(), [0, 0], [5, 0], 0.1, true);
    const result = applySketchDrawIntent(
      source,
      {
        kind: "line",
        points: [
          [5.05, 0.01],
          [5.1, 4],
        ],
        autoConstraints: true,
        snapToleranceMm: 0.2,
      },
      grid,
    );
    expect(result.sketch.segments[1].a).toBe(source.segments[0].b);
    expect(result.createdPointIds).toHaveLength(1);
    expect(result.createdCurveIds).toHaveLength(1);
    expect(result.createdConstraintIds).toHaveLength(1);
    expect(result.sketch.constraints.at(-1)).toMatchObject({
      kind: "vertical",
    });
    expect(result.sketch.points.at(-1)).toMatchObject({ x: 5, y: 4 });
  });

  it("preserves unconstrained line behavior and never applies line endpoint snapping to circles/arcs", () => {
    const source = empty();
    source.points = [{ id: "near", x: 5.05, y: 0.01 }];
    const line = applySketchDrawIntent(
      source,
      {
        kind: "line",
        points: [
          [5, 0],
          [8, 0.1],
        ],
        autoConstraints: false,
        snapToleranceMm: 0.3,
      },
      grid,
    );
    expect(line.createdPointIds).toHaveLength(2);
    expect(line.sketch.constraints).toHaveLength(0);
    const circle = applySketchDrawIntent(
      source,
      {
        kind: "circle",
        points: [
          [0, 0],
          [5, 0],
        ],
      },
      grid,
    );
    expect(circle.createdPointIds).toHaveLength(3);
    expect(circle.sketch.arcs![0].a).not.toBe("near");
    const arc = applySketchDrawIntent(
      source,
      {
        kind: "arc3",
        points: [
          [5, 0],
          [0, 5],
          [-5, 0],
        ],
      },
      grid,
    );
    expect(arc.sketch.arcs![0].a).not.toBe("near");
  });

  it("moves connected geometry through the existing solver and reports exact no-ops", () => {
    const source = drawSketchLine(empty(), [5, 0], [20, 0], 0.1, true),
      pointId = source.points[1].id;
    const moved = applySketchDrawIntent(
      source,
      { kind: "move", pointId, position: [30, 7] },
      grid,
    );
    expect(moved.sketch).toEqual(moveSketchEndpoint(source, pointId, [30, 7]));
    expect(moved.changed).toBe(true);
    expect(moved.createdPointIds).toEqual([]);
    expect(moved.createdCurveIds).toEqual([]);
    expect(moved.createdConstraintIds).toEqual([]);
    expect(moved.sketch.constraints).toEqual(source.constraints);
    const same = applySketchDrawIntent(
      source,
      { kind: "move", pointId, position: [20, 0] },
      grid,
    );
    expect(same.changed).toBe(false);
    expect(same.sketch).toEqual(source);
  });

  it.each([
    {
      kind: "line",
      points: [
        [0, 0],
        [0, 0],
      ],
      autoConstraints: true,
      snapToleranceMm: 0.1,
    },
    {
      kind: "circle",
      points: [
        [1, 1],
        [1, 1],
      ],
    },
    {
      kind: "arc3",
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    },
    { kind: "move", pointId: "missing", position: [1, 2] },
  ] as SketchDrawIntent[])("keeps existing $kind failures atomic", (intent) => {
    const source = empty(),
      before = structuredClone(source);
    expect(() => applySketchDrawIntent(source, intent, grid)).toThrow();
    expect(source).toEqual(before);
  });

  it("retains fixed-point conflict rejection and validates derived local/world geometry", () => {
    const source = rectangleSketch(),
      before = structuredClone(source);
    expect(() =>
      applySketchDrawIntent(
        source,
        { kind: "move", pointId: "p1", position: [3, 5] },
        grid,
      ),
    ).toThrow(/conflicts/);
    expect(source).toEqual(before);
    expect(() =>
      applySketchDrawIntent(
        empty(),
        {
          kind: "circle",
          points: [
            [1e9, 0],
            [1e9 - 1, 0],
          ],
        },
        grid,
      ),
    ).toThrow(/bound|range/);
    const placed = empty();
    placed.frame!.origin = [1e9, 0, 0];
    expect(() =>
      applySketchDrawIntent(
        placed,
        {
          kind: "line",
          points: [
            [0, 0],
            [1, 1],
          ],
          autoConstraints: false,
          snapToleranceMm: 0,
        },
        grid,
      ),
    ).toThrow(/bound|range/);
  });

  it.each([
    {
      kind: "unknown",
      points: [
        [0, 0],
        [1, 0],
      ],
    },
    {
      kind: "line",
      points: [
        [0, 0],
        [1, 0],
      ],
      autoConstraints: "yes",
      snapToleranceMm: 0.1,
    },
    {
      kind: "line",
      points: [
        [0, 0],
        [Infinity, 0],
      ],
      autoConstraints: true,
      snapToleranceMm: 0.1,
    },
    {
      kind: "line",
      points: [
        [0, 0],
        [1, 0],
      ],
      autoConstraints: true,
      snapToleranceMm: -1,
    },
    {
      kind: "circle",
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    },
    {
      kind: "circle",
      points: [
        [0, 0],
        [1, 0],
      ],
      autoConstraints: true,
    },
    { kind: "move", pointId: "p", position: [0, 0], points: [[1, 0]] },
  ])(
    "rejects malformed or ambiguous intents before geometry work",
    (intent) => {
      expect(() =>
        applySketchDrawIntent(empty(), intent as SketchDrawIntent, grid),
      ).toThrow();
    },
  );

  it("rejects invalid source/grid and prospective dense solver work before UUID creation", () => {
    const draw: SketchDrawIntent = {
      kind: "circle",
      points: [
        [0, 0],
        [1, 0],
      ],
    };
    expect(() =>
      applySketchDrawIntent(
        { ...empty(), points: [{ id: "bad", x: NaN, y: 0 }] },
        draw,
        grid,
      ),
    ).toThrow();
    expect(() =>
      applySketchDrawIntent(empty(), draw, { enabled: true, spacingMm: 0 }),
    ).toThrow(/grid/i);
    const large = empty();
    large.points = Array.from(
      { length: SKETCH_DRAW_LIMITS.points + 1 },
      (_, i) => ({ id: `p${i}`, x: i, y: 0 }),
    );
    expect(() => applySketchDrawIntent(large, draw, grid)).toThrow(
      /limit|budget/i,
    );
    const dense = empty();
    dense.points = Array.from({ length: 64 }, (_, i) => ({
      id: `p${i}`,
      x: i,
      y: 0,
    }));
    dense.constraints = dense.points.map((p) => ({
      id: `fixed-${p.id}`,
      kind: "fixed",
      point: p.id,
      x: p.x,
      y: p.y,
    }));
    const before = structuredClone(dense),
      check = vi.fn();
    expect(() => applySketchDrawIntent(dense, draw, grid, { check })).toThrow(
      /solver|budget/i,
    );
    expect(dense).toEqual(before);
    expect(check).toHaveBeenCalled();
  });

  it("checks cancellation and revisions at entry and before returning a candidate", () => {
    const draw: SketchDrawIntent = {
        kind: "circle",
        points: [
          [0, 0],
          [1, 0],
        ],
      },
      controller = new AbortController(),
      source = empty(),
      before = structuredClone(source);
    controller.abort();
    expect(() =>
      applySketchDrawIntent(source, draw, grid, { signal: controller.signal }),
    ).toThrow();
    expect(() =>
      applySketchDrawIntent(source, draw, grid, {
        check: () => {
          throw Error("stale revision");
        },
      }),
    ).toThrow(/stale/);
    let checks = 0;
    expect(() =>
      applySketchDrawIntent(source, draw, grid, {
        check: () => {
          if (++checks === 4) throw Error("changed before publication");
        },
      }),
    ).toThrow(/changed/);
    expect(source).toEqual(before);
  });

  it("admits the bounded empty-residual path without charging an unallocated cubic normal matrix", () => {
    const source = empty();
    source.points = Array.from(
      { length: SKETCH_DRAW_LIMITS.points - 2 },
      (_, i) => ({ id: `spare-${i}`, x: i, y: 0 }),
    );
    const result = applySketchDrawIntent(
      source,
      {
        kind: "line",
        points: [
          [1000, 1],
          [1001, 1],
        ],
        autoConstraints: false,
        snapToleranceMm: 0,
      },
      grid,
    );
    expect(result.sketch.points).toHaveLength(SKETCH_DRAW_LIMITS.points);
    expect(result.diagnostics.solverResiduals).toBe(0);
    expect(result.diagnostics.estimatedWork).toBeLessThanOrEqual(
      SKETCH_DRAW_LIMITS.solverWork,
    );
  });

  it("counts new points and the temporary endpoint-move constraint before solving", () => {
    const source = empty();
    source.points = Array.from(
      { length: SKETCH_DRAW_LIMITS.points - 2 },
      (_, i) => ({ id: `spare-${i}`, x: i, y: 0 }),
    );
    expect(() =>
      applySketchDrawIntent(
        source,
        {
          kind: "circle",
          points: [
            [0, 0],
            [1, 0],
          ],
        },
        grid,
      ),
    ).toThrow(/collection limit/);
    const fixed = empty();
    fixed.points = [{ id: "fixed", x: 0, y: 0 }];
    fixed.constraints = Array.from(
      { length: SKETCH_DRAW_LIMITS.constraints },
      (_, i) => ({
        id: `fixed-${i}`,
        kind: "fixed",
        point: "fixed",
        x: 0,
        y: 0,
      }),
    );
    expect(() =>
      applySketchDrawIntent(
        fixed,
        { kind: "move", pointId: "fixed", position: [0, 0] },
        grid,
      ),
    ).toThrow(/collection limit/);
  });
});
