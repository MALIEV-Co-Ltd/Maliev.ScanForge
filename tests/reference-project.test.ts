import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity, Project } from "../src/types";
import {
  copyReferenceEntityData,
  encodeReferenceEntityData,
  decodeReferenceEntityData,
  validateReferenceEntity,
  assertReferenceWorkspaceAdmission,
} from "../src/reference-entity";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validateProject,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import { decodeProjectFile } from "../src/project-file";
import {
  modelChanged,
  restoreModelDisplay,
  seekModelRevision,
} from "../src/history";
import { duplicateObject } from "../src/object-operations";
import { digestEntityGeometry } from "../src/geometry-digest";
import {
  projectEncodingSnapshot,
  restoreEncodingSnapshot,
} from "../src/project-encoding-snapshot";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import { placedCloud } from "../src/point-cloud-placement";
import { listBackups } from "../src/project-backup";

vi.mock("../src/project-backup", async (original) => ({
  ...(await original<typeof import("../src/project-backup")>()),
  listBackups: vi.fn(),
}));

const key = "01".repeat(16);
const numericCommonSourceError =
  "Stored coordinate references cannot retain common-source dependencies.";
const mesh = (): Entity => ({
  id: "source",
  name: "Source",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  opacity: 1,
  color: "#ffffff",
  constructionOrderKey: key,
});
const point = (): Entity => ({
  id: "point\ud800",
  name: "Point",
  kind: "referencePoint",
  positions: [],
  visible: true,
  opacity: 1,
  color: "#abcdef",
  constructionOrderKey: "02".repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
      sources: [{ id: "source", constructionOrderKey: key }],
    },
    geometry: { kind: "point", position: [-0, 4, Number.MIN_VALUE] },
    evaluation: { completionWord: 0x324 },
  },
});
const line = (): Entity => ({
  ...point(),
  id: "line",
  kind: "referenceLine",
  constructionOrderKey: "03".repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "line",
      mode: "average",
      sources: [{ id: "source", constructionOrderKey: key }],
      records: [
        {
          entityId: "source",
          storage: "native-pick-record-f32",
          coordinates: [-0, 2 ** -149, 3],
        },
        {
          entityId: "source",
          storage: "native-pick-record-f32",
          coordinates: [1, 2, 3],
        },
      ],
    },
    geometry: {
      kind: "line",
      start: [-0, 1, 2],
      direction: [2, -0, 0],
      length: 4,
    },
    evaluation: { completionWord: 0x100 },
  },
});
const project = (entities = [mesh(), point(), line()]): Project => ({
  format: "maliev-scanforge",
  version: 1,
  name: "References",
  units: "mm",
  entities,
});
const session = (): ProjectSession => ({
  project: project(),
  history: [{ label: "Before", entities: [mesh(), point()] }],
  future: [{ label: "After", entities: [mesh(), line()] }],
});
afterEach(() => vi.unstubAllGlobals());

