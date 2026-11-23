import { expect, it } from "vitest";
import { collectFiniteCutterHits } from "../src/scan-edit-general-split";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";

it("accounts for junction bookkeeping within the hit memory estimate", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([
    0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004, 0.0004, 1,
  ]);
  const beforeVertices = vertices.slice();
  const beforeCutter = cutter.slice();
  const options = {
    preciseCoordinates: true,
    maxEstimatedHitAndAssociationBytes: 1024,
  };
  expect(() =>
    collectFiniteCutterHits(vertices, triangles, cutter, options),
  ).not.toThrow();
  expect(() =>
    collectFiniteCutterHits(vertices, triangles, cutter, {
      ...options,
      associateCoplanarCorners: true,
    }),
  ).toThrow("temporary memory budget exceeded");
  expect(vertices).toEqual(beforeVertices);
  expect(cutter).toEqual(beforeCutter);
});

it("does not reserve junction maps for every unrelated hit", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter: number[] = [0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004, 0.0004, 1];
  for (let i = 0; i < 10; i++) {
    const x = 0.1 + i * 0.02;
    cutter.push(x, 0.1, 0, x, 0.2, 0, x, 0.1, 1);
  }
  const result = collectFiniteCutterHits(
    vertices,
    triangles,
    new Float32Array(cutter),
    {
      preciseCoordinates: true,
      associateCoplanarCorners: true,
      maxEstimatedHitAndAssociationBytes: 20_000,
    },
  );
  expect(result.faces.get(0)).toHaveLength(11);
});

it("preserves a boundary-to-boundary folded cut near the source corner", () => {
  const p = [0.0004, 0.0004, 0];
  const u = [0.0004, 0.0004, 1];
  const q = [0.5, 0.5, 0];
  const r = [0.5, 0, 0];
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([...p, ...q, ...u, ...p, ...u, ...r]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(2);
});

it("bounds work for a connected fan at one cutter junction", () => {
  const p = [0.0004, 0.0004, 0];
  const q = (i: number) =>
    i === 0
      ? [0.1, 0.1, 1]
      : i === 1
        ? [0.2, 0.2, -1]
        : [0.1 + i * 0.0001, 0.2, i % 2 ? -1 : 1];
  const triangles: number[] = [];
  for (let i = 0; i < 600; i++) triangles.push(...p, ...q(i), ...q(i + 1));
  expect(() =>
    collectFiniteCutterHits(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      new Float32Array(triangles),
      {
        preciseCoordinates: true,
        associateCoplanarCorners: true,
        maxWork: 300000,
      },
    ),
  ).not.toThrow();
});

it("does not join a disconnected path to an occupied corner", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([
    0, 0, 0, 0.2, 0.4, 0, 0, 0, 1, 0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004,
    0.0004, 1,
  ]);
  const hits = collectFiniteCutterHits(
    vertices,
    new Uint32Array([0, 1, 2]),
    cutter,
    { preciseCoordinates: true, associateCoplanarCorners: true },
  ).faces.get(0)!;
  expect(hits).toHaveLength(2);
  const starts = hits.map((hit) =>
    hit.points.some((p) => p[0] === 0 && p[1] === 0 && p[2] === 0),
  );
  expect(starts.filter(Boolean)).toHaveLength(1);
});

it("does not join a disconnected path to a corner occupied on an adjacent source face", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 0, 3, 4]);
  const cutter = new Float32Array([
    0, 0, 0, -0.2, -0.4, 0, 0, 0, 1, 0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004,
    0.0004, 1,
  ]);
  const count = (enabled: boolean) => {
    const hits = collectFiniteCutterHits(vertices, triangles, cutter, {
      preciseCoordinates: true,
      associateCoplanarCorners: enabled,
    });
    return [...hits.faces.values()]
      .flat()
      .filter((hit) =>
        hit.points.some((p) => p[0] === 0 && p[1] === 0 && p[2] === 0),
      ).length;
  };
  expect(count(true)).toBe(count(false));
});

