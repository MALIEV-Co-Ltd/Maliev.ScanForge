import { expect, it } from "vitest";
import {
  copyReferenceFrame,
  encodeReferenceFrame,
  decodeReferenceFrame,
  validateReferenceFrameEntity,
  referenceFrameBounds,
  referenceFrameSummary,
  inspectReferenceFrame,
  type CoordinateFrameData,
  createReferenceFrameEntity,
} from "../src/reference-frame";
import {
  assertSampledGeometry,
  supportsSampledGeometry,
  assertReferenceWorkspaceAdmission,
} from "../src/reference-entity";
import { entityDisplayStats } from "../src/entity-display-stats";
import type { Entity, Project } from "../src/types";
import {
  validateProject,
  serializeProject,
  serializeProjectBlob,
  parseProject,
  exportStl,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import { modelChanged, changeLabel, restoreModelDisplay } from "../src/history";
import { digestEntityGeometry } from "../src/geometry-digest";
import { createHash } from "node:crypto";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { bindReferenceConstructionWorkspace } from "../src/automation/reference-construction-binding";

const payload = (): CoordinateFrameData => ({
  version: 1,
  displaySize: 5,
  frame: {
    origin: [-0, 2 ** -40, 3],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, -0, 1],
  },
});
const frameEntity = (): Entity => ({
  id: "coordinate-frame",
  name: "Assembly coordinates",
  kind: "referenceFrame",
  positions: [],
  coordinateFrame: payload(),
  color: "#60b6ad",
  opacity: 1,
  visible: true,
});
const project = (entities = [frameEntity()]): Project => ({
  format: "maliev-scanforge",
  version: 1,
  name: "Coordinate systems",
  units: "mm",
  entities,
  authoring: {
    inspections: [
      {
        id: "measurement",
        name: "Keep inspection",
        definition: {
          kind: "measurement",
          measurement: { first: [0, 0, 0], second: [1, 0, 0] },
        },
      },
    ],
  },
});

it("constructs one detached semantic frame instead of independent line objects", () => {
  const data = payload(),
    created = createReferenceFrameEntity(
      data.frame,
      data.displaySize,
      "created",
      "Assembly frame",
    );
  expect(created).toMatchObject({
    id: "created",
    name: "Assembly frame",
    kind: "referenceFrame",
    positions: [],
    coordinateFrame: data,
  });
  data.frame.origin[1] = 99;
  expect(created.coordinateFrame!.frame.origin[1]).toBe(2 ** -40);
  expect(() => validateProject(project([created]))).not.toThrow();
});