describe("semantic reference entity storage", () => {
  it.each([point, line])(
    "detaches and bit-preserves semantic payload %#",
    (create) => {
      const source = create().reference!;
      const copied = copyReferenceEntityData(source);
      expect(copied).toEqual(source);
      expect(copied.definition).not.toBe(source.definition);
      expect(copied.geometry).not.toBe(source.geometry);
      expect(copied.evaluation).not.toBe(source.evaluation);
      expect(
        decodeReferenceEntityData(
          JSON.parse(JSON.stringify(encodeReferenceEntityData(source))),
        ),
      ).toEqual(source);
    },
  );

  it.each(["kind", "positions", "reference", "definition", "geometry", "key"])(
    "rejects contradictory reference %s",
    (field) => {
      const e = point();
      if (field === "kind") e.kind = "mesh";
      if (field === "positions") e.positions = [0, 0, 0];
      if (field === "reference") e.reference = undefined;
      if (field === "definition")
        e.reference!.definition = line().reference!.definition;
      if (field === "geometry")
        e.reference!.geometry = line().reference!.geometry;
      if (field === "key") e.constructionOrderKey = undefined;
      expect(() => validateReferenceEntity(e)).toThrow(
        /reference|construction/i,
      );
    },
  );

  it.each([
    "indexedMesh",
    "normals",
    "pointColors",
    "meshSelection",
    "pointCloudPlacement",
    "brep",
    "kernelId",
    "fit",
    "planeFrame",
    "surfacePatch",
    "surfaceScanId",
    "parametric",
    "authoringLinks",
    "scanSource",
    "edgePositions",
    "ascAttributes",
  ])("rejects incompatible %s metadata", (field) => {
    expect(() =>
      validateProject(project([{ ...point(), [field]: {} }])),
    ).toThrow();
  });

  it.each(["string", "blob", "binary"])(
    "%s serialization rejects reference topology before normalization",
    async (format) => {
      const entities = [
        {
          ...point(),
          indexedMesh: {
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            triangles: new Uint32Array([0, 1, 2]),
          },
        },
      ];
      const write = async () => {
        if (format === "string") return serializeProject("Invalid", entities);
        if (format === "blob") return serializeProjectBlob("Invalid", entities);
        return encodeProjectFileLocally({
          project: project(entities),
          history: [],
          future: [],
        });
      };
      await expect(write()).rejects.toThrow(
        /reference.*compatible semantic metadata/i,
      );
    },
  );

  describe.each([
    "indexedMesh",
    "normals",
    "edgePositions",
    "brep",
    "meshSelection",
  ])("binary reference metadata %s", (field) => {
    it.each([null, false, 0])(
      "rejects forbidden falsy value %s before decoding",
      async (value) => {
        const file = await encodeProjectFileLocally(session());
        const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const view = new DataView(header.buffer),
          length = view.getUint32(8, true);
        const manifest = JSON.parse(await file.slice(16, 16 + length).text());
        manifest.records.find((e: Entity) => e.kind === "referencePoint")[
          field
        ] = value;
        const encoded = new TextEncoder().encode(JSON.stringify(manifest));
        view.setUint32(8, encoded.length, true);
        await expect(
          decodeProjectContents(
            new Blob([header, encoded, file.slice(16 + length)]),
          ),
        ).rejects.toThrow(/reference.*compatible semantic metadata/i);
      },
    );
  });

  it.each([-1, 65536, 0.5, NaN])(
    "rejects invalid completion %s",
    (completionWord) => {
      const e = point();
      e.reference!.evaluation.completionWord = completionWord;
      expect(() => copyReferenceEntityData(e.reference)).toThrow();
    },
  );

  it("rejects unknown payload fields and malformed bit encodings", () => {
    expect(() =>
      copyReferenceEntityData({ ...point().reference, extra: 1 }),
    ).toThrow();
    const encoded = encodeReferenceEntityData(point().reference!);
    expect(() =>
      decodeReferenceEntityData({
        ...encoded,
        geometry: { ...encoded.geometry, bits: "00" },
      }),
    ).toThrow();
    expect(() =>
      decodeReferenceEntityData({
        ...encoded,
        evaluation: { completionWord: 0, extra: 1 },
      }),
    ).toThrow();
  });

  it.each(["invalid", "collision"])(
    "rejects %s saved construction keys",
    (kind) => {
      const a = mesh(),
        b = { ...mesh(), id: "b" };
      if (kind === "invalid") b.constructionOrderKey = "ABC";
      expect(() => validateProject(project([a, b]))).toThrow(
        /construction|key/i,
      );
    },
  );

  it.each(["string", "blob"])(
    "round trips actual %s JSON with a distinct wire version",
    async (format) => {
      const p = project();
      const text =
        format === "string"
          ? serializeProject(p.name, p.entities)
          : await (await serializeProjectBlob(p.name, p.entities)).text();
      const raw = JSON.parse(text);
      expect(raw.version).toBe(3);
      expect(raw.entities[1].reference.geometry.bits).toBeTypeOf("string");
      const decoded = parseProject(text);
      expect(decoded.entities.map((e) => e.reference)).toEqual(
        p.entities.map((e) => e.reference),
      );
      expect(decoded.entities.map((e) => e.constructionOrderKey)).toEqual(
        p.entities.map((e) => e.constructionOrderKey),
      );
    },
  );

  it("rejects reference metadata tagged as a legacy JSON version", () => {
    const raw = JSON.parse(serializeProject("References", project().entities));
    raw.version = 1;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(
      /version|construction|reference/i,
    );
  });

  it("round trips binary current, history and future with state-local keys", async () => {
    const source = session(),
      file = await encodeProjectFileLocally(source);
    const header = new DataView(await file.slice(0, 16).arrayBuffer());
    const raw = JSON.parse(
      await file.slice(16, 16 + header.getUint32(8, true)).text(),
    );
    expect(raw.version).toBe(5);
    expect(
      raw.records.find((e: Entity) => e.kind === "referencePoint").reference
        .geometry.bits,
    ).toBeTypeOf("string");
    const decoded = await decodeProjectContents(file);
    expect(decoded.project.entities.map((e) => e.reference)).toEqual(
      source.project.entities.map((e) => e.reference),
    );
    expect(decoded.history[0].entities[1].reference).toEqual(
      source.history[0].entities[1].reference,
    );
    expect(decoded.future[0].entities[1].reference).toEqual(
      source.future[0].entities[1].reference,
    );
    expect(decoded.project.entities[1].reference).not.toBe(
      decoded.history[0].entities[1].reference,
    );
    const undo = seekModelRevision(
      decoded.history,
      decoded.project.entities,
      decoded.future,
      0,
    );
    expect(undo.entities[1].reference).toEqual(
      source.history[0].entities[1].reference,
    );
  });

  it("preserves semantic metadata through worker snapshot and transport", async () => {
    const source = session();
    const { packet, transfers } = await packProjectTransport(
      projectEncodingSnapshot(source),
    );
    const cloned = structuredClone(packet, { transfer: transfers });
    const snapshot =
      await unpackProjectTransport<ReturnType<typeof projectEncodingSnapshot>>(
        cloned,
      );
    expect(restoreEncodingSnapshot(snapshot)).toEqual(source);
  });

  it("counts recipe-only and identity changes as modeling changes while restoring old semantics", () => {
    const before = point(),
      after = {
        ...before,
        reference: copyReferenceEntityData(before.reference!),
      };
    if (
      after.reference.definition.kind !== "point" ||
      after.reference.definition.mode !== "coordinates"
    )
      throw new Error("Expected coordinates");
    after.reference = {
      ...after.reference,
      definition: { ...after.reference.definition, position: [7, 8, 9] },
    };
    expect(modelChanged([before], [after])).toBe(true);
    expect(
      modelChanged(
        [mesh()],
        [{ ...mesh(), constructionOrderKey: "09".repeat(16) }],
      ),
    ).toBe(true);
    const restored = restoreModelDisplay(
      [before],
      [{ ...after, name: "Renamed" }],
    )[0];
    expect(restored.reference).toEqual(before.reference);
    expect(restored.name).toBe("Renamed");
  });

  it("assigns copied ordinary sources a different saved identity through reopen and undo", async () => {
    const source = mesh(),
      copy = duplicateObject(source, "copy", [source]);
    expect(copy.constructionOrderKey).toMatch(/^[0-9a-f]{32}$/);
    expect(copy.constructionOrderKey).not.toBe(source.constructionOrderKey);
    const decoded = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: project([source, copy]),
        history: [{ label: "Duplicate", entities: [source] }],
        future: [],
      }),
    );
    expect(decoded.project.entities[1].constructionOrderKey).toBe(
      copy.constructionOrderKey,
    );
    expect(
      seekModelRevision(
        decoded.history,
        decoded.project.entities,
        [],
        0,
      ).entities.map((e) => e.constructionOrderKey),
    ).toEqual([source.constructionOrderKey]);
  });

  it("digests authoritative Float64 geometry including signed zero", async () => {
    const e = point(),
      changed = point();
    changed.reference!.geometry = {
      kind: "point",
      position: [0, 4, Number.MIN_VALUE],
    };
    const a = await digestEntityGeometry(e),
      b = await digestEntityGeometry(changed);
    expect(
      a.buffers.find((row) => row.path === "reference.geometry.position"),
    ).toMatchObject({ elements: 3, encoding: "f64", rawBytes: 24 });
    expect(
      a.buffers.find((row) => row.path === "reference.geometry.position")!
        .sha256,
    ).not.toBe(
      b.buffers.find((row) => row.path === "reference.geometry.position")!
        .sha256,
    );
    const l = await digestEntityGeometry(line());
    expect(l.buffers.map((row) => row.path)).toEqual([
      "reference.geometry.start",
      "reference.geometry.direction",
      "reference.geometry.length",
    ]);
  });
});

