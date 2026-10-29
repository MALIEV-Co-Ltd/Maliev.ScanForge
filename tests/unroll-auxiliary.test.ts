import nativeRollFrame from "./fixtures/unroll-native-roll-frame.json";
import nativeFrameControl from "../docs/evidence/m2-unroll-frame-control-20261026.json";
import { expect, it } from "vitest";
import fixture from "./fixtures/unroll-observed-cylinder.json";
import tilted from "./fixtures/unroll-observed-tilted-cylinder.json";
import { createUnrollAuxiliaries } from "../src/scan-unroll-auxiliary";
import { unrollScanMesh } from "../src/scan-tools-transforms";
import {
  validateProject,
  serializeProject,
  serializeProjectBlob,
  parseProject,
} from "../src/io";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import { digestEntityGeometry } from "../src/geometry-digest";
import { supportsSampledGeometry } from "../src/reference-entity";
import { entityDisplayStats } from "../src/entity-display-stats";
import { createReferenceDisplay } from "../src/reference-display";
import type { Vec3 } from "../src/types";

function auxiliary(offsetDegrees = 0, instances = 1) {
  const operation = {
    kind: "unroll" as const,
    center: fixture.center as Vec3,
    axis: fixture.axis as Vec3,
    radius: fixture.radius,
    offsetDegrees,
    instances,
  };
  return createUnrollAuxiliaries(
    operation,
    unrollScanMesh(fixture.source, operation).positions,
    {
      frameId: "frame",
      sketchId: "sketch",
      sourceEntityId: "source",
      meshEntityId: "output",
    },
  );
}

it("matches the retained native auxiliary IGES line on the cylinder control", () => {
  const { sketch } = auxiliary();
  const nativeLine = nativeFrameControl.ownership.exportedSketchLine;
  const points = sketch.sketch.points;
  expect(points).toHaveLength(2);
  expect(sketch.sketch.segments).toMatchObject([
    { a: points[0].id, b: points[1].id },
  ]);
  expect(sketch.sketch.frame).toEqual({
    origin: [0, 0, 0],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  });
  const expected = [nativeLine.start, nativeLine.end];
  for (let i = 0; i < 2; i++) {
    expect(Math.abs(points[i].x - expected[i][0])).toBeLessThanOrEqual(5e-10);
    expect(Math.abs(points[i].y - expected[i][1])).toBeLessThanOrEqual(5e-10);
    expect(expected[i][2]).toBe(0);
  }
});

it("matches the retained native Roll frame matrix on the original cylinder control", async () => {
  const bytes = Uint8Array.from(
    nativeRollFrame.matrixBytesHex.match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
  expect(bytes).toHaveLength(96);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  expect(
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  ).toBe(nativeRollFrame.matrixBytesSha256);
  const view = new DataView(bytes.buffer);
  const frame = auxiliary().frame.coordinateFrame!.frame;
  const actual = [frame.u, frame.v, frame.normal, frame.origin];
  let maximumDifference = 0;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      const native = view.getFloat64((row * 4 + column) * 8, true);
      maximumDifference = Math.max(
        maximumDifference,
        Math.abs(native - actual[column][row]),
      );
    }
  }
  // QSF matrix interpretation is inferred for this pinned native project.
  expect(maximumDifference).toBeLessThanOrEqual(1e-15);
});

it.each([
  [0, 1],
  [90, 1],
  [0, 2],
])(
  "retains the observed one-circumference sketch at %s degrees / %s instances",
  (offset, instances) => {
    const { frame, sketch } = auxiliary(offset, instances);
    expect(frame).toMatchObject({
      kind: "referenceFrame",
      name: "Roll frame",
      visible: false,
      positions: [],
      rollMapping: {
        version: 1,
        radius: 2,
        sourceEntityId: "source",
        meshEntityId: "output",
        sketchId: "sketch",
        offsetDegrees: offset,
        instances,
      },
    });
    expect(sketch.name).toBe("Sketch");
    expect(sketch.visible).toBe(true);
    if (offset === 0)
      expect(frame.coordinateFrame!.frame).toEqual({
        origin: [2, 0, 0],
        u: [0, 1, 0],
        v: [0, 0, 1],
        normal: [1, 0, 0],
      });
    expect(sketch.sketch.points.map((p) => p.x)).toEqual([
      4 * Math.PI,
      4 * Math.PI,
    ]);
    expect(sketch.sketch.points[0].y).toBeCloseTo(0, 12);
    expect(sketch.sketch.points[1].y).toBeCloseTo(1, 12);
    expect(sketch.sketch.segments).toHaveLength(1);
    expect(supportsSampledGeometry(frame)).toBe(false);
    expect(entityDisplayStats(frame)).toMatchObject({
      kind: "reference",
      triangles: 0,
      lines: 3,
    });
  },
);

