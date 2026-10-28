import { expect, it } from "vitest";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { analyzeFiniteCutIncidence } from "../src/scan-split-finite-incidence";

it("collects, refines and groups indexed faces without changing the source", () => {
  const v = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
  ]);
  const t = new Uint32Array([0, 1, 2, 1, 0, 3, 4, 5, 6]);
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const before = [...v, ...t, ...cutter],
    out = refineFiniteCutterMesh(v, t, cutter);
  expect(out.faceOffsets).toHaveLength(4);
  expect([...out.triangles.slice(out.faceOffsets[2] * 3)]).toEqual([4, 5, 6]);
  expect(new Set(out.groups).size).toBe(3);
  expect(out.cutIncidence.length).toBeGreaterThan(0);
  expect(out.cutIncidence.every((edge) => edge.kind === "separating")).toBe(
    true,
  );
  expect([...v, ...t, ...cutter]).toEqual(before);
});

it("does not join separate indexed faces with coincident edge coordinates", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 4, 3, 5]);
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const result = refineFiniteCutterMesh(vertices, triangles, cutter);
  expect([...result.triangles]).toEqual([...triangles]);
  expect(new Set(result.groups).size).toBe(2);
});

it("keeps the unselected neighboring face unchanged when a cut reaches its edge", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]),
    t = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const result = refineFiniteCutterMesh(v, t, cutter, {
    selection: new Uint8Array([1, 0]),
  });
  const start = result.faceOffsets[1],
    end = result.faceOffsets[2];
  expect(end - start).toBe(1);
  expect([...result.triangles.slice(start * 3, end * 3)]).toEqual([1, 0, 3]);
});

it("keeps selected and unselected adjacent faces in distinct grouping partitions", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]),
    t = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const out = refineFiniteCutterMesh(v, t, cutter, {
    selection: new Uint8Array([1, 0]),
  });
  expect([...out.groups]).toEqual([0, 1]);
  expect([...out.triangles]).toEqual([...t]);
});

it("refines a finite cut lying on a shared source edge without losing boundary coverage", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0, 0, -1, 1, 0, -1, 0.5, 0, 1]);
  const result = refineFiniteCutterMesh(vertices, triangles, cutter);
  const incidence = result.cutIncidence;
  expect(incidence).toHaveLength(1);
  expect(incidence[0].kind).toBe("nonseparating");
});

it("propagates a rounded crossing along a sloped shared source edge", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 3, 0, 0, 4, 0, 1, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0, 0, -1, 1, 3, -1, 0, 0, 2]);
  const result = refineFiniteCutterMesh(vertices, triangles, cutter);
  expect(result.constraints.length).toBeGreaterThan(0);
  const incidence = result.cutIncidence;
  expect(incidence.some((entry) => entry.faces.length === 2)).toBe(true);
});

it("keeps the unselected face unchanged after a selected interior cut", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]),
    t = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const out = refineFiniteCutterMesh(v, t, cutter, {
    selection: new Uint8Array([1, 0]),
  });
  const first = out.faceOffsets[1],
    last = out.faceOffsets[2];
  expect(last - first).toBe(1);
  expect([...out.triangles.slice(first * 3, last * 3)]).toEqual([1, 0, 3]);
  expect(new Set(out.groups.slice(0, first)).size).toBe(1);
  expect(out.groups[first]).not.toBe(out.groups[0]);
});

it("shares a single work limit across every stage and honors cancellation", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]),
    c = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  expect(() => refineFiniteCutterMesh(v, t, c, { maxWork: 1 })).toThrow(
    /budget/i,
  );
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    refineFiniteCutterMesh(v, t, c, { signal: abort.signal }),
  ).toThrow(/abort/i);
});

it("reports completion only after collection, refinement, assembly and grouping", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]),
    c = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const events: { fraction: number; stage: string }[] = [];
  refineFiniteCutterMesh(v, t, c, {
    onProgress: (fraction, stage) => events.push({ fraction, stage }),
  });
  expect(events.at(-1)).toEqual({
    fraction: 1,
    stage: "Finite refinement complete",
  });
  expect(events.slice(0, -1).every((event) => event.fraction < 1)).toBe(true);
  expect(
    events.every(
      (event, i) => i === 0 || event.fraction >= events[i - 1].fraction,
    ),
  ).toBe(true);
});