describe("shared reference import admission", () => {
  it("preserves cloud pose and RGBA chunks when construction keys select binary version 5", async () => {
    const cloud = placedCloud(
      {
        ...mesh(),
        kind: "pointcloud",
        positions: [1, 2, 3],
        pointColors: new Uint8Array([10, 20, 30, 255]),
        ascAttributes: "xyz-rgb",
      },
      {
        matrixBits:
          "000000000000f03f0000000000000000000000000000000000000000000008400000000000000000000000000000f03f0000000000000000000000000000104000000000000000000000000000000000000000000000f03f0000000000001440",
        sourcePositions: [1, 2, 3],
      },
    );
    const decoded = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: project([cloud]),
        history: [],
        future: [],
      }),
    );
    expect(decoded.project.entities[0].pointCloudPlacement?.matrixBits).toBe(
      cloud.pointCloudPlacement?.matrixBits,
    );
    expect(decoded.project.entities[0].pointColors).toEqual(cloud.pointColors);
    expect(decoded.project.entities[0].positions).toEqual(cloud.positions);
  });

  it("rejects construction records mislabeled as binary version 4", async () => {
    const file = await encodeProjectFileLocally(session());
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer()),
      view = new DataView(header.buffer),
      length = view.getUint32(8, true);
    const manifest = JSON.parse(await file.slice(16, 16 + length).text());
    manifest.version = 4;
    const encoded = new TextEncoder().encode(JSON.stringify(manifest));
    view.setUint32(8, encoded.length, true);
    await expect(
      decodeProjectContents(
        new Blob([header, encoded, file.slice(16 + length)]),
      ),
    ).rejects.toThrow(/project file/i);
  });

  it.each(["current", "history", "future"])(
    "decoder worker refuses invalid %s numeric common-source links before returning a display packet",
    async (placement) => {
      vi.resetModules();
      const source: ProjectSession = {
        project: project([mesh()]),
        history: [],
        future: [],
      };
      if (placement === "current") source.project.entities.push(point());
      else
        source[placement as "history" | "future"].push({
          label: "Reference",
          entities: [mesh(), point()],
        });
      const scope = {
        onmessage: null as
          null | ((e: MessageEvent<{ file: Blob }>) => Promise<void>),
        postMessage: vi.fn(),
        close: vi.fn(),
      };
      vi.stubGlobal("self", scope);
      await import("../src/project-decoding-worker");
      await scope.onmessage!({
        data: { file: await encodeProjectFileLocally(source) },
      } as MessageEvent<{ file: Blob }>);
      expect(scope.postMessage).toHaveBeenCalledWith({
        error: numericCommonSourceError,
      });
      expect(scope.postMessage).toHaveBeenCalledOnce();
      expect(scope.close).toHaveBeenCalledOnce();
    },
  );

  it("browser-side admission also rejects invalid numeric common-source links in decoded history", async () => {
    const source: ProjectSession = {
      project: project([mesh()]),
      history: [{ label: "Reference", entities: [mesh(), point()] }],
      future: [],
    };
    const transport = await packProjectTransport({
      snapshot: projectEncodingSnapshot(source),
      displays: [],
    });
    class WorkerStub {
      onmessage?: (event: { data: unknown }) => void;
      postMessage() {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { packet: structuredClone(transport.packet) },
          }),
        );
      }
      terminate() {}
    }
    vi.stubGlobal("document", {});
    vi.stubGlobal("Worker", WorkerStub);
    await expect(decodeProjectFile(new Blob())).rejects.toThrow(
      numericCommonSourceError,
    );
  });
  it.each(["current", "history", "future"])(
    "rejects invalid numeric common-source links in %s before publication",
    async (placement) => {
      const source: ProjectSession = {
        project: project([mesh()]),
        history: [],
        future: [],
      };
      if (placement === "current") source.project.entities.push(point());
      else
        source[placement as "history" | "future"].push({
          label: "Reference",
          entities: [mesh(), point()],
        });
      expect(() => assertReferenceWorkspaceAdmission(source)).toThrow(
        numericCommonSourceError,
      );
      await expect(
        decodeProjectFile(await encodeProjectFileLocally(source)),
      ).rejects.toThrow(numericCommonSourceError);
    },
  );

  it("still admits a keyed ordinary project", async () => {
    const source = { project: project([mesh()]), history: [], future: [] };
    expect(
      (await decodeProjectFile(await encodeProjectFileLocally(source))).project
        .entities[0].constructionOrderKey,
    ).toBe(key);
  });
});