it("does not merge distinct proposals from adjacent source faces", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0]);
  const triangles = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const cutter = new Float32Array([
    0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004, 0.0004, 1, -0.0004, 0.0004, 0, -0.4,
    0.4, 0, -0.0004, 0.0004, 1,
  ]);
  const hits = collectFiniteCutterHits(vertices, triangles, cutter, {
    preciseCoordinates: true,
    associateCoplanarCorners: true,
  });
  const cornerHits = [...hits.faces.values()]
    .flat()
    .filter((hit) =>
      hit.points.some((p) => p[0] === 0 && p[1] === 0 && p[2] === 0),
    );
  expect(cornerHits).toHaveLength(0);
});

it("does not spend association work when the option is disabled", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([
    0.0004, 0.0004, 0, 0.4, 0.4, 0, 0.0004, 0.0004, 1,
  ]);
  const count = (disabled: boolean) => {
    let work = 0;
    collectFiniteCutterHits(source, new Uint32Array([0, 1, 2]), cutter, {
      preciseCoordinates: true,
      ...(disabled ? { associateCoplanarCorners: false } : {}),
      check: () => {
        work++;
      },
    });
    return work;
  };
  expect(count(true)).toBe(count(false));
});

it("still rejects a non-manifold edge touched near its corner", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1,
  ]);
  const source = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]);
  const cutter = new Float32Array([0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1]);
  expect(() =>
    refineFiniteCutterMesh(vertices, source, cutter, {
      preciseCoordinates: true,
    }),
  ).toThrow(/non.manifold/i);
});

it("keeps both sides of a through-plane cut near a shared source corner", () => {
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0,
  ]);
  const cutter = new Float32Array([
    0.0004, -2, -2, 0.0004, 4, -2, 0.0004, -2, 4,
  ]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(2);
  const x = Math.fround(0.0004);
  const ranges = result.segments.map((part) => {
    const coords = Array.from(part).filter((_, i) => i % 3 === 0);
    return [Math.min(...coords), Math.max(...coords)];
  });
  expect(ranges.every(([min, max]) => max <= x + 1e-8 || min >= x - 1e-8)).toBe(
    true,
  );
  expect(ranges.some(([, max]) => max <= x + 1e-8)).toBe(true);
  expect(ranges.some(([min]) => min >= x - 1e-8)).toBe(true);
});

it("keeps the original shared-edge contact when a neighboring source face is excluded", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1]);
  const hits = collectFiniteCutterHits(vertices, triangles, cutter, {
    preciseCoordinates: true,
    associateCoplanarCorners: true,
    selection: new Uint8Array([1, 0]),
  });
  expect(hits.contacts.some((c) => c.t > 0 && c.t < 1)).toBe(true);
  expect(
    hits.faces
      .get(0)!
      .some((h) =>
        h.points.some((p) => p[0] === Math.fround(0.0004) && p[1] === 0),
      ),
  ).toBe(true);
});
it("retains an independent intervening contact on the same source edge", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([
    0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1, 0.0002, 0, 0, 0.3, 0.2, 0, 0.15,
    0.1, 1,
  ]);
  const hits = collectFiniteCutterHits(vertices, triangles, cutter, {
    preciseCoordinates: true,
    associateCoplanarCorners: true,
  });
  expect(
    hits.contacts.some((c) => Math.abs(c.t - Math.fround(0.0002)) < 1e-12),
  ).toBe(true);
  expect(
    hits.contacts.some((c) => Math.abs(c.t - Math.fround(0.0004)) < 1e-12),
  ).toBe(true);
});

it("does not move only one occurrence of a junction on overlapping source faces", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, -0.1, -0.1, 0, 0.5, -0.1, 0, -0.1, 0.5, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const cutter = new Float32Array([0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1]);
  const hits = collectFiniteCutterHits(vertices, triangles, cutter, {
    preciseCoordinates: true,
    associateCoplanarCorners: true,
  });
  const p = Math.fround(0.0004);
  const matches = [...hits.faces.values()]
    .flat()
    .filter((hit) =>
      hit.points.some((v) => v[0] === p && v[1] === 0 && v[2] === 0),
    );
  expect(matches).toHaveLength(2);
});
