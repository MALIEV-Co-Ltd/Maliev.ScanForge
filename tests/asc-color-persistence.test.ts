import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { Entity, Project } from "../src/types";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validateProject,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { projectValueBytes } from "../src/project-value-stream";
import { digestEntityGeometry } from "../src/geometry-digest";

const cloud = () =>
  ({
    id: "cloud",
    name: "colored",
    kind: "pointcloud",
    positions: new Float32Array([1, -0, 3, 4, 5, 6]),
    color: "#ffffff",
    visible: true,
    opacity: 1,
    pointColors: new Uint8Array([255, 0, 12, 255, 4, 5, 6, 255]),
    ascAttributes: "xyz-rgb",
  }) as Entity & { pointColors: Uint8Array; ascAttributes: "xyz-rgb" };
const project = (entity: Entity): Project => ({
  format: "maliev-scanforge",
  version: 1,
  name: "RGB",
  units: "mm",
  entities: [entity],
});

it("writes opaque RGBA as canonical bounded u8 bytes", () => {
  const colors = new Uint8Array(1024 * 1024 + 4).fill(255);
  const chunks = [...projectValueBytes(colors, "u8")];
  expect(chunks.map((c) => c.length)).toEqual([1024 * 1024, 4]);
  expect(chunks[0]).toEqual(colors.subarray(0, 1024 * 1024));
});
it("round trips explicit colors and interpretation through both JSON writers", async () => {
  const e = cloud();
  for (const text of [
    serializeProject("RGB", [e]),
    await (await serializeProjectBlob("RGB", [e])).text(),
  ]) {
    const decoded = parseProject(text).entities[0] as typeof e;
    expect(decoded.pointColors).toBeInstanceOf(Uint8Array);
    expect(decoded.pointColors).toEqual(e.pointColors);
    expect(decoded.ascAttributes).toBe("xyz-rgb");
    expect(JSON.parse(text).entities[0].pointColors).toEqual([
      ...e.pointColors,
    ]);
    expect(JSON.parse(text).version).toBe(2);
  }
});
it.each([
  { pointColors: [1, 2, 3, 254, 4, 5, 6, 255] },
  { pointColors: [1, 2, 3, 255] },
  { pointColors: [256, 2, 3, 255, 4, 5, 6, 255] },
  { pointColors: [1.5, 2, 3, 255, 4, 5, 6, 255] },
  { kind: "mesh" },
  { ascAttributes: "ambiguous" },
])("rejects invalid color/interpretation input %j", (patch) => {
  expect(() =>
    validateProject(project({ ...cloud(), ...patch } as Entity)),
  ).toThrow();
});
it("stores color chunks outside metadata and preserves current/history/future", async () => {
  const e = cloud();
  const blob = await encodeProjectFileLocally({
    project: project(e),
    history: [{ label: "before", entities: [e] }],
    future: [{ label: "after", entities: [e] }],
  });
  const head = new DataView(await blob.slice(0, 16).arrayBuffer());
  const manifest = JSON.parse(
    await blob.slice(16, 16 + head.getUint32(8, true)).text(),
  );
  expect(manifest.version).toBe(4);
  expect(manifest.records[0].pointColors).toEqual({
    chunk: expect.any(Number),
    type: "u8",
  });
  const result = await decodeProjectContents(blob);
  for (const item of [
    result.project.entities[0],
    result.history[0].entities[0],
    result.future[0].entities[0],
  ]) {
    expect((item as typeof e).pointColors).toEqual(e.pointColors);
    expect((item as typeof e).ascAttributes).toBe("xyz-rgb");
  }
});
it("hashes exact byte colors without mutation", async () => {
  const e = cloud();
  const before = e.pointColors.slice();
  const result = await digestEntityGeometry(e);
  expect(result.buffers.find((b) => b.path === "pointColors")).toMatchObject({
    encoding: "u8",
    rawBytes: 8,
    elements: 8,
    sha256: createHash("sha256").update(before).digest("hex"),
  });
  expect(e.pointColors).toEqual(before);
});
it("keeps uncolored legacy project files readable", async () => {
  const { pointColors: _colors, ascAttributes: _format, ...e } = cloud();
  const result = await decodeProjectContents(
    await encodeProjectFileLocally({
      project: project(e),
      history: [],
      future: [],
    }),
  );
  expect(result.project.entities[0]).not.toHaveProperty(
    "pointColors",
    expect.anything(),
  );
  expect(JSON.parse(serializeProject("legacy", [e])).version).toBe(1);
});
it("preserves explicit normal interpretation without inventing colors", async () => {
  const { pointColors: _colors, ...e } = cloud();
  const normalCloud: Entity = { ...e, ascAttributes: "xyz-normal" };
  const decoded = await decodeProjectContents(
    await encodeProjectFileLocally({
      project: project(normalCloud),
      history: [],
      future: [],
    }),
  );
  expect(decoded.project.entities[0].ascAttributes).toBe("xyz-normal");
  expect(decoded.project.entities[0].pointColors).toBeUndefined();
});
it("rejects new binary attributes disguised as an older container capability", async () => {
  const blob = await encodeProjectFileLocally({
    project: project(cloud()),
    history: [],
    future: [],
  });
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const view = new DataView(head.buffer),
    length = view.getUint32(8, true);
  const manifest = JSON.parse(await blob.slice(16, 16 + length).text());
  manifest.version = 3;
  const body = new TextEncoder().encode(JSON.stringify(manifest));
  view.setUint32(8, body.length, true);
  await expect(
    decodeProjectContents(new Blob([head, body, blob.slice(16 + length)])),
  ).rejects.toThrow();
});
it("rejects nonopaque colors at the digest boundary", async () => {
  const e = cloud();
  e.pointColors[3] = 0;
  await expect(digestEntityGeometry(e)).rejects.toThrow(/opaque/);
});
it("retains typed subarray and shared color backing metadata", async () => {
  const e = cloud(),
    backing = new SharedArrayBuffer(16);
  e.pointColors = new Uint8Array(backing, 4, 8);
  e.pointColors.set([1, 2, 3, 255, 4, 5, 6, 255]);
  const result = await digestEntityGeometry(e);
  expect(result.buffers.find((b) => b.path === "pointColors")).toMatchObject({
    encoding: "u8",
    byteOffset: 4,
    backingBytes: 16,
    shared: true,
  });
});
it("validates colors before either JSON writer or binary writer publishes", async () => {
  const e = cloud();
  e.pointColors[7] = 254;
  expect(() => serializeProject("bad", [e])).toThrow();
  await expect(serializeProjectBlob("bad", [e])).rejects.toThrow();
  await expect(
    encodeProjectFileLocally({ project: project(e), history: [], future: [] }),
  ).rejects.toThrow();
});
