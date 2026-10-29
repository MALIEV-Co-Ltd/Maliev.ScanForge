import assert from "node:assert/strict";

// Independent Float64 expectations from authored UV/frame, never display triangles.
export function assertSketchPlacement(report, sketch, thickness = 0) {
  const endpointToleranceMm = 1e-7,
    boundsToleranceMm = 1e-6;
  const frame = sketch.frame ?? {
    origin: [0, 0, 0],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  };
  const world = (point, offset = 0) =>
    frame.origin.map(
      (n, axis) =>
        n +
        frame.u[axis] * point.x +
        frame.v[axis] * point.y +
        frame.normal[axis] * offset,
    );
  const points = new Map(sketch.points.map((point) => [point.id, point]));
  const near = (a, b, tolerance = endpointToleranceMm) =>
    a.length === 3 && a.every((n, axis) => Math.abs(n - b[axis]) <= tolerance);
  const bounds = (values) => ({
    min: [0, 1, 2].map((axis) =>
      Math.min(...values.map((point) => point[axis])),
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(...values.map((point) => point[axis])),
    ),
  });
  const checkBounds = (actual, expected) => {
    assert(actual, "Exact edge bounds are required for placement proof");
    for (const key of ["min", "max"])
      assert(
        near(actual[key], expected[key], boundsToleranceMm),
        `Exact ${key} bounds ${JSON.stringify(actual)} differ from authored frame ${JSON.stringify(expected)}`,
      );
  };
  const curves = [...sketch.segments, ...(sketch.arcs ?? [])].filter(
    (curve) => !curve.construction,
  );
  const expectedEdges = curves.map((curve) => {
    const a = points.get(curve.a),
      b = points.get(curve.b);
    assert(a && b);
    const extremes = [world(a), world(b)];
    const kind = "center" in curve ? "circle" : "line";
    if (kind === "circle") {
      const center = points.get(curve.center);
      assert(center);
      const radius = Math.hypot(a.x - center.x, a.y - center.y);
      const start = Math.atan2(a.y - center.y, a.x - center.x);
      const end = Math.atan2(b.y - center.y, b.x - center.x);
      const turn = 2 * Math.PI;
      const positive = (angle) => ((angle % turn) + turn) % turn;
      const sweep = positive(curve.clockwise ? start - end : end - start);
      const inside = (angle) =>
        positive(curve.clockwise ? start - angle : angle - start) <=
        sweep + 1e-12;
      for (let axis = 0; axis < 3; axis++) {
        const extremum = Math.atan2(frame.v[axis], frame.u[axis]);
        for (const angle of [extremum, extremum + Math.PI])
          if (inside(angle))
            extremes.push(
              world({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
              }),
            );
      }
    }
    return {
      kind,
      endpoints: [world(a), world(b)],
      boundsMm: bounds(extremes),
    };
  });
  assert(expectedEdges.length > 0);
  const edges = report.edgeReferences?.items;
  assert(
    edges?.length > 0 && report.edgeReferences.nextOffset === null,
    "Complete public exact edge references are required for placement proof",
  );
  const expectedVertices = expectedEdges.flatMap((edge) => edge.endpoints);
  if (thickness !== 0)
    expectedVertices.push(
      ...expectedVertices.map((point) =>
        point.map((n, axis) => n + frame.normal[axis] * thickness),
      ),
    );
  const actualVertices = [];
  for (const edge of edges) {
    assert(
      edge.endpoints?.length === 2,
      `Exact endpoints missing: ${JSON.stringify(edge)}`,
    );
    for (const endpoint of edge.endpoints) {
      assert(
        expectedVertices.some((expected) => near(endpoint, expected)),
        `Native endpoint ${JSON.stringify(endpoint)} is outside independently placed authored vertices`,
      );
      actualVertices.push(endpoint);
    }
  }
  for (const vertex of expectedVertices)
    assert(
      actualVertices.some((actual) => near(actual, vertex)),
      `Independently placed authored vertex ${JSON.stringify(vertex)} is absent`,
    );
  if (thickness === 0) {
    assert.equal(edges.length, expectedEdges.length);
    const unused = new Set(edges);
    for (const expected of expectedEdges) {
      const actual = [...unused].find(
        (edge) =>
          edge.kind === expected.kind &&
          ((near(edge.endpoints[0], expected.endpoints[0]) &&
            near(edge.endpoints[1], expected.endpoints[1])) ||
            (near(edge.endpoints[0], expected.endpoints[1]) &&
              near(edge.endpoints[1], expected.endpoints[0]))) &&
          edge.boundsMm &&
          ["min", "max"].every((key) =>
            near(edge.boundsMm[key], expected.boundsMm[key], boundsToleranceMm),
          ),
      );
      assert(
        actual,
        `Expected exact ${expected.kind} edge at ${JSON.stringify(expected.endpoints)}`,
      );
      checkBounds(actual.boundsMm, expected.boundsMm);
      unused.delete(actual);
    }
  }
  const expectedBounds = {
    min: [0, 1, 2].map(
      (axis) =>
        Math.min(...expectedEdges.map((edge) => edge.boundsMm.min[axis])) +
        Math.min(0, frame.normal[axis] * thickness),
    ),
    max: [0, 1, 2].map(
      (axis) =>
        Math.max(...expectedEdges.map((edge) => edge.boundsMm.max[axis])) +
        Math.max(0, frame.normal[axis] * thickness),
    ),
  };
  const actualBounds = {
    min: [0, 1, 2].map((axis) =>
      Math.min(
        ...edges.map((edge) => {
          assert(edge.boundsMm);
          return edge.boundsMm.min[axis];
        }),
      ),
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(...edges.map((edge) => edge.boundsMm.max[axis])),
    ),
  };
  checkBounds(actualBounds, expectedBounds);
  const normalOffsets = actualVertices.map((point) =>
    point.reduce(
      (sum, n, axis) => sum + (n - frame.origin[axis]) * frame.normal[axis],
      0,
    ),
  );
  const normalRangeMm = [
    Math.min(...normalOffsets),
    Math.max(...normalOffsets),
  ];
  assert(
    Math.abs(normalRangeMm[0] - Math.min(0, thickness)) <= endpointToleranceMm,
  );
  assert(
    Math.abs(normalRangeMm[1] - Math.max(0, thickness)) <= endpointToleranceMm,
    "Thickening must extend in the authored positive normal for positive thickness",
  );
  return {
    frame,
    thicknessMm: thickness,
    expectedBounds,
    actualBounds,
    normalRangeMm,
    endpointToleranceMm,
    boundsToleranceMm,
    scope:
      "Exact public native edge endpoints/bounds versus independent authored UV-to-world placement",
  };
}