it("copies and bit-encodes one authoritative rigid frame without Float32 narrowing", () => {
  const source = payload(),
    copied = copyReferenceFrame(source);
  expect(copied).toEqual(source);
  expect(copied.frame).not.toBe(source.frame);
  source.frame.origin[1] = 99;
  expect(copied.frame.origin[1]).toBe(2 ** -40);
  const restored = decodeReferenceFrame(
    JSON.parse(JSON.stringify(encodeReferenceFrame(copied))),
  );
  expect(restored).toEqual(copied);
  expect(Object.is(restored.frame.origin[0], -0)).toBe(true);
  expect(Object.is(restored.frame.normal[1], -0)).toBe(true);
});
it("uses the three real positive axis endpoints for world bounds and semantic display statistics", () => {
  const entity = frameEntity();
  expect(referenceFrameBounds(entity)).toEqual({
    min: [-5, 2 ** -40, 3],
    max: [-0, 5 + 2 ** -40, 8],
  });
  expect(referenceFrameSummary(entity)).toMatchObject({
    points: 1,
    lines: 3,
    triangles: 0,
  });
  expect(entityDisplayStats(entity)).toMatchObject({
    kind: "reference",
    points: 1,
    lines: 3,
    triangles: 0,
    min: [-5, 2 ** -40, 3],
    max: [-0, 5 + 2 ** -40, 8],
  });
  expect(inspectReferenceFrame(entity)).toMatchObject({
    coordinateFrame: payload(),
    coordinateFrameEncoding: encodeReferenceFrame(payload()),
  });
});
it.each([
  (value: any) => {
    value.version = 2;
  },
  (value: any) => {
    value.frame.u = [2, 0, 0];
  },
  (value: any) => {
    value.frame.normal = [0, 0, -1];
  },
  (value: any) => {
    value.frame.origin[0] = Infinity;
  },
  (value: any) => {
    delete value.frame.u[1];
  },
  (value: any) => {
    value.frame.unexpected = true;
  },
  (value: any) => {
    value.unexpected = true;
  },
  (value: any) => {
    value.displaySize = 0;
  },
  (value: any) => {
    value.displaySize = -0;
  },
  (value: any) => {
    value.displaySize = 2e9 + 1;
  },
  (value: any) => {
    value.frame.origin[2] = 1e9;
  },
])("rejects malformed frame geometry or world/display limits %#", (corrupt) => {
  const value = payload();
  corrupt(value);
  expect(() => copyReferenceFrame(value)).toThrow();
});
it("admits display-size equality only when every axis endpoint remains in world bounds", () => {
  const value: CoordinateFrameData = {
    version: 1,
    frame: {
      origin: [-1e9, -1e9, -1e9],
      u: [1, 0, 0],
      v: [0, 1, 0],
      normal: [0, 0, 1],
    },
    displaySize: 2e9,
  };
  expect(copyReferenceFrame(value)).toEqual(value);
  expect(() =>
    copyReferenceFrame({
      ...value,
      frame: { ...value.frame, origin: [0, 0, 0] },
    }),
  ).toThrow();
});
it("rejects accessor/prototype payloads and malformed exact wire fields", () => {
  expect(() =>
    copyReferenceFrame(
      Object.assign(Object.create({ inherited: true }), payload()),
    ),
  ).toThrow();
  const value = payload();
  Object.defineProperty(value.frame, "u", {
    get() {
      throw Error("Getter must not run");
    },
    enumerable: true,
  });
  expect(() => copyReferenceFrame(value)).toThrow(/field|frame|object/i);
  const encoded = encodeReferenceFrame(payload());
  for (const invalid of [
    { ...encoded, extra: true },
    { ...encoded, frameBits: "00" },
    { ...encoded, displaySize: -1 },
    { ...encoded, frameBits: "000000000000f07f".repeat(12) },
  ])
    expect(() => decodeReferenceFrame(invalid)).toThrow();
});
it("keeps frame entities out of sampled geometry and validates incompatible metadata before codecs normalize it", () => {
  const entity = frameEntity();
  expect(supportsSampledGeometry(entity)).toBe(false);
  expect(() => assertSampledGeometry(entity)).toThrow();
  expect(validateReferenceFrameEntity(entity)).toEqual(payload());
  expect(() =>
    validateReferenceFrameEntity({ ...entity, positions: [0, 0, 0] }),
  ).toThrow();
  expect(() =>
    validateReferenceFrameEntity({ ...entity, kind: "mesh" }),
  ).toThrow();
  for (const field of [
    "normals",
    "fit",
    "kernelId",
    "brep",
    "parametric",
    "reference",
    "planeFrame",
    "indexedMesh",
    "surfacePatch",
    "meshSelection",
    "pointColors",
    "authoringLinks",
  ]) {
    for (const value of [null, false, 0, []])
      expect(() =>
        validateReferenceFrameEntity({ ...entity, [field]: value } as any),
      ).toThrow();
  }
  expect(exportStl([entity]).getUint32(80, true)).toBe(0);
});
it("persists exact frame metadata through both JSON writers without losing saved inspections", async () => {
  const source = project();
  for (const text of [
    serializeProject(source.name, source.entities, source.authoring),
    await (
      await serializeProjectBlob(source.name, source.entities, source.authoring)
    ).text(),
  ]) {
    const wire = JSON.parse(text);
    expect(wire.version).toBe(3);
    expect(wire.entities[0].coordinateFrame.frameBits).toHaveLength(192);
    const restored = parseProject(text);
    expect(restored.entities[0].coordinateFrame).toEqual(payload());
    expect(
      Object.is(restored.entities[0].coordinateFrame!.frame.origin[0], -0),
    ).toBe(true);
    expect(restored.authoring?.inspections).toEqual(
      source.authoring?.inspections,
    );
  }
  const detached = validateProject(source);
  source.entities[0].coordinateFrame!.frame.u[0] = 5;
  expect(detached.entities[0].coordinateFrame!.frame.u).toEqual([0, 1, 0]);
});
it("preserves exact current/history/future coordinate frames in binary projects and shared admission", async () => {
  const source = frameEntity(),
    old = frameEntity(),
    next = frameEntity();
  old.coordinateFrame!.frame.origin[1] = 2 ** -41;
  next.coordinateFrame!.frame.origin[1] = 2 ** -39;
  const session: ProjectSession = {
    project: project([source]),
    history: [{ entities: [old], label: "Before" }],
    future: [{ entities: [next], label: "After" }],
  };
  const blob = await encodeProjectFileLocally(session);
  const restored = await decodeProjectContents(blob);
  expect(() => assertReferenceWorkspaceAdmission(restored)).not.toThrow();
  expect(restored.project.entities[0].coordinateFrame).toEqual(
    source.coordinateFrame,
  );
  expect(restored.history[0].entities[0].coordinateFrame).toEqual(
    old.coordinateFrame,
  );
  expect(restored.future[0].entities[0].coordinateFrame).toEqual(
    next.coordinateFrame,
  );
  expect(restored.project.authoring?.inspections).toEqual(
    session.project.authoring?.inspections,
  );
  for (const entities of [
    restored.project.entities,
    restored.history[0].entities,
    restored.future[0].entities,
  ])
    expect(Object.is(entities[0].coordinateFrame!.frame.origin[0], -0)).toBe(
      true,
    );
});
it("rejects incompatible payloads in every writer and malformed retained binary metadata", async () => {
  const invalid = { ...frameEntity(), normals: false } as any;
  expect(() => serializeProject("Invalid", [invalid])).toThrow();
  await expect(serializeProjectBlob("Invalid", [invalid])).rejects.toThrow();
  await expect(
    encodeProjectFileLocally({
      project: project(),
      history: [{ label: "Invalid", entities: [invalid] }],
      future: [],
    }),
  ).rejects.toThrow();
  const blob = await encodeProjectFileLocally({
    project: project(),
    history: [],
    future: [],
  });
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer()),
    view = new DataView(header.buffer),
    length = view.getUint32(8, true);
  const manifest = JSON.parse(await blob.slice(16, 16 + length).text());
  manifest.records[0].normals = false;
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  view.setUint32(8, encoded.length, true);
  await expect(
    decodeProjectContents(new Blob([header, encoded, blob.slice(16 + length)])),
  ).rejects.toThrow();
});
it.each(["frame", "displaySize"] as const)(
  "records a %s-only edit while retaining display controls during Undo",
  (field) => {
    const old = frameEntity(),
      changed = {
        ...old,
        coordinateFrame: copyReferenceFrame(old.coordinateFrame),
      };
    if (field === "frame") changed.coordinateFrame.frame.origin[2] += 1;
    else changed.coordinateFrame.displaySize += 1;
    expect(changed.positions).toBe(old.positions);
    expect(modelChanged([old], [changed])).toBe(true);
    expect(changeLabel([old], [changed])).toBe("Modify Assembly coordinates");
    const restored = restoreModelDisplay(
      [old],
      [{ ...changed, color: "#123456", visible: false }],
    );
    expect(restored[0].coordinateFrame).toEqual(old.coordinateFrame);
    expect(restored[0].color).toBe("#123456");
    expect(restored[0].visible).toBe(false);
  },
);
it("hashes authoritative frame and display-size binary64 values rather than empty positions", async () => {
  const entity = frameEntity(),
    digest = await digestEntityGeometry(entity);
  expect(digest.buffers.map((entry) => [entry.path, entry.encoding])).toEqual([
    ["coordinateFrame.frame.origin", "f64"],
    ["coordinateFrame.frame.u", "f64"],
    ["coordinateFrame.frame.v", "f64"],
    ["coordinateFrame.frame.normal", "f64"],
    ["coordinateFrame.displaySize", "f64"],
  ]);
  const bytes = Buffer.alloc(24);
  entity.coordinateFrame!.frame.origin.forEach((value, index) =>
    bytes.writeDoubleLE(value, index * 8),
  );
  expect(digest.buffers[0].sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const changed = {
    ...entity,
    coordinateFrame: { ...entity.coordinateFrame!, displaySize: 6 },
  };
  expect((await digestEntityGeometry(changed)).buffers[4].sha256).not.toBe(
    digest.buffers[4].sha256,
  );
});
it.each(["origin", "axis", "size", "signed-zero"] as const)(
  "invalidates API revision and cached construction binding on in-place %s changes",
  (field) => {
    const entity = frameEntity();
    const state: WorkspaceSnapshot = {
      name: "Frames",
      entities: [entity],
      history: [],
      future: [],
      authoring: {},
      selectedId: null,
      selection: null,
      settings: {},
    };
    const host = { snapshot: () => state } as unknown as WorkspaceHost;
    const api = new ApplicationApi(host, {}),
      revision = api.currentRevision(),
      binding = bindReferenceConstructionWorkspace(host);
    try {
      if (field === "origin") entity.coordinateFrame!.frame.origin[2] += 1;
      else if (field === "axis") {
        entity.coordinateFrame!.frame.u = [1, 0, 0];
        entity.coordinateFrame!.frame.v = [0, 1, 0];
      } else if (field === "size") entity.coordinateFrame!.displaySize += 1;
      else entity.coordinateFrame!.frame.origin[0] = 0;
      expect(api.currentRevision()).toBeGreaterThan(revision);
      expect(binding.currentToken()).not.toBe(binding.token);
    } finally {
      binding.dispose();
      api.dispose();
    }
  },
);
