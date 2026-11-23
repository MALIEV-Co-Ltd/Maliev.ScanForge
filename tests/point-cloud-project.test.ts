import { expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  exportStl,
} from "../src/io";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import {
  beginLandmarkAlignment,
  acceptLandmarkAlignment,
} from "../src/landmark-alignment";
import { applyRigidTransform } from "../src/registration";
import type { Entity } from "../src/types";
const cloud: Entity = {
  id: "cloud",
  name: "scan.asc",
  kind: "pointcloud",
  positions: new Float32Array([1, 2, 3, 4, 5, 6]),
  normals: [1, 0, 0, 0, 1, 0],
  visible: true,
  opacity: 1,
  color: "#abcdef",
  pointSize: 3,
  pointColorMode: "solid",
  pointAutoDensity: false,
  pointDensity: 25,
};
it("round trips points and scanner normals through JSON and binary projects with history", async () => {
  const json = serializeProject("Scan", [cloud]);
  expect(parseProject(json).entities[0]).toMatchObject({
    kind: "pointcloud",
    positions: Array.from(cloud.positions),
    normals: cloud.normals,
  });
  expect(
    parseProject(await (await serializeProjectBlob("Scan", [cloud])).text())
      .entities[0],
  ).toMatchObject({
    kind: "pointcloud",
    positions: Array.from(cloud.positions),
  });
  const session = {
    project: parseProject(json),
    history: [{ label: "Import points", entities: [cloud] }],
    future: [],
  };
  const decoded = await decodeProjectFile(await encodeProjectFile(session));
  expect(decoded.project.entities[0].normals).toEqual(cloud.normals);
  expect(decoded.project.entities[0]).toMatchObject({
    pointAutoDensity: false,
    pointDensity: 25,
    pointSize: 3,
    pointColorMode: "solid",
  });
  expect(parseProject(json).entities[0]).toMatchObject({
    pointAutoDensity: false,
    pointDensity: 25,
    pointSize: 3,
    pointColorMode: "solid",
  });
  expect(decoded.history[0].entities[0].positions).toEqual(cloud.positions);
});
it("does not export point triples as STL triangles", () => {
  const stl = exportStl([cloud]);
  expect(stl.getUint32(80, true)).toBe(0);
});

it("migrates legacy neutral cloud defaults but retains explicit solid and source appearance", async () => {
  for (const color of ["#ffffff", "#a6a6a6"]) {
    const legacy = { ...cloud, color, pointColorMode: undefined };
    expect(
      parseProject(serializeProject("Legacy", [legacy])).entities[0],
    ).toMatchObject({ color: "#aaff00", pointColorMode: "solid" });
    const restored = await decodeProjectFile(
      await encodeProjectFile({
        project: {
          format: "maliev-scanforge",
          version: 1,
          name: "Legacy",
          units: "mm",
          entities: [legacy],
        },
        history: [{ label: "Import", entities: [legacy] }],
        future: [],
      }),
    );
    expect(restored.project.entities[0]).toMatchObject({
      color: "#aaff00",
      pointColorMode: "solid",
    });
    expect(restored.history[0].entities[0]).toMatchObject({
      color: "#aaff00",
      pointColorMode: "solid",
    });
    for (const pointColorMode of ["solid", "source"] as const)
      expect(
        parseProject(
          serializeProject("Authored", [{ ...legacy, pointColorMode }]),
        ).entities[0],
      ).toMatchObject({ color, pointColorMode });
  }
});

it("rejects invalid adaptive settings at the project boundary", () => {
  for (const patch of [
    { pointDensity: 0 },
    { pointDensity: 101 },
    { pointAutoDensity: "yes" },
  ])
    expect(() =>
      parseProject(
        serializeProject("Scan", [{ ...cloud, ...patch } as Entity]),
      ),
    ).toThrow();
});
it("aligns a point cloud and rotates its normals while keeping the fixed target unchanged", () => {
  const moving = {
    ...cloud,
    positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    normals: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  const fixed = { ...moving, id: "fixed" };
  const session = beginLandmarkAlignment(moving, fixed);
  const transform = {
    rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    translation: [10, 20, 30] as [number, number, number],
  };
  session.preview = {
    kind: "paired",
    positions: applyRigidTransform(moving.positions, transform),
    diagnostics: {},
    registration: {
      transform,
      rms: 0,
      maxError: 0,
      pairs: 3,
      iterations: 1,
      converged: true,
    },
  };
  const result = acceptLandmarkAlignment(session, [moving, fixed]);
  expect(result[0].normals).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
  expect(result[1]).toBe(fixed);
});

it("round trips point selections using point indices instead of facets", async () => {
  const selected = {
    ...cloud,
    meshSelection: {
      hidden: [1],
      saved: [{ id: "saved", name: "First", triangles: [0] }],
    },
  };
  expect(
    parseProject(serializeProject("Scan", [selected])).entities[0]
      .meshSelection,
  ).toEqual(selected.meshSelection);
  expect(
    parseProject(await (await serializeProjectBlob("Scan", [selected])).text())
      .entities[0].meshSelection,
  ).toEqual(selected.meshSelection);
  const decoded = await decodeProjectFile(
    await encodeProjectFile({
      project: parseProject(serializeProject("Scan", [selected])),
      history: [],
      future: [],
    }),
  );
  expect(decoded.project.entities[0].meshSelection).toEqual(
    selected.meshSelection,
  );
  expect(() =>
    parseProject(
      serializeProject("Scan", [
        { ...selected, meshSelection: { hidden: [2], saved: [] } },
      ]),
    ),
  ).toThrow();
});
