import { describe, expect, it } from "vitest";
import { trimSketchStroke, type SketchTrimStroke } from "../src/sketch-trim";
import { sampleSketchArc, validateSketch, type Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";

const empty = (): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  arcs: [],
  constraints: [],
});
function line(s: Sketch, id: string, a: [number, number], b: [number, number]) {
  s.points.push(
    { id: `${id}-a`, x: a[0], y: a[1] },
    { id: `${id}-b`, x: b[0], y: b[1] },
  );
  s.segments.push({ id, a: `${id}-a`, b: `${id}-b` });
}
function circle(s: Sketch, id: string, r: number, angle = 0, cx = 0, cy = 0) {
  s.points.push(
    { id: `${id}-c`, x: cx, y: cy },
    { id: `${id}-a`, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) },
    { id: `${id}-b`, x: cx - r * Math.cos(angle), y: cy - r * Math.sin(angle) },
  );
  s.arcs!.push(
    {
      id: `${id}-first`,
      a: `${id}-a`,
      b: `${id}-b`,
      center: `${id}-c`,
      clockwise: false,
    },
    {
      id: `${id}-second`,
      a: `${id}-b`,
      b: `${id}-a`,
      center: `${id}-c`,
      clockwise: false,
    },
  );
}
function upperArc(s: Sketch, id: string, cx = 0) {
  circle(s, id, 1, 0, cx);
  s.arcs!.pop();
}
const stroke = (
  point: [number, number],
  radiusMm = 0.025,
): SketchTrimStroke => ({ stroke: [point], radiusMm });
function segmentEnds(s: Sketch) {
  const p = (id: string) => {
    const p = s.points.find((p) => p.id === id)!;
    return [p.x, p.y];
  };
  return s.segments.map((l) => [p(l.a), p(l.b)]);
}

