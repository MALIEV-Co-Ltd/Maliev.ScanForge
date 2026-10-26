import assert from "node:assert/strict";
import vm from "node:vm";

export async function checkPlanarThickening({ context, oc, request }) {
  const shapes = vm.runInContext("shapes", context),
    initialIds = [...shapes.keys()].sort();
  const owners = [],
    snapshots = new Map(),
    cases = [];
  const own = (shape) => {
    owners.push(shape.kernelId);
    snapshots.set(shape.kernelId, shape.brep);
    return shape;
  };
  const create = async (operation, payload) =>
    own(await request(operation, payload));
  const preserved = (stage) => {
    for (const [id, expected] of snapshots)
      assert.equal(
        context.serializeBrep(oc, context.getShape(id)),
        expected,
        `${stage}: live BREP ${id} changed`,
      );
  };
  const near = (a, b, tolerance = 1e-7) =>
    a.length === b.length &&
    a.every((value, axis) => Math.abs(value - b[axis]) <= tolerance);
  const inspect = (shape) =>
    request("inspectBrep", { brep: shape.brep, edgeOffset: 0, edgeLimit: 128 });
  const reversedFace = (source) => {
    const handles = [],
      keep = (value) => (handles.push(value), value);
    try {
      const copy = keep(
        new oc.BRepBuilderAPI_Copy_2(
          context.getShape(source.kernelId),
          true,
          false,
        ),
      );
      const shape = keep(copy.Shape()),
        reversed = keep(shape.Reversed());
      return own(context.register(oc, oc.TopoDS.Face_1(reversed)));
    } finally {
      context.cleanup(handles);
    }
  };
  const expectedBounds = (profile, frame, normal, thickness) => {
    const uv = [...profile.points];
    if (profile.kind === "circle")
      for (let axis = 0; axis < 3; axis++) {
        const angle = Math.atan2(frame.v[axis], frame.u[axis]);
        for (const value of [angle, angle + Math.PI])
          uv.push([
            profile.radius * Math.cos(value),
            profile.radius * Math.sin(value),
          ]);
      }
    const base = uv.map(([x, y]) =>
      frame.origin.map(
        (value, axis) => value + frame.u[axis] * x + frame.v[axis] * y,
      ),
    );
    const vertices = base.concat(
      base.map((point) =>
        point.map((value, axis) => value + normal[axis] * thickness),
      ),
    );
    return {
      min: [0, 1, 2].map((axis) =>
        Math.min(...vertices.map((point) => point[axis])),
      ),
      max: [0, 1, 2].map((axis) =>
        Math.max(...vertices.map((point) => point[axis])),
      ),
    };
  };
  const check = async (label, source, frame, reversed, profile, area) => {
    const expectedNormal = frame.normal.map((value) =>
      reversed ? -value : value,
    );
    assert(source.planeFrame && near(source.planeFrame.normal, expectedNormal));
    for (const thickness of [1.8, -1.8]) {
      const result = await create("thicken", {
        kernelId: source.kernelId,
        thickness,
      });
      preserved(`${label} ${thickness} creation`);
      const report = await inspect(result);
      assert(report.valid && report.solids === 1 && report.signedVolumeMm3 > 0);
      assert(
        Math.abs(report.signedVolumeMm3 - area * Math.abs(thickness)) <= 1e-7,
      );
      assert.equal(report.edgeReferences.nextOffset, null);
      const endpoints = report.edgeReferences.items.flatMap((edge) => {
        assert(edge.endpoints);
        return edge.endpoints;
      });
      assert(endpoints.length);
      const projection = (normal) =>
        endpoints.map((point) =>
          point.reduce(
            (sum, value, axis) =>
              sum + (value - frame.origin[axis]) * normal[axis],
            0,
          ),
        );
      const signed = projection(expectedNormal),
        physical = projection(frame.normal);
      assert(
        near(
          [Math.min(...signed), Math.max(...signed)],
          [Math.min(0, thickness), Math.max(0, thickness)],
        ),
      );
      const physicalThickness = reversed ? -thickness : thickness;
      assert(
        near(
          [Math.min(...physical), Math.max(...physical)],
          [Math.min(0, physicalThickness), Math.max(0, physicalThickness)],
        ),
      );
      const bounds = expectedBounds(profile, frame, expectedNormal, thickness);
      for (const key of ["min", "max"]) {
        const actual = [0, 1, 2].map((axis) => {
          const values = report.edgeReferences.items.map((edge) => {
            assert(edge.boundsMm);
            return edge.boundsMm[key][axis];
          });
          return key === "min" ? Math.min(...values) : Math.max(...values);
        });
        assert(
          near(actual, bounds[key], 1e-6),
          `${label} ${thickness} authored world ${key} bounds differ`,
        );
      }
      preserved(`${label} ${thickness} inspection`);
      cases.push({
        label,
        thickness,
        normal: expectedNormal,
        bounds,
        volumeMm3: report.signedVolumeMm3,
      });
    }
  };
  try {
    const circle = [
      {
        kind: "arc",
        start: [3, 0],
        end: [-3, 0],
        center: [0, 0],
        clockwise: false,
      },
      {
        kind: "arc",
        start: [-3, 0],
        end: [3, 0],
        center: [0, 0],
        clockwise: false,
      },
    ];
    const circleProfile = {
      kind: "circle",
      radius: 3,
      points: circle.map((edge) => edge.start),
    };
    for (const [placement, frame] of [
      [
        "OXY",
        { origin: [0, 0, 5], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
      ],
      [
        "rotated",
        {
          origin: [10, 20, 30],
          u: [0.6, 0.8, 0],
          v: [0, 0, 1],
          normal: [0.8, -0.6, 0],
        },
      ],
    ])
      for (const clockwise of [false, true]) {
        const source = await create("sketchSurface", {
          edges: circle.map((edge) => ({ ...edge, clockwise })),
          frame,
        });
        const label = `${placement}-${clockwise ? "CW" : "CCW"}`;
        await check(
          `${label}-forward`,
          source,
          frame,
          false,
          circleProfile,
          9 * Math.PI,
        );
        const reversed = reversedFace(source);
        preserved(`${label} reversed fixture`);
        await check(
          `${label}-reversed`,
          reversed,
          frame,
          true,
          circleProfile,
          9 * Math.PI,
        );
      }
    assert.equal(cases.length, 16);
    assert.equal(
      typeof oc.BRepBuilderAPI_MakeFace_16.prototype.Add,
      "function",
    );
    const handles = [],
      keep = (value) => (handles.push(value), value);
    try {
      const frame = {
        origin: [0, 0, 5],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      };
      const origin = keep(new oc.gp_Pnt_3(...frame.origin)),
        direction = keep(new oc.gp_Dir_4(...frame.normal));
      const plane = keep(new oc.gp_Pln_3(origin, direction));
      const outer = context.polygonWire(
        oc,
        [
          [-2, -1, 5],
          [2, -1, 5],
          [2, 2, 5],
          [-2, 2, 5],
        ],
        handles,
      );
      const inner = context.polygonWire(
        oc,
        [
          [-0.5, 0, 5],
          [-0.5, 1, 5],
          [0.5, 1, 5],
          [0.5, 0, 5],
        ],
        handles,
      );
      const maker = keep(new oc.BRepBuilderAPI_MakeFace_16(plane, outer, true));
      maker.Add(inner);
      assert(maker.IsDone());
      const source = own(context.register(oc, maker.Face()));
      const sourceReport = await inspect(source);
      assert(
        sourceReport.valid &&
          sourceReport.solids === 0 &&
          Math.abs(sourceReport.areaMm2 - 11) <= 1e-7,
      );
      const profile = {
        kind: "polygon",
        points: [
          [-2, -1],
          [2, -1],
          [2, 2],
          [-2, 2],
          [-0.5, 0],
          [-0.5, 1],
          [0.5, 1],
          [0.5, 0],
        ],
      };
      await check("hole-forward", source, frame, false, profile, 11);
      const reversed = reversedFace(source);
      preserved("hole reversed fixture");
      await check("hole-reversed", reversed, frame, true, profile, 11);
    } finally {
      context.cleanup(handles);
    }
    assert.equal(
      cases.filter((row) => row.label.startsWith("hole-")).length,
      4,
    );
    assert.equal(cases.length, 20);
    const curved = await create("surface", {
      format: "scanforge-nurbs",
      version: 1,
      countU: 2,
      countV: 2,
      degreeU: 1,
      degreeV: 1,
      knotsU: [0, 0, 1, 1],
      knotsV: [0, 0, 1, 1],
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 20, 0],
        [10, 20, 2],
      ],
      weights: [1, 1, 1, 1],
    });
    assert.equal(curved.planeFrame, undefined);
    for (const thickness of [0.1, -0.1]) {
      const result = await create("thicken", {
        kernelId: curved.kernelId,
        thickness,
      });
      const report = await inspect(result);
      assert(report.valid && report.solids === 1 && report.signedVolumeMm3 > 0);
      preserved(`curved legacy offset ${thickness}`);
    }
    return {
      planarCases: cases,
      curvedLegacyCases: 2,
      liveSourcesAndPriorResultsExact: true,
      scope:
        "Actual production planar thickening: independent authored normal/bounds/masses, reversed FACE, holes and curved-path regression",
    };
  } finally {
    assert.equal(await request("release", owners.reverse()), true);
    assert.deepEqual([...shapes.keys()].sort(), initialIds);
  }
}
