import { expect, it, vi } from "vitest";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validateProject,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { placedCloud, cloudPlacement } from "../src/point-cloud-placement";
import { rotatePointNormals } from "../src/point-cloud";
import type { Entity, Project } from "../src/types";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const entity = (): Entity => ({
  id: "a",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([-0, 0, 2, -0, 0, 2, -0, 0, 2]),
  visible: true,
  color: "#aaaaaa",
  opacity: 1,
});
const project = (e: Entity): Project => ({
  format: "maliev-scanforge",
  version: 1,
  name: "Typed normals",
  units: "mm",
  entities: [e],
});
it("accepts finite typed normals and rejects malformed typed buffers", () => {
  const e = entity();
  expect(validateProject(project(e)).entities[0].normals).toBe(e.normals);
  expect(() =>
    validateProject(project({ ...e, normals: new Float32Array([0, 0, 1]) })),
  ).toThrow(/normals/);
  expect(() =>
    validateProject(
      project({ ...e, normals: new Float32Array(9).fill(Infinity) }),
    ),
  ).toThrow(/normals/);
});
it("keeps the v1 JSON numeric-array wire shape in synchronous and streaming exports", async () => {
  const e = entity();
  for (const text of [
    serializeProject("Typed normals", [e]),
    await (await serializeProjectBlob("Typed normals", [e])).text(),
  ]) {
    const json = JSON.parse(text);
    expect(Array.isArray(json.entities[0].normals)).toBe(true);
    expect(json.entities[0].normals).toEqual([0, 0, 2, 0, 0, 2, 0, 0, 2]);
    expect(parseProject(text).entities[0].normals).toEqual(
      json.entities[0].normals,
    );
  }
});
it("round-trips typed normal bytes and shared history identity in the existing binary format", async () => {
  const e = entity(),
    s = {
      project: project(e),
      history: [{ label: "Original", entities: [e] }],
      future: [],
    };
  const decoded = await decodeProjectFile(await encodeProjectFileLocally(s));
  expect(decoded.project.entities[0].normals).toBeInstanceOf(Float32Array);
  expect(
    Buffer.from((decoded.project.entities[0].normals as Float32Array).buffer),
  ).toEqual(Buffer.from((e.normals as Float32Array).buffer));
  expect(decoded.history[0].entities[0].normals).toBe(
    decoded.project.entities[0].normals,
  );
});
it("retains local typed cloud normals and exposes arrays on both JSON boundaries", async () => {
  const e = { ...entity(), kind: "pointcloud" as const },
    bits = Buffer.from(new Float64Array(identity).buffer).toString("hex"),
    cloud = placedCloud(e, {
      matrixBits: bits,
      sourcePositions: e.positions,
      sourceNormals: e.normals,
    });
  for (const text of [
    serializeProject("Cloud", [cloud]),
    await (await serializeProjectBlob("Cloud", [cloud])).text(),
  ]) {
    const json = JSON.parse(text).entities[0];
    expect(Array.isArray(json.normals)).toBe(true);
    expect(Array.isArray(json.pointCloudPlacement.sourceNormals)).toBe(true);
    expect(cloudPlacement(parseProject(text).entities[0])).toBeDefined();
  }
  const restored = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: project(cloud),
      history: [],
      future: [],
    }),
  );
  expect(
    cloudPlacement(restored.project.entities[0])?.sourceNormals,
  ).toBeInstanceOf(Float32Array);
});
it("keeps transformed normals compact only when requested and preserves exact values", async () => {
  const e = entity(),
    compact = createDatumTransformExecutor({
      parallel: false,
      typedNormals: true,
    }),
    legacy = createDatumTransformExecutor({ parallel: false });
  try {
    const a = await compact.transformScanStages(e, [identity, identity]),
      b = await legacy.transformScanStages(e, [identity, identity]);
    expect(a.entity.normals).toBeInstanceOf(Float32Array);
    expect(Array.isArray(b.entity.normals)).toBe(true);
    expect(Buffer.from(Float32Array.from(a.entity.normals!).buffer)).toEqual(
      Buffer.from(Float32Array.from(b.entity.normals!).buffer),
    );
    expect(e.normals?.[2]).toBe(2);
  } finally {
    compact.close();
    legacy.close();
  }
});
it("rotates typed point normals through the existing shared GUI/MCP consumer without translating", () => {
  const normals = new Float32Array([0, 0, 2]);
  expect(rotatePointNormals(normals, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([
    0, 0, 2,
  ]);
});

it("does not allocate a second copy of legacy JS normal arrays for JSON export", () => {
  const normals = [0, 0, 2, 0, 0, 2, 0, 0, 2],
    e = { ...entity(), normals },
    original = Array.from,
    spy = vi.spyOn(Array, "from");
  spy.mockImplementation(((...args: any[]) => {
    if (args[0] === normals)
      throw Error("Cloned a complete legacy normal buffer");
    return Reflect.apply(original, Array, args);
  }) as typeof Array.from);
  try {
    expect(
      JSON.parse(serializeProject("Legacy normals", [e])).entities[0].normals,
    ).toEqual(normals);
  } finally {
    spy.mockRestore();
  }
});
