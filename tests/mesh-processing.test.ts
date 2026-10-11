import { describe, expect, it } from "vitest";
import {
  analyzeMesh,
  classifyRegion,
  decimateMesh,
  fillPlanarHoles,
  repairMesh,
  repairOrientation,
  segmentMesh,
  splitNonManifoldSheets,
  smoothMesh,
} from "../src/mesh-processing";

const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
const v = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
// Outward oriented cube missing the top face.
const openCube = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
].flatMap((face) => face.flatMap((id) => v[id]));

describe("indexed mesh topology and repair", () => {
  it("welds neighboring cells and reports manifold boundaries/components", () => {
    const topology = analyzeMesh(square);
    expect(topology.vertices.length / 3).toBe(4);
    expect(topology.boundaryEdges).toBe(4);
    expect(topology.boundaryLoops).toHaveLength(1);
    expect(topology.boundaryLoops[0]).toHaveLength(4);
    expect(topology.components).toHaveLength(1);
    expect(topology.inconsistentEdges).toBe(0);
    const perturbed = [...square];
    perturbed[9] = -0.0000004;
    expect(analyzeMesh(perturbed).vertices.length / 3).toBe(4);
  });
  it("counts nonmanifold and duplicate triangles without pretending repair", () => {
    const mesh = [...square, ...square.slice(0, 9)];
    const report = analyzeMesh(mesh);
    expect(report.nonManifoldEdges).toBe(1);
    expect(report.duplicateTriangles).toBe(1);
    expect(report.components).toHaveLength(1);
  });
  it("repairs inconsistent adjacent winding and preserves input", () => {
    const inconsistent = [...square.slice(0, 9), 0, 0, 0, 0, 1, 0, 1, 1, 0];
    expect(analyzeMesh(inconsistent).inconsistentEdges).toBe(1);
    const result = repairOrientation(inconsistent);
    expect(result.flippedTriangles).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(analyzeMesh(result.positions).inconsistentEdges).toBe(0);
    expect(inconsistent.slice(9)).toEqual([0, 0, 0, 0, 1, 0, 1, 1, 0]);
  });
  it("repairs topology by removing duplicate and collapsed faces before optional capping", () => {
    const dirty = [
      ...openCube,
      ...openCube.slice(0, 9),
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
    ];
    const result = repairMesh(dirty, { fillHoles: true });
    expect(result.removedDuplicates).toBe(1);
    expect(result.removedDegenerate).toBe(1);
    expect(result.filledLoops).toBe(1);
    expect(result.topology.boundaryEdges).toBe(0);
    expect(result.positions.length / 9).toBe(12);
    expect(() => repairMesh([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(
      /all triangles/,
    );
  });
  it("fills a planar missing cube face, closes the shell, and keeps coherent winding", () => {
    const result = fillPlanarHoles(openCube);
    expect(result.filledLoops).toBe(1);
    expect(result.addedTriangles).toBe(2);
    expect(result.skipped).toEqual([]);
    const topology = analyzeMesh(result.positions);
    expect(topology.boundaryEdges).toBe(0);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.inconsistentEdges).toBe(0);
  });
  it("refuses nonplanar holes and honors requested perimeter limits", () => {
    const bent = [...openCube];
    for (let i = 0; i < bent.length; i += 3)
      if (bent[i] === 1 && bent[i + 1] === 1 && bent[i + 2] === 1)
        bent[i + 2] = 1.5;
    const result = fillPlanarHoles(bent);
    expect(result.filledLoops).toBe(0);
    expect(
      result.skipped.some((item) => item.reason.includes("not planar")),
    ).toBe(true);
    expect(fillPlanarHoles(openCube, { maxPerimeter: 3 }).filledLoops).toBe(0);
  });
  it("segments flat regions across manifold edges and separates sharp corners", () => {
    const flat = segmentMesh(square, { angleDegrees: 10 });
    expect(flat.segments).toHaveLength(1);
    expect(flat.segments[0].area).toBeCloseTo(1);
    const cube = fillPlanarHoles(openCube).positions;
    const result = segmentMesh(cube, { angleDegrees: 30 });
    expect(result.segments).toHaveLength(6);
    expect(result.segments.map((s) => s.triangles)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(segmentMesh(cube, { angleDegrees: 100 }).segments).toHaveLength(1);
  });
  it("smooths an interior spike while pinning boundary vertices", () => {
    const center = [0.5, 0.5, 0.5];
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    const fan = corners.flatMap((corner, i) => [
      ...corner,
      ...corners[(i + 1) % 4],
      ...center,
    ]);
    const result = smoothMesh(fan, { iterations: 1, strength: 1 });
    expect(Array.from(result.slice(0, 6))).toEqual(fan.slice(0, 6));
    expect(result[8]).toBeCloseTo(0);
    expect(fan[8]).toBe(0.5);
  });
  it("clusters vertices and reports reduction/error instead of promising target counts", () => {
    const mesh = [...square, 0.01, 0, 0, 1.01, 0, 0, 1.01, 1, 0];
    const result = decimateMesh(mesh, { cellSize: 0.1 });
    expect(result.originalTriangles).toBe(3);
    expect(result.triangles).toBe(2);
    expect(result.removedTriangles).toBe(1);
    expect(result.maxVertexDisplacement).toBeGreaterThan(0);
    expect(result.maxVertexDisplacement).toBeLessThan(0.1);
  });
  it("rejects invalid meshes, tolerances and options and supports cancellation", () => {
    expect(() => analyzeMesh([0, 0, 0])).toThrow(/triangle/);
    expect(() => analyzeMesh([...square.slice(0, -1), NaN])).toThrow(/finite/);
    expect(() => analyzeMesh(square, { tolerance: 0 })).toThrow(/tolerance/);
    expect(() => segmentMesh(square, { angleDegrees: 181 })).toThrow(/angle/);
    expect(() => smoothMesh(square, { iterations: 0 })).toThrow(/iterations/);
    expect(() => decimateMesh(square, { cellSize: NaN })).toThrow(/tolerance/);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      fillPlanarHoles(openCube, { signal: controller.signal }),
    ).toThrow(/cancelled/);
  });
});

describe("nonmanifold sheet and vertex repair", () => {
  const junction = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1,
  ];
  const bowtie = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0];
  function trianglesAsKeys(positions: ArrayLike<number>) {
    const keys: string[] = [];
    for (let i = 0; i < positions.length; i += 9) {
      const vertices = [0, 1, 2]
        .map(
          (corner) =>
            `${positions[i + corner * 3]},${positions[i + corner * 3 + 1]},${positions[i + corner * 3 + 2]}`,
        )
        .sort();
      keys.push(vertices.join("|"));
    }
    return keys.sort();
  }
  it("separates a three-face edge junction without moving or dropping its geometry", () => {
    const before = analyzeMesh(junction);
    expect(before.nonManifoldEdges).toBe(1);
    expect(before.nonManifoldVertices).toBe(2);
    const result = repairMesh(junction, { splitNonManifold: true });
    expect(result.sheets).toHaveLength(3);
    expect(result.splitEdges).toBe(1);
    expect(result.nonManifoldEdgesAfter).toBe(0);
    expect(result.nonManifoldVerticesAfter).toBe(0);
    expect(result.removedDegenerate).toBe(0);
    expect(result.removedDuplicates).toBe(0);
    expect(trianglesAsKeys(result.positions)).toEqual(
      trianglesAsKeys(junction),
    );
    for (const sheet of result.sheets!) {
      const topology = analyzeMesh(sheet);
      expect(topology.nonManifoldEdges).toBe(0);
      expect(topology.nonManifoldVertices).toBe(0);
    }
    expect(result.topology.nonManifoldEdges).toBe(1);
  });
  it("detects and splits disconnected vertex fans even when every edge is manifold", () => {
    const report = analyzeMesh(bowtie);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.nonManifoldVertices).toBe(1);
    const split = splitNonManifoldSheets(bowtie);
    expect(split.sheets).toHaveLength(2);
    expect(split.splitVertices).toBe(1);
    expect(
      split.sheets.every(
        (sheet) => analyzeMesh(sheet).nonManifoldVertices === 0,
      ),
    ).toBe(true);
    const conservative = repairMesh(bowtie);
    expect(conservative.nonManifoldVerticesAfter).toBe(1);
  });
  it("closes supported planar openings independently after splitting touching sheets", () => {
    const translated = openCube.map((value, i) => value + [1, 1, 1][i % 3]);
    const source = [...openCube, ...translated];
    expect(analyzeMesh(source).nonManifoldVertices).toBe(1);
    const result = repairMesh(source, {
      splitNonManifold: true,
      fillHoles: true,
    });
    expect(result.sheets).toHaveLength(2);
    expect(result.filledLoops).toBe(2);
    expect(result.nonManifoldVerticesAfter).toBe(0);
    expect(result.sheetDiagnostics.every((sheet) => sheet.watertight)).toBe(
      true,
    );
    expect(result.positions.length / 9).toBe(24);
  });
  it("refuses planar overlapping caps instead of inventing a zero-volume closure", () => {
    const result = fillPlanarHoles(square);
    expect(result.filledLoops).toBe(0);
    expect(result.addedTriangles).toBe(0);
    expect(result.skipped[0].reason).toMatch(/overlap/);
  });
  it("rejects crossing boundary loops rather than arbitrarily triangulating them", () => {
    const corners = [
      [-2, -1],
      [2, 1],
      [-2, 1],
      [2, -1],
      [0, -2],
    ];
    const wall = gridSurface(5, 1, (x, y) => [...corners[x % 5], y]);
    const result = fillPlanarHoles(wall);
    expect(result.filledLoops).toBe(0);
    expect(result.addedTriangles).toBe(0);
    expect(
      result.skipped.some((loop) => loop.reason.includes("self-intersects")),
    ).toBe(true);
  });
  it("orients a closed inward shell outward using translation-stable volume", () => {
    const closed = fillPlanarHoles(openCube).positions,
      reversed: number[] = [];
    for (let i = 0; i < closed.length; i += 9)
      reversed.push(
        ...Array.from(closed.slice(i, i + 3)),
        ...Array.from(closed.slice(i + 6, i + 9)),
        ...Array.from(closed.slice(i + 3, i + 6)),
      );
    const result = repairOrientation(reversed);
    expect(result.outwardComponents).toBe(1);
    expect(result.flippedTriangles).toBe(12);
    expect(analyzeMesh(result.positions).inconsistentEdges).toBe(0);
  });
  it("cancels sheet repair at stage checkpoints and leaves inputs untouched", () => {
    const original = [...junction],
      controller = new AbortController();
    expect(() =>
      repairMesh(junction, {
        splitNonManifold: true,
        signal: controller.signal,
        onProgress: (_fraction, stage) => {
          if (stage === "Separating manifold surface sheets")
            controller.abort();
        },
      }),
    ).toThrow(/cancelled/);
    expect(junction).toEqual(original);
  });
});