it("does not turn a short interior cut into a boundary across its support plane", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = refineFiniteCutterMesh(v, t, cutter);
  expect(new Set(result.groups).size).toBe(1);
  expect(result.constraints).toHaveLength(2);
  const incidence = analyzeFiniteCutIncidence(
    result.triangles,
    result.constraints,
    result.groups,
  );
  expect(incidence).toHaveLength(1);
  expect(incidence[0].kind).toBe("nonseparating");
  for (const id of result.constraints) {
    const point =
      id < 3
        ? v.slice(id * 3, id * 3 + 3)
        : result.addedVertices.slice((id - 3) * 3, (id - 3) * 3 + 3);
    expect(point[0]).toBeCloseTo(0.5, 6);
    expect(point[1]).toBeGreaterThanOrEqual(0.099999);
    expect(point[1]).toBeLessThanOrEqual(0.200001);
  }
});

it("preserves area, winding and two-sided incidence for an interior finite cut", () => {
  // The cutter spans only y=0.1..0.2 on the source triangle. A valid
  // triangulation must retain that segment without extending the cut.
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = refineFiniteCutterMesh(vertices, triangles, cutter);
  const point = (id: number) =>
    id < vertices.length / 3
      ? vertices.slice(id * 3, id * 3 + 3)
      : result.addedVertices.slice(
          (id - vertices.length / 3) * 3,
          (id - vertices.length / 3) * 3 + 3,
        );
  let twiceArea = 0;
  for (let i = 0; i < result.triangles.length; i += 3) {
    const [a, b, c] = [...result.triangles.slice(i, i + 3)].map(point);
    const signed =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(signed).toBeGreaterThan(0);
    twiceArea += signed;
  }
  expect(twiceArea).toBeCloseTo(1, 7);
  expect(result.cutIncidence).toHaveLength(1);
  expect(result.cutIncidence[0].faces).toHaveLength(2);
  expect(result.cutIncidence[0].kind).toBe("nonseparating");
  const endpoints = [...result.constraints]
    .map(point)
    .sort((a, b) => a[1] - b[1]);
  expect(endpoints[0][0]).toBe(0.5);
  expect(endpoints[1][0]).toBe(0.5);
  expect(endpoints[0][1]).toBeCloseTo(0.1, 7);
  expect(endpoints[1][1]).toBeCloseTo(0.2, 7);
});

it("retains both signed sides in one component when the finite cut does not separate it", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = refineFiniteCutterMesh(vertices, triangles, cutter);
  const sourceVertexCount = vertices.length / 3;
  const x = (id: number) =>
    id < sourceVertexCount
      ? vertices[id * 3]
      : result.addedVertices[(id - sourceVertexCount) * 3];
  const sides = new Set<number>();
  for (let i = 0; i < result.triangles.length; i += 3) {
    const center =
      (x(result.triangles[i]) +
        x(result.triangles[i + 1]) +
        x(result.triangles[i + 2])) /
      3;
    if (center < 0.5) sides.add(-1);
    if (center > 0.5) sides.add(1);
  }
  expect(new Set(result.groups).size).toBe(1);
  expect(sides).toEqual(new Set([-1, 1]));
});

it("preserves the two Float32-visible near-endpoint contacts", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, -1, -1, x, 2, -1, x, 0, 1]);
  const out = refineFiniteCutterMesh(v, t, cutter);
  expect(new Set(out.groups).size).toBe(2);
  const points = [...out.constraints]
    .map((id) =>
      id < 3
        ? [...v.slice(id * 3, id * 3 + 3)]
        : [...out.addedVertices.slice((id - 3) * 3, (id - 3) * 3 + 3)],
    )
    .sort((a, b) => a[1] - b[1]);
  expect(points).toEqual([
    [x, 0, 0],
    [x, 1, 0],
  ]);
});