describe("MCP parity for reference persistence boundaries", () => {
  function setup() {
    const state: WorkspaceSnapshot = {
      name: "Test",
      entities: [mesh()],
      history: [],
      future: [],
      authoring: {},
      selectedId: null,
      selection: null,
      settings: {},
    };
    let busy = false;
    const host: WorkspaceHost = {
      snapshot: () => ({ ...state }),
      cad: () => ({}) as CadClient,
      commit: (entities, label) => {
        state.history.push({
          label: label ?? "Change",
          entities: state.entities,
        });
        state.entities = entities;
      },
      replace: vi.fn(),
      select: vi.fn(),
      setSelection: vi.fn(),
      setSketch: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      view: vi.fn(),
      settings: vi.fn(),
      busy: () => busy,
      activity: (value) => {
        busy = value;
      },
    };
    const api = new ApplicationApi(host, createOperations(host));
    return { state, host, api };
  }

  it("exposes immutable source identities and renews them through the shared duplicate command", async () => {
    const { api, state } = setup();
    try {
      expect(
        await api.invoke("object_get", { entityId: "source" }),
      ).toMatchObject({ ok: true, result: { constructionOrderKey: key } });
      const revisionBefore = api.currentRevision();
      expect(
        await api.invoke("object_update", {
          entityId: "source",
          patch: { constructionOrderKey: "09".repeat(16) },
          expectedRevision: revisionBefore,
          requestId: "invalid-key-edit",
        }),
      ).toMatchObject({ ok: false });
      expect(api.currentRevision()).toBe(revisionBefore);
      expect(state.entities[0].constructionOrderKey).toBe(key);
      const args = {
        entityId: "source",
        expectedRevision: api.currentRevision(),
        requestId: "duplicate",
      };
      const result = await api.invoke("object_duplicate", args);
      expect(result.ok).toBe(true);
      expect(await api.invoke("object_duplicate", args)).toEqual(result);
      expect(state.entities).toHaveLength(2);
      expect(state.entities[1].constructionOrderKey).not.toBe(key);
      expect(state.history).toHaveLength(1);
      const revision = api.currentRevision();
      state.entities = [
        { ...state.entities[0], constructionOrderKey: "09".repeat(16) },
        state.entities[1],
      ];
      expect(api.currentRevision()).toBe(revision + 1);
    } finally {
      api.dispose();
    }
  });

  it("changes the API revision for a recipe-only semantic update", () => {
    const { api, state } = setup();
    try {
      state.entities = [point()];
      const revision = api.currentRevision(),
        before = state.entities[0];
      const reference = copyReferenceEntityData(before.reference!);
      reference.definition = {
        version: 1,
        kind: "point",
        mode: "coordinates",
        sources: [],
        position: [99, 98, 97],
      };
      state.entities = [{ ...before, reference }];
      expect(api.currentRevision()).toBe(revision + 1);
    } finally {
      api.dispose();
    }
  });

  it.each(
    ["project_import", "backup_restore"].flatMap((command) =>
      ["current", "history", "future"].map((placement) => ({
        command,
        placement,
      })),
    ),
  )(
    "MCP $command rejects invalid $placement numeric common-source links without replacing or committing",
    async ({ command, placement }) => {
      const { api, state, host } = setup();
      try {
        const before = state.entities,
          revision = api.currentRevision();
        const source: ProjectSession = {
          project: project([mesh()]),
          history: [],
          future: [],
        };
        if (placement === "current") source.project.entities.push(point());
        else
          source[placement as "history" | "future"].push({
            label: "Reference",
            entities: [mesh(), point()],
          });
        const file = await encodeProjectFileLocally(source);
        vi.mocked(listBackups).mockResolvedValue([
          {
            id: "references:previous",
            name: "References",
            savedAt: 1,
            file,
          },
        ]);
        const upload = await api.invoke("artifact_put", {
          name: "references.scanforge",
          offset: 0,
          base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        });
        if (!upload.ok) throw new Error(upload.error.message);
        const imported = await api.invoke(command, {
          ...(command === "backup_restore"
            ? { backupId: "references:previous" }
            : {
                artifactId: (upload.result as { artifactId: string })
                  .artifactId,
              }),
          replace: true,
          requestId: "import",
          expectedRevision: api.currentRevision(),
        });
        if (!imported.ok) throw new Error(imported.error.message);
        const jobId = (imported.result as { jobId: string }).jobId;
        await vi.waitFor(async () => {
          expect(await api.invoke("job_get", { jobId })).toMatchObject({
            ok: true,
            result: {
              status: "failed",
              error: {
                message: numericCommonSourceError,
              },
            },
          });
        });
        expect(host.replace).not.toHaveBeenCalled();
        expect(state.entities).toBe(before);
        expect(state.history).toHaveLength(0);
        expect(state.future).toHaveLength(0);
        expect(state.entities).toHaveLength(1);
        expect(api.currentRevision()).toBe(revision);
      } finally {
        api.dispose();
      }
    },
  );
});
