import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assertSketchPlacement } from "./sketch-surface-placement.mjs";

// Real P16 edge geometry plus native source/prior-result ownership and cleanup.
export async function checkEdgeShellOwnership({ context, oc, request, root }) {
  const shapes = vm.runInContext("shapes", context);
  const initialIds = [...shapes.keys()].sort();
  const owners = [],
    snapshots = new Map();
  const remember = (shape) => {
    owners.push(shape.kernelId);
    snapshots.set(shape.kernelId, shape.brep);
    return shape;
  };
  const create = async (operation, payload) =>
    remember(await request(operation, payload));
  const preserved = (stage) => {
    for (const [id, expected] of snapshots)
      assert.equal(
        context.serializeBrep(oc, context.getShape(id)),
        expected,
        `${stage}: live BREP ${id} changed`,
      );
  };
  const inspect = async (shape, volume) => {
    const report = await request("inspectBrep", {
      brep: shape.brep,
      edgeOffset: 0,
      edgeLimit: 128,
    });
    assert(report.valid && report.solids === 1 && report.signedVolumeMm3 > 0);
    assert(Math.abs(report.signedVolumeMm3 - volume) <= 1e-6);
    return report;
  };
  const sub = (a, b) => a.map((value, axis) => value - b[axis]);
  const add = (a, b) => a.map((value, axis) => value + b[axis]);
  const scale = (a, factor) => a.map((value) => value * factor);
  const unit = (a) => scale(a, 1 / Math.hypot(...a));
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const dot = (a, b) =>
    a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  const near = (a, b) =>
    a.length === b.length &&
    a.every((value, axis) => Math.abs(value - b[axis]) <= 1e-7);
  const areaOf = (points) =>
    points.reduce(
      (sum, point, index) =>
        sum + cross(point, points[(index + 1) % points.length]),
      0,
    ) / 2;
  try {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "docs/evidence/m5-20261025/sketch-surface-real-scan.json",
          root,
        ),
        "utf8",
      ),
    );
    const sketch = fixture.authoredGuiProfile;
    const map = new Map(
      sketch.points.map((point) => [point.id, [point.x, point.y]]),
    );
    const points = sketch.segments.map((edge) => map.get(edge.a));
    const edges = sketch.segments.map((edge) => ({
      kind: "line",
      start: map.get(edge.a),
      end: map.get(edge.b),
    }));
    const height = 1.8,
      wall = 0.1,
      z = sketch.frame.origin[2],
      area = areaOf(points);
    const face = await create("sketchSurface", { edges, frame: sketch.frame });
    const base = await create("thicken", {
      kernelId: face.kernelId,
      thickness: height,
    });
    preserved("prism setup");
    const report = await inspect(base, area * height);
    assert.equal(report.edgeReferences.nextOffset, null);
    const corners = points
      .map((point, index) => {
        const a = sub(
          point,
          points[(index + points.length - 1) % points.length],
        );
        const b = sub(points[(index + 1) % points.length], point);
        return { index, turn: Math.atan2(cross(a, b), dot(a, b)) };
      })
      .filter((item) => item.turn > 0)
      .sort((a, b) => b.turn - a.turn);
    assert(corners.length);
    const cornerIndex = corners[0].index,
      turn = corners[0].turn;
    const vertex = points[cornerIndex],
      theta = Math.PI - turn;
    const candidates = report.edgeReferences.items.filter(
      (edge) =>
        edge.kind === "line" &&
        edge.endpoints &&
        edge.endpoints.every((point) => near(point.slice(0, 2), vertex)) &&
        near(
          edge.endpoints.map((point) => point[2]).sort((a, b) => a - b),
          [z, z + height],
        ),
    );
    assert.equal(candidates.length, 1);
    const failures = [],
      edgeGeometry = [],
      amount = 0.05;
    const perimeter = points.reduce(
      (sum, point, index) =>
        sum + Math.hypot(...sub(points[(index + 1) % points.length], point)),
      0,
    );
    for (const operation of ["fillet", "chamfer"]) {
      const previous =
        points[(cornerIndex + points.length - 1) % points.length];
      const next = points[(cornerIndex + 1) % points.length];
      const a = unit(sub(previous, vertex)),
        b = unit(sub(next, vertex));
      const distance =
        operation === "fillet" ? amount / Math.tan(theta / 2) : amount;
      assert(
        distance <
          Math.min(
            Math.hypot(...sub(previous, vertex)),
            Math.hypot(...sub(next, vertex)),
          ) /
            4,
      );
      const before = add(vertex, scale(a, distance)),
        after = add(vertex, scale(b, distance));
      const footprint = points.flatMap((point, index) =>
        index === cornerIndex ? [before, after] : [point],
      );
      const oracle = {
        version: 1,
        frame: sketch.frame,
        constraints: [],
        points: footprint.map(([x, y], index) => ({ id: `p${index}`, x, y })),
        segments: footprint.map((_, index) => ({
          id: `e${index}`,
          a: `p${index}`,
          b: `p${(index + 1) % footprint.length}`,
        })),
      };
      if (operation === "fillet") {
        const edge = oracle.segments.splice(cornerIndex, 1)[0];
        const center = add(
          vertex,
          scale(unit(add(a, b)), amount / Math.sin(theta / 2)),
        );
        oracle.points.push({ id: "center", x: center[0], y: center[1] });
        oracle.arcs = [{ ...edge, center: "center", clockwise: false }];
      }
      const removed =
        operation === "fillet"
          ? amount * amount * (1 / Math.tan(theta / 2) - turn / 2)
          : (amount * amount * Math.sin(theta)) / 2;
      const newPerimeter =
        perimeter -
        2 * distance +
        (operation === "fillet"
          ? amount * turn
          : Math.hypot(...sub(after, before)));
      const expectedVolume = (area - removed) * height;
      const expectedArea = 2 * (area - removed) + newPerimeter * height;
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = await create("edges", {
          kernelId: base.kernelId,
          edgeIndices: [candidates[0].index],
          amount,
          operation,
        });
        preserved(`${operation} successful P16 attempt ${repeat + 1}`);
        const resultReport = await inspect(result, expectedVolume);
        const areaTolerance = Math.max(
          1e-6,
          Math.abs(expectedArea) * (operation === "fillet" ? 1e-5 : 1e-8),
        );
        assert(Math.abs(resultReport.areaMm2 - expectedArea) <= areaTolerance);
        assertSketchPlacement(resultReport, oracle, height);
        const circles = resultReport.edgeReferences.items.filter(
          (edge) => edge.kind === "circle",
        );
        assert.equal(circles.length, operation === "fillet" ? 2 : 0);
        for (const circle of circles)
          assert(Math.abs(circle.lengthMm - amount * turn) <= 1e-7);
        preserved(
          `${operation} independently inspected P16 attempt ${repeat + 1}`,
        );
        edgeGeometry.push({
          operation,
          repeat: repeat + 1,
          amountMm: amount,
          expectedVolumeMm3: expectedVolume,
          expectedAreaMm2: expectedArea,
          volumeMm3: resultReport.signedVolumeMm3,
          areaMm2: resultReport.areaMm2,
        });
      }
      // A separate genuinely excessive treatment retains native-failure ownership
      // coverage; the old rejection of the useful P16 profile is not a contract.
      {
        const before = shapes.size;
        await assert.rejects(async () => {
          const unexpected = await request("edges", {
            kernelId: base.kernelId,
            edgeIndices: [candidates[0].index],
            amount: 1000,
            operation,
          });
          remember(unexpected);
        });
        assert.equal(
          shapes.size,
          before,
          "Rejected edge operation must leave no result handle",
        );
        preserved(`${operation} rejected oversized treatment`);
        failures.push({ operation, amountMm: 1000, rejectedGeometry: true });
      }
    }
    const refs = await request("alignmentReferences", {
      kernelId: base.kernelId,
    });
    const caps = refs.filter((item) => {
      if (item.kind !== "plane") return false;
      const u = item.derivativeU,
        v = item.derivativeV;
      const n = unit([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
      return (
        Math.abs(item.evaluatedPoint[2] - z - height) <= 1e-7 &&
        Math.abs(Math.abs(n[2]) - 1) <= 1e-8
      );
    });
    assert.equal(caps.length, 1);
    preserved("dynamic cap inspection");
    const inner = points.map((point, index) => {
      const a = unit(
        sub(point, points[(index + points.length - 1) % points.length]),
      );
      const b = unit(sub(points[(index + 1) % points.length], point));
      assert(cross(a, b) > 0);
      const first = add(point, scale([-a[1], a[0]], wall));
      const second = add(point, scale([-b[1], b[0]], wall));
      return add(first, scale(a, cross(sub(second, first), b) / cross(a, b)));
    });
    const expected = area * height - areaOf(inner) * (height - wall);
    const shells = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      const shell = await create("shell", {
        kernelId: base.kernelId,
        faceIndices: [caps[0].faceIndex],
        thickness: -wall,
      });
      preserved(
        `shell creation ${repeat + 1} preserves source and previous shell`,
      );
      shells.push(await inspect(shell, expected));
      preserved(`shell inspection ${repeat + 1}`);
    }
    const beforeFailure = shapes.size;
    await assert.rejects(
      request("shell", {
        kernelId: base.kernelId,
        faceIndices: [report.faces],
        thickness: -wall,
      }),
      /Face index is outside/,
    );
    assert.equal(shapes.size, beforeFailure);
    preserved("failed shell preserves source and both preceding results");
    const moved = await create("transform", {
      kernelId: base.kernelId,
      translation: [10, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
    });
    await inspect(moved, area * height);
    preserved("source handle recovery after failures and successful shells");
    return {
      failures,
      edgeGeometry,
      shellExpectedVolumeMm3: expected,
      shellReports: shells,
      liveSourcesAndPriorResultsExact: true,
      retainedLiveSource: true,
      scope:
        "Actual P16 fillet/chamfer/shell geometry and ownership regression; no native-application parity claim",
    };
  } finally {
    assert.equal(await request("release", owners.reverse()), true);
    assert.deepEqual([...shapes.keys()].sort(), initialIds);
  }
}