describe("analytic paint trim between sketch intersections", () => {
  it("trims the painted line interval among three concentric circles (manual workflow)", async () => {
    const s = empty();
    for (const r of [1, 2, 3]) circle(s, `ring${r}`, r);
    line(s, "cross", [-4, 0], [4, 0]);
    s.frame = coordinateSketchFrame("OYZ", 12);
    s.reference = {
      kind: "section",
      sourceId: "scan",
      axis: "x",
      offset: 12,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [0, 0, 1, 1],
    };
    const before = structuredClone(s),
      r = await trimSketchStroke(s, stroke([2.5, 0]));
    expect(r.changed).toBe(true);
    expect(r.intersectionCount).toBe(6);
    expect(segmentEnds(r.sketch)).toEqual([
      [
        [-4, 0],
        [2, 0],
      ],
      [
        [3, 0],
        [4, 0],
      ],
    ]);
    expect(r.sketch.arcs).toEqual(s.arcs);
    expect(r.sketch.frame).toEqual(s.frame);
    expect(r.sketch.reference).toEqual(s.reference);
    expect(s).toEqual(before);
    expect(() => validateSketch(r.sketch)).not.toThrow();
  });
  it("trims a line at its analytic crossing and preserves the other line", async () => {
    const s = empty();
    line(s, "horizontal", [-2, 0], [2, 0]);
    line(s, "vertical", [0, -2], [0, 2]);
    const r = await trimSketchStroke(s, stroke([1, 0]));
    expect(segmentEnds(r.sketch)).toEqual([
      [
        [-2, 0],
        [0, 0],
      ],
      [
        [0, -2],
        [0, 2],
      ],
    ]);
    expect(r.intersectionCount).toBe(1);
  });
  it("trims an arc at a line intersection without chord-derived endpoints", async () => {
    const s = empty();
    upperArc(s, "arc");
    line(s, "cross", [0, -2], [0, 2]);
    const r = await trimSketchStroke(s, stroke([Math.SQRT1_2, Math.SQRT1_2]));
    expect(r.sketch.arcs).toHaveLength(1);
    const a = r.sketch.arcs![0],
      p = r.sketch.points.find((p) => p.id === a.a)!;
    expect(p.x).toBeCloseTo(0, 13);
    expect(p.y).toBeCloseTo(1, 13);
    expect(a.clockwise).toBe(false);
    expect(a.center).toBe("arc-c");
  });
  it("filters circle-circle roots to the actual directed arc domains", async () => {
    const s = empty();
    upperArc(s, "left", -0.5);
    upperArc(s, "right", 0.5);
    const r = await trimSketchStroke(
      s,
      stroke([0.25, Math.sqrt(1 - 0.75 ** 2)], 0.01),
    );
    expect(r.intersectionCount).toBe(1);
    const a = r.sketch.arcs!.find((a) => a.center === "left-c")!,
      p = r.sketch.points.find((p) => p.id === a.a)!;
    expect(p.x).toBeCloseTo(0, 13);
    expect(p.y).toBeCloseTo(Math.sqrt(0.75), 13);
    expect(r.sketch.arcs!.find((a) => a.id === "right-first")).toEqual(
      s.arcs![1],
    );
  });
  it.each([
    {
      sweep: 0.002,
      cut: 0.001,
      painted: 0.0015,
      clockwise: false,
      kind: "line",
    },
    {
      sweep: 0.002,
      cut: 0.001,
      painted: 0.0015,
      clockwise: true,
      kind: "line",
    },
    { sweep: 0.008, cut: 0.004, painted: 0.006, clockwise: false, kind: "arc" },
    {
      sweep: 0.004,
      cut: 0.0017452292519943296,
      painted: 0.003,
      clockwise: false,
      kind: "line",
    },
    {
      sweep: 0.004,
      cut: 0.0017454292519943296,
      painted: 0.003,
      clockwise: false,
      kind: "arc",
    },
    {
      sweep: Math.PI * 2 - 0.0005,
      cut: Math.PI * 2 - 0.001,
      painted: Math.PI * 2 - 0.00075,
      clockwise: false,
      kind: "line",
    },
  ])(
    "uses the ordinary arc chord-direction fallback ($kind, $sweep, clockwise=$clockwise)",
    async ({ sweep, cut, painted, clockwise, kind }) => {
      const s = empty(),
        sign = clockwise ? -1 : 1;
      const point = (angle: number, r = 1000): [number, number] => [
        r * Math.cos(sign * angle),
        r * Math.sin(sign * angle),
      ];
      const end = point(sweep);
      s.points.push(
        { id: "center", x: 0, y: 0 },
        { id: "start", x: 1000, y: 0 },
        { id: "end", x: end[0], y: end[1] },
      );
      s.arcs!.push({
        id: "arc",
        a: "start",
        b: "end",
        center: "center",
        clockwise,
        construction: true,
      });
      line(s, "cutter", point(cut, 999), point(cut, 1001));
      const before = structuredClone(s),
        result = await trimSketchStroke(s, stroke(point(painted), 0.01));
      expect(result.changed).toBe(true);
      expect(result.intersectionCount).toBe(1);
      const retained =
        kind === "line"
          ? result.sketch.segments.find((c) => c.id === "arc")
          : result.sketch.arcs!.find((c) => c.id === "arc");
      expect(retained).toBeDefined();
      expect(retained).toMatchObject({
        id: "arc",
        a: "start",
        construction: true,
      });
      if (kind === "line") {
        expect(retained).not.toHaveProperty("center");
        expect(retained).not.toHaveProperty("clockwise");
        expect(result.sketch.arcs).toEqual([]);
        expect(result.sketch.points.some((p) => p.id === "center")).toBe(false);
      }
      expect(result.retainedCurveIds).toContain("arc");
      expect(s).toEqual(before);
      expect(() => validateSketch(result.sketch)).not.toThrow();
    },
  );
  it.each([false, true])(
    "converts both retained arc sides and preserves a fixed center (%s)",
    async (fixedCenter) => {
      const s = empty(),
        r = 1000,
        sweep = 0.003;
      const point = (t: number, radius = r): [number, number] => [
        radius * Math.cos(t),
        radius * Math.sin(t),
      ];
      const end = point(sweep);
      s.points.push(
        { id: "center", x: 0, y: 0 },
        { id: "start", x: r, y: 0 },
        { id: "end", x: end[0], y: end[1] },
      );
      s.arcs!.push({
        id: "arc",
        a: "start",
        b: "end",
        center: "center",
        clockwise: false,
      });
      for (const [id, t] of [
        ["left", 0.001],
        ["right", 0.002],
      ] as const)
        line(s, id, point(t, r - 1), point(t, r + 1));
      if (fixedCenter)
        s.constraints.push({
          id: "fixed",
          kind: "fixed",
          point: "center",
          x: 0,
          y: 0,
        });
      const result = await trimSketchStroke(s, stroke(point(0.0015), 0.01));
      expect(result.sketch.arcs).toEqual([]);
      expect(result.retainedCurveIds).toHaveLength(2);
      expect(result.retainedCurveIds[0]).toBe("arc");
      const pieces = result.retainedCurveIds.map((id) =>
        result.sketch.segments.find((s) => s.id === id)!,
      );
      expect(pieces[0].a).toBe("start");
      expect(pieces[1].b).toBe("end");
      expect(pieces.every((p) => !("center" in p) && !("clockwise" in p))).toBe(
        true,
      );
      expect(result.sketch.points.some((p) => p.id === "center")).toBe(
        fixedCenter,
      );
      expect(result.sketch.constraints).toEqual(s.constraints);
      expect(() => validateSketch(result.sketch)).not.toThrow();
    },
  );
  it("keeps a nearly full retained periodic circle curved", async () => {
    const s = empty();
    circle(s, "circle", 1000);
    const x = 1000 * Math.cos(0.0005);
    line(s, "cut", [x, -2], [x, 2]);
    const result = await trimSketchStroke(s, stroke([1000, 0], 0.00001));
    expect(result.changed).toBe(true);
    expect(result.intersectionCount).toBe(2);
    expect(result.sketch.arcs).toHaveLength(1);
    expect(result.sketch.segments).toEqual(s.segments);
    expect(() => validateSketch(result.sketch)).not.toThrow();
  });
  it.each([0, Math.PI / 4, Math.PI / 2])(
    "does not use the artificial circle seam as a trim boundary (%s)",
    async (angle) => {
      const s = empty();
      circle(s, "ring", 1, angle);
      line(s, "cross", [0, -2], [0, 2]);
      const r = await trimSketchStroke(s, stroke([1, 0]));
      expect(r.changed).toBe(true);
      const samples = r.sketch.arcs!.flatMap((a) =>
        sampleSketchArc(r.sketch, a, false, 0.01),
      );
      expect(samples.length).toBeGreaterThan(2);
      expect(samples.every((p) => p[0] < 1e-10)).toBe(true);
      expect(r.intersectionCount).toBe(2);
    },
  );
  it("deletes an uncut circle as a whole rather than one semicircle", async () => {
    const s = empty();
    circle(s, "ring", 1);
    const r = await trimSketchStroke(s, stroke([0, 1]));
    expect(r.sketch.arcs).toEqual([]);
    expect(r.removedCurveIds.slice().sort()).toEqual([
      "ring-first",
      "ring-second",
    ]);
    expect(r.intersectionCount).toBe(0);
  });
  it("retains a shared endpoint used by untouched geometry", async () => {
    const s = empty();
    line(s, "gone", [0, 0], [2, 0]);
    line(s, "stay", [0, 0], [0, 2]);
    s.segments[1].a = s.segments[0].a;
    s.points = s.points.filter((p) => p.id !== "stay-a");
    const r = await trimSketchStroke(s, stroke([1, 0]));
    expect(r.sketch.segments.map((l) => l.id)).toEqual(["stay"]);
    expect(r.sketch.points.find((p) => p.id === "gone-a")).toEqual({
      id: "gone-a",
      x: 0,
      y: 0,
    });
    expect(() => validateSketch(r.sketch)).not.toThrow();
  });
  it("rejects affected constraints atomically while preserving unrelated ones", async () => {
    const s = empty();
    line(s, "cross", [-2, 0], [2, 0]);
    line(s, "vertical", [0, -2], [0, 2]);
    s.constraints = [
      { id: "fixed", kind: "fixed", point: "vertical-b", x: 0, y: 2 },
    ];
    const r = await trimSketchStroke(s, stroke([1, 0]));
    expect(r.sketch.constraints).toEqual(s.constraints);
    s.constraints.push({ id: "h", kind: "horizontal", segment: "cross" });
    const before = structuredClone(s);
    await expect(trimSketchStroke(s, stroke([1, 0]))).rejects.toThrow(
      /constraint/i,
    );
    expect(s).toEqual(before);
  });
  it("uses deterministic collision-free IDs and ignores stroke reversal/resampling", async () => {
    const s = empty();
    line(s, "cross", [-2, 0], [2, 0]);
    line(s, "a", [-1, -1], [-1, 1]);
    line(s, "b", [1, -1], [1, 1]);
    s.points.push({ id: "trim-point-0", x: 9, y: 9 });
    const req = {
      stroke: [
        [-0.5, 0],
        [0.5, 0],
      ] as [number, number][],
      radiusMm: 0.01,
    };
    const a = await trimSketchStroke(s, req),
      b = await trimSketchStroke(s, {
        ...req,
        stroke: [
          [0.5, 0],
          [0, 0],
          [-0.5, 0],
        ],
      });
    expect(a).toEqual(b);
    expect(new Set(a.sketch.points.map((p) => p.id)).size).toBe(
      a.sketch.points.length,
    );
    expect(
      new Set([...a.sketch.segments, ...(a.sketch.arcs ?? [])].map((p) => p.id))
        .size,
    ).toBe(a.sketch.segments.length + (a.sketch.arcs?.length ?? 0));
  });
  it("returns unchanged geometry for a stroke that hits nothing", async () => {
    const s = empty();
    line(s, "line", [0, 0], [1, 0]);
    const r = await trimSketchStroke(s, stroke([9, 9]));
    expect(r.changed).toBe(false);
    expect(r.sketch).toEqual(s);
    expect(r.removedCurveIds).toEqual([]);
  });
  it("rejects coincident overlapping curves instead of choosing ambiguous trim cells", async () => {
    const s = empty();
    line(s, "a", [0, 0], [2, 0]);
    line(s, "b", [1, 0], [3, 0]);
    await expect(trimSketchStroke(s, stroke([1.5, 0]))).rejects.toThrow(
      /overlap|coincident|ambiguous/i,
    );
  });
  it.each([
    { stroke: [], radiusMm: 0.1 },
    { stroke: [[NaN, 0]], radiusMm: 0.1 },
    { stroke: [[0, 0]], radiusMm: 0 },
    { stroke: [[0, 0]], radiusMm: Infinity },
  ])("rejects invalid stroke %#", async (req) => {
    await expect(
      trimSketchStroke(empty(), req as SketchTrimStroke),
    ).rejects.toThrow();
  });
  it("rejects malformed arcs without sampling or mutation", async () => {
    const s = empty();
    upperArc(s, "arc");
    s.points.find((p) => p.id === "arc-b")!.x = -2;
    const before = structuredClone(s);
    await expect(trimSketchStroke(s, stroke([0, 1]))).rejects.toThrow(
      /radius|arc/i,
    );
    expect(s).toEqual(before);
  });
  it("honors abort and ownership checks before publishing", async () => {
    const s = empty();
    circle(s, "ring", 1);
    const c = new AbortController();
    c.abort();
    await expect(
      trimSketchStroke(s, stroke([0, 1]), { signal: c.signal }),
    ).rejects.toThrow(/abort/i);
    const before = structuredClone(s);
    await expect(
      trimSketchStroke(s, stroke([0, 1]), {
        check: () => {
          throw Error("stale");
        },
      }),
    ).rejects.toThrow("stale");
    expect(s).toEqual(before);
  });
  it("enforces a finite work limit without truncating the accepted stroke", async () => {
    const req = {
      stroke: Array.from({ length: 100001 }, () => [0, 0] as [number, number]),
      radiusMm: 0.1,
    };
    await expect(trimSketchStroke(empty(), req)).rejects.toThrow(
      /limit|budget|bound|maximum/i,
    );
  });
  it("rejects short co-circular overlap even when quarter samples miss it", async () => {
    const s = empty();
    s.points.push({ id: "center", x: 0, y: 0 });
    for (const [id, start, end] of [
      ["a", 0, 2],
      ["b", 1.99, 4],
    ] as const) {
      s.points.push(
        { id: `${id}-start`, x: Math.cos(start), y: Math.sin(start) },
        { id: `${id}-end`, x: Math.cos(end), y: Math.sin(end) },
      );
      s.arcs!.push({
        id,
        a: `${id}-start`,
        b: `${id}-end`,
        center: "center",
        clockwise: false,
      });
    }
    await expect(
      trimSketchStroke(s, stroke([Math.cos(1.995), Math.sin(1.995)], 0.001)),
    ).rejects.toThrow(/overlap|ambiguous/);
  });
  it("retains clockwise major-arc direction and exact circle geometry", async () => {
    const s = empty();
    upperArc(s, "arc");
    s.points.find((p) => p.id === "arc-b")!.x = 0;
    s.points.find((p) => p.id === "arc-b")!.y = 1;
    s.arcs![0].clockwise = true;
    line(s, "cross", [0, -2], [0, 2]);
    const r = await trimSketchStroke(s, stroke([-1, 0]));
    expect(r.sketch.arcs).toHaveLength(1);
    expect(r.sketch.arcs![0].clockwise).toBe(true);
    const samples = sampleSketchArc(r.sketch, r.sketch.arcs![0], false, 0.01);
    expect(samples.every((p) => p[0] >= -1e-10 && p[1] <= 1e-10)).toBe(true);
  });
  it("does not split an otherwise uncut circle into pieces at a single tangency", async () => {
    const s = empty();
    circle(s, "ring", 1);
    line(s, "tangent", [-2, 1], [2, 1]);
    const r = await trimSketchStroke(s, stroke([1, 0]));
    expect(r.intersectionCount).toBe(1);
    expect(r.sketch.arcs).toEqual([]);
    expect(r.sketch.segments).toEqual(s.segments);
  });
  it("does not merge opposite construction policies into one circle", async () => {
    const s = empty();
    circle(s, "ring", 1);
    s.arcs![0].construction = true;
    const r = await trimSketchStroke(s, stroke([0, 1]));
    expect(r.sketch.arcs).toHaveLength(1);
    expect(r.sketch.arcs![0]).toEqual(s.arcs![1]);
  });
  it("trims tiny analytic curves without treating separated roots as tangent", async () => {
    const s = empty();
    circle(s, "ring", 1e-6);
    line(s, "far", [-2e-6, 2e-6], [2e-6, 2e-6]);
    const r = await trimSketchStroke(s, stroke([0, 1e-6], 1e-8));
    expect(r.intersectionCount).toBe(0);
    expect(r.sketch.arcs).toEqual([]);
    expect(r.sketch.segments).toEqual(s.segments);
  });
  it("allows timer cancellation during bounded pair work without source mutation", async () => {
    const s = empty();
    for (let i = 0; i < 100; i++) line(s, `line${i}`, [0, i], [1, i]);
    const before = structuredClone(s),
      controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    await expect(
      trimSketchStroke(s, stroke([9, 9]), { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(s).toEqual(before);
  });
  it.each([-1e8, 0])(
    "keeps close intersections distinct on a long line starting at %s",
    async (start) => {
      const s = empty(),
        cut = start === 0 ? 0.001 : 0;
      line(s, "long", [start, 0], [start + 2e8, 0]);
      line(s, "a", [cut, -1], [cut, 1]);
      line(s, "b", [cut + 0.001, -1], [cut + 0.001, 1]);
      const r = await trimSketchStroke(s, stroke([cut + 0.0005, 0], 0.00001));
      const pieces = r.sketch.segments.filter(
        (l) => l.id === "long" || l.id.startsWith("trim-curve"),
      );
      expect(pieces).toHaveLength(2);
      const ends = pieces.map((l) => [
        r.sketch.points.find((p) => p.id === l.a)!,
        r.sketch.points.find((p) => p.id === l.b)!,
      ]);
      expect(ends[0][1].x).toBeCloseTo(cut, 7);
      expect(ends[1][0].x).toBeCloseTo(cut + 0.001, 7);
    },
  );
  it("shares one new intersection point between two trimmed retained pieces", async () => {
    const s = empty();
    line(s, "horizontal", [-2, 0], [2, 0]);
    line(s, "vertical", [0, -2], [0, 2]);
    const r = await trimSketchStroke(s, stroke([0.2, 0.2], 0.21));
    expect(r.sketch.segments).toHaveLength(2);
    expect(r.sketch.segments[0].b).toBe(r.sketch.segments[1].b);
    expect(
      r.sketch.points.find((p) => p.id === r.sketch.segments[0].b),
    ).toMatchObject({ x: 0, y: 0 });
  });
  it("rejects oversized collections before reading their entries", async () => {
    const s = empty();
    s.points.length = 32769;
    Object.defineProperty(s.points, 0, {
      get() {
        throw Error("must not read oversized entries");
      },
    });
    await expect(trimSketchStroke(s, stroke([0, 0]))).rejects.toThrow(/limit/);
  });
  it("rejects excessive symmetry validation work before generic validation", async () => {
    const s = empty();
    s.points = Array.from({ length: 3000 }, (_, i) => ({
      id: `p${i}`,
      x: i,
      y: 0,
    }));
    s.segments = [
      { id: "a", a: "p0", b: "p1" },
      { id: "b", a: "p2", b: "p3" },
      { id: "axis", a: "p4", b: "p5", construction: true },
    ];
    s.constraints = Array.from({ length: 400 }, (_, i) => ({
      id: `sym${i}`,
      kind: "symmetric" as const,
      first: "a",
      second: "b",
      axis: "axis",
      reverse: false,
    }));
    await expect(trimSketchStroke(s, stroke([0, 0]))).rejects.toThrow(
      /validation work budget/,
    );
  });
  it("preserves untouched interleaved circle-record order", async () => {
    const s = empty();
    circle(s, "a", 1);
    circle(s, "b", 2);
    const [a1, a2, b1, b2] = s.arcs!;
    s.arcs = [a1, b1, a2, b2];
    line(s, "away", [5, 0], [6, 0]);
    const r = await trimSketchStroke(s, stroke([5.5, 0]));
    expect(r.sketch.arcs).toEqual(s.arcs);
  });
  it("does not let unrelated distant points collapse a tiny valid circle", async () => {
    const s = empty();
    circle(s, "tiny", 1e-6);
    s.points.push({ id: "distant", x: 1e9, y: 1e9 });
    const r = await trimSketchStroke(s, stroke([0, 1e-6], 1e-8));
    expect(r.sketch.arcs).toEqual([]);
    expect(r.sketch.points.find((p) => p.id === "distant")).toEqual(
      s.points.at(-1),
    );
  });
  it("rejects an infinite-line root just outside a long finite line", async () => {
    const s = empty();
    line(s, "long", [0, 0], [2e8, 0]);
    line(s, "outside", [-0.001, -1], [-0.001, 1]);
    const r = await trimSketchStroke(s, stroke([-0.001, 0.5], 0.0001));
    expect(r.intersectionCount).toBe(0);
    expect(r.sketch.segments).toEqual([s.segments[0]]);
    expect(r.sketch.points.filter((p) => p.id.startsWith("long-"))).toEqual(
      s.points.filter((p) => p.id.startsWith("long-")),
    );
  });
  it("rejects circle roots just outside an open directed arc domain", async () => {
    const s = empty();
    circle(s, "large", 1e8);
    s.arcs!.pop();
    line(s, "outside", [-1.5e8, -0.001], [-0.5e8, -0.001]);
    const r = await trimSketchStroke(s, stroke([-1.25e8, -0.001], 0.0001));
    expect(r.intersectionCount).toBe(0);
    expect(r.sketch.segments).toEqual([]);
    expect(r.sketch.arcs).toEqual(s.arcs);
  });
});