it("retains an orthonormal nonorigin roll frame and radius independently of its display size", () => {
  const operation = {
    kind: "unroll" as const,
    center: tilted.center as Vec3,
    axis: tilted.axis as Vec3,
    radius: tilted.radius,
    offsetDegrees: 90,
  };
  const result = createUnrollAuxiliaries(
    operation,
    unrollScanMesh(tilted.positions, operation).positions,
    {
      frameId: "f",
      sketchId: "s",
      sourceEntityId: "source",
      meshEntityId: "output",
    },
  );
  expect(result.frame.coordinateFrame!.frame.v).toEqual(tilted.axis);
  const retained = result.frame.coordinateFrame!.frame;
  for (let i = 0; i < 3; i++)
    expect(
      retained.origin[i] - operation.radius * retained.normal[i],
    ).toBeCloseTo(tilted.center[i], 12);
  const rotated = result.frame.coordinateFrame!.frame;
  expect(
    rotated.u.reduce((sum, x, i) => sum + x * rotated.v[i], 0),
  ).toBeCloseTo(0, 14);
  expect(result.frame.rollMapping!.radius).toBe(tilted.radius);
  const display = createReferenceDisplay({ ...result.frame, visible: true });
  expect(display.object.type).toBe("LineSegments");
  expect(display.object.geometry.getAttribute("position").count).toBe(6);
  display.dispose();
});

it("retains exact frame/radius data through JSON, streamed JSON and binary reopen", async () => {
  const { frame, sketch } = auxiliary(90, 2);
  frame.coordinateFrame!.frame.origin[0] = -0;
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Unroll",
    entities: [frame],
    authoring: { sketches: [sketch] },
  });
  const reopened = [
    parseProject(
      serializeProject(project.name, project.entities, project.authoring),
    ),
    parseProject(
      await (
        await serializeProjectBlob(
          project.name,
          project.entities,
          project.authoring,
        )
      ).text(),
    ),
    (
      await decodeProjectFile(
        await encodeProjectFile({
          project,
          history: [{ entities: [frame], label: "Retained" }],
          future: [],
        }),
      )
    ).project,
  ];
  const wire = JSON.parse(
    serializeProject(project.name, project.entities, project.authoring),
  );
  expect(wire.version).toBe(4);
  expect(() => parseProject(JSON.stringify({ ...wire, version: 3 }))).toThrow(
    /version/i,
  );
  for (const next of reopened) {
    expect(next.entities[0].coordinateFrame).toEqual(frame.coordinateFrame);
    expect(
      Object.is(next.entities[0].coordinateFrame!.frame.origin[0], -0),
    ).toBe(true);
    expect(next.entities[0].rollMapping).toEqual(frame.rollMapping);
    expect(next.authoring!.sketches).toEqual([sketch]);
  }
  const digest = await digestEntityGeometry(frame);
  expect(digest.buffers.map((row) => row.path)).toContain("rollMapping.radius");
});

it("rejects empty output and malformed/mismatched semantic metadata", () => {
  const { frame } = auxiliary();
  const project = (value: unknown) => ({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Bad",
    entities: [value],
  });
  for (const patch of [
    { kind: "mesh" },
    { positions: [0, 0, 0] },
    { rollMapping: { ...frame.rollMapping, radius: 0 } },
    { rollMapping: { ...frame.rollMapping, instances: 1.5 } },
    { rollMapping: { ...frame.rollMapping, unknown: true } },
  ])
    expect(() => validateProject(project({ ...frame, ...patch }))).toThrow();
  expect(() =>
    createUnrollAuxiliaries(
      { kind: "unroll", center: [0, 0, 0], axis: [0, 0, 1], radius: 2 },
      [],
      {
        frameId: "f",
        sketchId: "s",
        sourceEntityId: "source",
        meshEntityId: "output",
      },
    ),
  ).toThrow(/empty|facet/i);
});
