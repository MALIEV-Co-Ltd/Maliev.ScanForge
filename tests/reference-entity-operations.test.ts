import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../src/types";
import * as references from "../src/reference-entity";
import { decodeReferenceGeometry } from "../src/reference-construction-values";
import { decodeReferenceConstruction } from "../src/reference-construction";
import { scanMeshCopy } from "../src/scan-mesh-copy";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type CommandContext,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import { processMesh } from "../src/processing-client";
import type { CadClient } from "../src/cad/client";

vi.mock("../src/processing-client", () => ({
  processMesh: vi.fn(async () => ({})),
}));
afterEach(() => vi.clearAllMocks());
const sourceKey = "01".repeat(16);
function reference(kind: "point" | "line"): Entity {
  return {
    id: "reference",
    name: "Reference",
    kind: kind === "point" ? "referencePoint" : "referenceLine",
    color: "#ffffff",
    visible: true,
    opacity: 1,
    positions: [],
    constructionOrderKey: "02".repeat(16),
    reference: {
      version: 1,
      definition:
        kind === "point"
          ? {
              version: 1,
              kind,
              mode: "coordinates",
              position: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
              sources: [{ id: "source", constructionOrderKey: sourceKey }],
            }
          : {
              version: 1,
              kind,
              mode: "average",
              sources: [{ id: "source", constructionOrderKey: sourceKey }],
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
      geometry:
        kind === "point"
          ? { kind, position: [-0, 1 + 2 ** -40, Number.MIN_VALUE] }
          : { kind, start: [10, 2, -0], direction: [-2, 3, -0], length: 4 },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function source(): Entity {
  return {
    id: "source",
    name: "Source",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    color: "#ffffff",
    visible: true,
    opacity: 1,
    constructionOrderKey: sourceKey,
  };
}
function harness(entity = reference("point"), others = [source()]) {
  const state: WorkspaceSnapshot = {
    name: "References",
    entities: [entity, ...others],
    history: [],
    future: [],
    authoring: {},
    selectedId: entity.id,
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  const context: CommandContext = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
    artifact: vi.fn((_data, name, mime) => ({
      artifactId: "artifact",
      name,
      mime,
      bytes: 1,
    })),
    artifactBlob: vi.fn(),
  };
  const ops = { ...createOperations(host), ...createAuthoringOperations(host) };
  return { state, host, context, ops, api: new ApplicationApi(host, ops) };
}

describe("precise reference bounds", () => {
  it("retains point precision and returns detached bounds", () => {
    const entity = reference("point"),
      bounds = references.referenceEntityBounds(entity)!;
    expect(bounds).toEqual({
      min: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
      max: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
    });
    expect(bounds.min).not.toBe(bounds.max);
    expect(references.referenceEntityBounds(source())).toBeUndefined();
  });
  it("uses raw direction and finite extent for reversed, zero and degenerate lines", () => {
    const entity = reference("line");
    expect(references.referenceEntityBounds(entity)).toEqual({
      min: [2, 2, -0],
      max: [10, 14, -0],
    });
    entity.reference!.geometry = {
      kind: "line",
      start: [4, 5, 6],
      direction: [0, 0, 0],
      length: 7,
    };
    expect(references.referenceEntityBounds(entity)).toEqual({
      min: [4, 5, 6],
      max: [4, 5, 6],
    });
    entity.reference!.geometry = {
      kind: "line",
      start: [4, 5, 6],
      direction: [10, -30, 40],
      length: 0,
    };
    expect(references.referenceEntityBounds(entity)).toEqual({
      min: [4, 5, 6],
      max: [4, 5, 6],
    });
  });
  it("rejects malformed semantic geometry rather than reporting an empty box", () => {
    const entity = reference("line");
    entity.reference!.geometry = {
      kind: "line",
      start: [0, 0, 0],
      direction: [Number.MAX_VALUE, 0, 0],
      length: 2,
    };
    expect(() => references.referenceEntityBounds(entity)).toThrow(/overflow/i);
  });
});

describe.each(["point", "line"] as const)(
  "reference %s inspection and eligibility",
  (kind) => {
    it("exposes semantic counts, exact values and source identity state through MCP", async () => {
      const entity = reference(kind),
        h = harness(entity);
      try {
        const revision = h.api.currentRevision();
        const reply = await h.api.invoke("object_get", { entityId: entity.id });
        if (!reply.ok) throw new Error(reply.error.message);
        const result = reply.result as any;
        expect(result).toMatchObject({
          points: kind === "point" ? 1 : 0,
          lines: kind === "line" ? 1 : 0,
          triangles: 0,
          bounds: references.referenceEntityBounds(entity),
        });
        expect(result.reference.geometry).toEqual(entity.reference!.geometry);
        expect(
          decodeReferenceGeometry(
            JSON.parse(JSON.stringify(result.reference.geometryEncoding)),
          ),
        ).toEqual(entity.reference!.geometry);
        expect(
          decodeReferenceConstruction(
            JSON.parse(JSON.stringify(result.reference.definitionEncoding)),
          ),
        ).toEqual(entity.reference!.definition);
        expect(result.reference.evaluation).toEqual({
          status: "stored",
          outcome: null,
        });
        expect(result.reference).not.toHaveProperty(
          "evaluation.completionWord",
        );
        expect(result.reference.sourceBindings).toEqual([
          {
            id: "source",
            constructionOrderKey: sourceKey,
            status: "identity-matched",
          },
        ]);
        if (kind === "line")
          expect(result.reference.recordBindings).toEqual([
            { recordIndex: 0, entityId: "source", objectPresent: true },
            { recordIndex: 1, entityId: "source", objectPresent: true },
          ]);
        const project = await h.api.invoke("project_get", {});
        expect(project).toMatchObject({
          ok: true,
          result: { objects: [result, expect.anything()] },
        });
        expect(h.api.currentRevision()).toBe(revision);
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        h.api.dispose();
      }
    });

    it("exports semantic geometry instead of empty positions", async () => {
      const entity = reference(kind),
        h = harness(entity);
      try {
        const reply = await h.api.invoke("object_get", {
          entityId: entity.id,
          includeGeometry: true,
        });
        if (!reply.ok) throw new Error(reply.error.message);
        const artifactId = (
          reply.result as { geometry: { artifactId: string } }
        ).geometry.artifactId;
        const artifact = await h.api.invoke("artifact_read", { artifactId });
        if (!artifact.ok) throw new Error(artifact.error.message);
        const text = Buffer.from(
          (artifact.result as { base64: string }).base64,
          "base64",
        ).toString("utf8");
        const geometry = JSON.parse(text);
        expect(geometry).not.toHaveProperty("positions");
        expect(geometry.units).toBe("mm");
        expect(decodeReferenceGeometry(geometry.encoding)).toEqual(
          entity.reference!.geometry,
        );
        expect(geometry.semantic.kind).toBe(kind);
      } finally {
        h.api.dispose();
      }
    });

    it("reports topology ineligibility through the MCP job protocol before starting a worker", async () => {
      const h = harness(reference(kind));
      try {
        const revision = h.api.currentRevision();
        const started = await h.api.invoke("mesh_analyze", {
          entityId: "reference",
        });
        if (!started.ok) throw new Error(started.error.message);
        const jobId = (started.result as { jobId: string }).jobId;
        await vi.waitFor(async () => {
          expect(await h.api.invoke("job_get", { jobId })).toMatchObject({
            ok: true,
            result: {
              status: "failed",
              error: {
                message: expect.stringMatching(/reference.*sampled.*geometry/i),
              },
            },
          });
        });
        expect(processMesh).not.toHaveBeenCalled();
        expect(h.api.currentRevision()).toBe(revision);
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        h.api.dispose();
      }
    });

    const cases: [string, Record<string, unknown>][] = [
      ["mesh_copy", {}],
      ["mesh_analyze", {}],
      ["mesh_process", { operation: { kind: "report" } }],
      [
        "mesh_process",
        { operation: { kind: "scanEdit", action: "inventory" } },
      ],
      ["mesh_process", { operation: { kind: "smooth", iterations: 1 } }],
      ["analysis_fit", { kind: "plane" }],
      ["analysis_section", { axis: "x", offset: 0 }],
      [
        "analysis_deviation",
        { fit: { kind: "plane", center: [0, 0, 0], axis: [0, 0, 1] } },
      ],
      ["selection_get", {}],
      ["selection_set", { triangles: [] }],
      ["selection_modify", { operation: "all" }],
      ["selection_saved", { action: "save", name: "Saved" }],
    ];
    it.each(cases)(
      "%s refuses semantic references without dispatch or mutation",
      async (command, args) => {
        const h = harness(reference(kind));
        try {
          await expect(
            Promise.resolve().then(() =>
              h.ops[command]({ entityId: "reference", ...args }, h.context),
            ),
          ).rejects.toThrow(/reference.*sampled.*geometry/i);
          expect(processMesh).not.toHaveBeenCalled();
          expect(h.host.commit).not.toHaveBeenCalled();
          expect(h.host.setSelection).not.toHaveBeenCalled();
          expect(h.context.artifact).not.toHaveBeenCalled();
        } finally {
          h.api.dispose();
        }
      },
    );
    it("shared GUI mesh-copy helper rejects even supplied substitute triangles", () => {
      expect(() =>
        scanMeshCopy(reference(kind), "copy", source().positions),
      ).toThrow(/reference.*sampled.*geometry/i);
    });
    it.each([
      { kind: "icp" },
      { kind: "global" },
      { kind: "scanTools", operation: { kind: "averageMesh" } },
    ])("refuses a semantic secondary target for $kind", async (operation) => {
      const h = harness(reference(kind));
      try {
        await expect(
          Promise.resolve().then(() =>
            h.ops.mesh_process(
              {
                entityId: "source",
                targetId: "reference",
                operation,
              },
              h.context,
            ),
          ),
        ).rejects.toThrow(/reference.*sampled.*geometry/i);
        expect(processMesh).not.toHaveBeenCalled();
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        h.api.dispose();
      }
    });
  },
);

it.each(["missing-object", "unassigned-key", "identity-mismatch"])(
  "reports %s without resolving or rewriting the source",
  async (status) => {
    const row = source();
    if (status === "unassigned-key") delete row.constructionOrderKey;
    if (status === "identity-mismatch")
      row.constructionOrderKey = "03".repeat(16);
    const h = harness(
      reference("line"),
      status === "missing-object" ? [] : [row],
    );
    try {
      const result = await h.api.invoke("object_get", {
        entityId: "reference",
      });
      expect(result).toMatchObject({
        ok: true,
        result: {
          reference: {
            sourceBindings: [{ status }],
            recordBindings: [
              { objectPresent: status !== "missing-object" },
              { objectPresent: status !== "missing-object" },
            ],
          },
        },
      });
      expect(h.host.commit).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  },
);