function gridSurface(
  nx: number,
  ny: number,
  point: (x: number, y: number) => number[],
): number[] {
  const positions: number[] = [];
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = point(x, y),
        b = point(x + 1, y),
        c = point(x + 1, y + 1),
        d = point(x, y + 1);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return positions;
}
describe("conservative analytic surface classification", () => {
  it("classifies an analytic plane with adequate spatial and sample support", () => {
    const plane = gridSurface(12, 10, (x, y) => [x * 2, y * 2, 3]);
    const result = classifyRegion(plane);
    expect(result.kind).toBe("plane");
    expect(result.samples).toBeGreaterThanOrEqual(24);
    expect(result.rms).toBeLessThan(1e-10);
    expect(result.maxError).toBeLessThan(1e-10);
    expect(result.fit?.kind).toBe("plane");
  });
  it("classifies a cylindrical side with full angular and axial support", () => {
    const cylinder = gridSurface(32, 8, (x, y) => [
      3 * Math.cos((x * Math.PI * 2) / 32),
      3 * Math.sin((x * Math.PI * 2) / 32),
      y,
    ]);
    const result = classifyRegion(cylinder);
    expect(result.kind).toBe("cylinder");
    expect(result.fit?.radius).toBeCloseTo(3, 5);
    expect(result.rms).toBeLessThan(1e-6);
  });
  it("classifies a sufficiently sampled spherical band", () => {
    const sphere = gridSurface(32, 12, (x, y) => {
      const longitude = (x * Math.PI * 2) / 32,
        latitude = -Math.PI * 0.4 + (y * Math.PI * 0.8) / 12;
      return [
        4 * Math.cos(latitude) * Math.cos(longitude),
        4 * Math.cos(latitude) * Math.sin(longitude),
        4 * Math.sin(latitude),
      ];
    });
    const result = classifyRegion(sphere);
    expect(result.kind).toBe("sphere");
    expect(result.fit?.radius).toBeCloseTo(4, 5);
    expect(result.rms).toBeLessThan(1e-6);
  });
  it("classifies a conical side only when measurable taper is supported", () => {
    const cone = gridSurface(24, 6, (x, y) => {
      const radius = 3 - y * 0.25,
        angle = (x * Math.PI * 2) / 24;
      return [radius * Math.cos(angle), radius * Math.sin(angle), y];
    });
    const result = classifyRegion(cone);
    expect(result.kind).toBe("cone");
    expect(result.rms).toBeLessThan(1e-5);
    expect(result.fit?.radius).toBeGreaterThan(
      result.fit?.topRadius ?? Infinity,
    );
  });
  it("keeps noisy unsupported surfaces and tiny patches explicitly unclassified", () => {
    const noise = gridSurface(10, 10, (x, y) => [
      x,
      y,
      Math.sin(x * 17 + y * 7) * 1.3,
    ]);
    const result = classifyRegion(noise);
    expect(result.kind).toBe("freeform");
    expect(result.reason).toMatch(/No supported/);
    expect(classifyRegion(square).kind).toBe("freeform");
    const narrow = gridSurface(12, 10, (x, y) => [x, y * 0.00001, 0]);
    expect(classifyRegion(narrow).reason).toMatch(/small or narrow/);
  });
  it("verifies every vertex so outliers outside the fitting sample cannot hide", () => {
    const plane = gridSurface(20, 20, (x, y) => [x, y, 0]);
    const outlier = [...plane];
    outlier[5] = 10;
    const result = classifyRegion(outlier, { maxSamples: 96 });
    expect(result.kind).toBe("freeform");
    expect(result.maxError).toBeGreaterThan(1);
  });
  it("rejects invalid classification tolerances/sample controls and cancels", () => {
    expect(() => classifyRegion(square, { absoluteTolerance: 0 })).toThrow(
      /classification/,
    );
    expect(() => classifyRegion(square, { minimumSamples: 2 })).toThrow(
      /classification/,
    );
    expect(() => classifyRegion(square, { maxSamples: 10 })).toThrow(
      /classification/,
    );
    const controller = new AbortController();
    controller.abort();
    expect(() => classifyRegion(square, { signal: controller.signal })).toThrow(
      /cancelled/,
    );
    const plane = gridSurface(12, 10, (x, y) => [x * 2, y * 2, 0]);
    expect(() =>
      classifyRegion(plane, {
        onProgress: (_fraction, stage) => {
          if (stage === "Verifying full-region residuals")
            throw new DOMException("Classification cancelled", "AbortError");
        },
      }),
    ).toThrow(/cancelled/);
  });
});
