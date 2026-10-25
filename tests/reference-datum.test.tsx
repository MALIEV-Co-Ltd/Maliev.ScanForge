import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { AlignmentReferencePage } from "../src/automation/alignment-operations";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import type { ReferenceGeometry } from "../src/reference-construction-values";
import { DatumReferencePicker } from "../src/ui/DatumReferencePicker";
import { DatumAlignmentTools } from "../src/ui/DatumAlignmentTools";
import native from "./fixtures/alignment-datum-feature-native.json";

function reference(geometry: ReferenceGeometry): Entity {
  return {
    id: "reference",
    name: "Datum source",
    kind: geometry.kind === "point" ? "referencePoint" : "referenceLine",
    positions: [],
    visible: true,
    locked: true,
    color: "#ffffff",
    opacity: 1,
    constructionOrderKey: "01".repeat(16),
    reference: {
      version: 1,
      geometry,
      evaluation: { completionWord: 0x100 },
      definition:
        geometry.kind === "point"
          ? {
              version: 1,
              kind: "point",
              mode: "coordinates",
              position: geometry.position,
              sources: [],
            }
          : {
              version: 1,
              kind: "line",
              mode: "average",
              sources: [],
              records: [],
            },
    },
  };
}
function setup(source: Entity) {
  const scan: Entity = {
    id: "scan",
    name: "Moving scan",
    kind: "mesh",
    positions: new Float32Array([5, 6, 7, 6, 6, 7, 5, 7, 7]),
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    name: "test",
    entities: [scan, source],
    history: [],
    future: [],
    authoring: {},
    selectedId: scan.id,
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: (entities, label) => {
      state.history.push({ entities: state.entities, label });
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
    busy: () => false,
    activity: vi.fn(),
    showDatumPreview: vi.fn(),
    discardPreview: vi.fn(),
    present: async () => {},
    inspectApplication: () => ({ previews: {} }),
  };
  return { state, host, api: new ApplicationApi(host, createOperations(host)) };
}
async function run(
  api: ApplicationApi,
  operation: string,
  args: Record<string, unknown>,
) {
  const response = await api.invoke(operation, args);
  if (!response.ok) throw new Error(response.error.message);
  const jobId = (response.result as { jobId: string }).jobId;
  for (let i = 0; i < 200; i++) {
    const result = await api.invoke("job_get", { jobId });
    if (!result.ok) throw new Error(result.error.message);
    const job = result.result as {
      status: string;
      result: any;
      error?: { message: string };
    };
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Reference datum job did not settle");
}
function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}

describe("semantic datum sources through the shared API", () => {
  it("rejects a stale preview revision, rereads changed semantic geometry and applies retries once", async () => {
    const source = reference({ kind: "point", position: [5, 6, 7] });
    const { api, state } = setup(source);
    try {
      const constraints = [
        {
          kind: "reference",
          entityId: source.id,
          referenceId: "reference/reference/point",
          axis: 0,
        },
      ];
      const revision = api.currentRevision();
      const preview = await run(api, "alignment_preview", {
        entityIds: ["scan"],
        constraints,
        parallel: false,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
      });
      expect(preview.status).toBe("succeeded");
      const changed = reference({ kind: "point", position: [6, 6, 7] });
      state.entities = [state.entities[0], changed];
      const args = {
        entityIds: ["scan"],
        constraints,
        parallel: false,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
      };
      expect(await api.invoke("alignment_apply", args)).toMatchObject({
        ok: false,
        error: { code: "REVISION_CONFLICT" },
      });
      expect(state.history).toHaveLength(0);
      const fresh = {
        ...args,
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      };
      const applied = await run(api, "alignment_apply", fresh);
      expect(applied.status).toBe("succeeded");
      expect(applied.result.matrix).not.toEqual(preview.result.matrix);
      expect(Array.from(state.entities[0].positions).slice(0, 3)).toEqual([
        -1, 0, 0,
      ]);
      expect(state.entities[1]).toBe(changed);
      const retry = await run(api, "alignment_apply", fresh);
      expect(retry.result).toEqual(applied.result);
      expect(state.history).toHaveLength(1);
    } finally {
      api.dispose();
    }
  });
  it.each(native.axes.filter((sample) => sample.mode === 0))(
    "retains historical segment-midpoint bytes: $name",
    async (sample) => {
      const source = reference({
        kind: "line",
        start: [sample.origin[0], sample.origin[1], sample.origin[2]],
        direction: [
          sample.direction[0],
          sample.direction[1],
          sample.direction[2],
        ],
        length: sample.length,
      });
      const { api, state } = setup(source);
      try {
        const before = structuredClone(state),
          revision = api.currentRevision();
        const job = await run(api, "alignment_references", {
          entityId: source.id,
          centerAt: [1, 2, 3],
        });
        expect(job.status).toBe("succeeded");
        expect(job.result).toMatchObject({
          total: 1,
          units: "mm",
          nextOffset: null,
        });
        const value = job.result.references[0];
        expect(value).toMatchObject({
          id: "reference/reference/direction",
          source: "referenceConstruction",
          kind: "direction",
          surfaceKind: "referenceLine",
          length: sample.length,
        });
        expect(bits(value.point)).toBe(sample.nativePointBits);
        expect(bits(value.direction)).toBe(sample.nativeDirectionBits);
        expect(value).not.toHaveProperty("firstTriangle");
        expect(state).toEqual(before);
        expect(api.currentRevision()).toBe(revision);
        value.point[0] = 12345;
        expect(state.entities[1]).toEqual(before.entities[1]);
      } finally {
        api.dispose();
      }
    },
  );

  it("copies precise stored points and supports bounded read pagination without assigning identities", async () => {
    const source = reference({
      kind: "point",
      position: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
    });
    const { api, state } = setup(source);
    try {
      const job = await run(api, "alignment_references", {
        entityId: source.id,
        limit: 1,
      });
      expect(job.status).toBe("succeeded");
      expect(job.result.references).toEqual([
        {
          id: "reference/reference/point",
          source: "referenceConstruction",
          kind: "point",
          surfaceKind: "referencePoint",
          point: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
        },
      ]);
      expect(bits(job.result.references[0].point)).toBe(
        bits([-0, 1 + 2 ** -40, Number.MIN_VALUE]),
      );
      const end = await run(api, "alignment_references", {
        entityId: source.id,
        offset: 1,
        limit: 1,
      });
      expect(end.result).toMatchObject({
        total: 1,
        offset: 1,
        references: [],
        nextOffset: null,
      });
      expect(
        (
          await run(api, "alignment_references", {
            entityId: source.id,
            offset: 2,
          })
        ).status,
      ).toBe("failed");
      expect(state.history).toHaveLength(0);
      expect(state.entities[1]).toBe(source);
    } finally {
      api.dispose();
    }
  });

  it.each([
    { name: "zero", length: 0, point: [10, 2, -0] },
    { name: "negative zero", length: -0, point: [10, 2, 0] },
    { name: "positive extent", length: 4, point: [6, 8, -0] },
  ])(
    "retains raw direction and $name without adding a point reference",
    async ({ length, point }) => {
      const { api } = setup(
        reference({
          kind: "line",
          start: [10, 2, -0],
          direction: [-2, 3, -0],
          length,
        }),
      );
      try {
        const job = await run(api, "alignment_references", {
          entityId: "reference",
        });
        expect(job.status).toBe("succeeded");
        expect(job.result.references).toHaveLength(1);
        expect(job.result.references[0]).toMatchObject({
          kind: "direction",
          direction: [-2, 3, -0],
          length,
          point,
        });
      } finally {
        api.dispose();
      }
    },
  );

  it("rejects negative extent under the existing stored-line contract", async () => {
    const { api } = setup(
      reference({
        kind: "line",
        start: [10, 2, 0],
        direction: [-2, 3, 0],
        length: -4,
      }),
    );
    try {
      const job = await run(api, "alignment_references", {
        entityId: "reference",
      });
      expect(job.status).toBe("failed");
      expect(job.error?.message).toContain("nonnegative");
    } finally {
      api.dispose();
    }
  });

  it("rejects a nonfinite derived midpoint even when the stored line is finite", async () => {
    const { api } = setup(
      reference({
        kind: "line",
        start: [1e308, 0, 0],
        direction: [0, 0, 0],
        length: 0,
      }),
    );
    try {
      expect(
        (await run(api, "alignment_references", { entityId: "reference" }))
          .status,
      ).toBe("failed");
    } finally {
      api.dispose();
    }
  });

  it.each(["payload", "metadata", "key", "facet"])(
    "rejects invalid semantic source %s without mutation",
    async (variant) => {
      const source = reference({ kind: "point", position: [5, 6, 7] });
      if (variant === "payload") source.reference = undefined;
      if (variant === "metadata") source.positions = [0, 0, 0];
      if (variant === "key") source.constructionOrderKey = undefined;
      const { api, state } = setup(source),
        before = structuredClone(source);
      try {
        const job = await run(api, "alignment_references", {
          entityId: source.id,
          ...(variant === "facet" ? { triangleIndex: 0 } : {}),
        });
        expect(job.status).toBe("failed");
        expect(state.entities[1]).toEqual(before);
        expect(state.history).toHaveLength(0);
      } finally {
        api.dispose();
      }
    },
  );

  it.each([
    { kind: "point", position: [5, 6, 7] },
    { kind: "line", start: [5, 6, 5], direction: [0, 0, 1], length: 4 },
  ] as ReferenceGeometry[])(
    "resolves a locked $kind source through Preview and Apply at the current revision",
    async (geometry) => {
      const source = reference(geometry),
        { api, state } = setup(source);
      try {
        const read = await run(api, "alignment_references", {
          entityId: source.id,
        });
        expect(read.status).toBe("succeeded");
        expect(read.result.references).toHaveLength(1);
        const constraint = read.result.references[0];
        const request = () => ({
          entityIds: ["scan"],
          constraints: [
            {
              kind: "reference",
              entityId: source.id,
              referenceId: constraint.id,
              axis: geometry.kind === "point" ? 0 : 2,
            },
          ],
          parallel: false,
          expectedRevision: api.currentRevision(),
          requestId: crypto.randomUUID(),
        });
        const preview = await run(api, "alignment_preview", request());
        expect(preview.status).toBe("succeeded");
        expect(state.history).toHaveLength(0);
        const applied = await run(api, "alignment_apply", request());
        expect(applied.status).toBe("succeeded");
        expect(applied.result.matrix).toEqual(preview.result.matrix);
        expect(Array.from(state.entities[0].positions).slice(0, 3)).toEqual([
          0, 0, 0,
        ]);
        expect(state.entities[1]).toBe(source);
        expect(state.history).toHaveLength(1);
        const retry = await run(api, "alignment_preview", {
          ...request(),
          constraints: [
            {
              kind: "reference",
              entityId: source.id,
              referenceId: "foreign/reference/point",
              axis: 0,
            },
          ],
        });
        expect(retry.status).toBe("failed");
        const moveSource = await run(api, "alignment_apply", {
          ...request(),
          entityIds: [source.id],
        });
        expect(moveSource.status).toBe("failed");
        expect(state.history).toHaveLength(1);
      } finally {
        api.dispose();
      }
    },
  );
});

it.each(["point", "line"] as const)(
  "offers a semantic %s as a GUI source but excludes it from moving targets",
  (kind) => {
    const source = reference(
      kind === "point"
        ? { kind, position: [5, 6, 7] }
        : { kind, start: [5, 6, 5], direction: [0, 0, 1], length: 4 },
    );
    source.locked = false;
    const { api, state } = setup(source);
    const read = async (): Promise<AlignmentReferencePage> => ({
      entityId: source.id,
      units: "mm",
      total: 0,
      offset: 0,
      nextOffset: null,
      references: [],
    });
    try {
      const picker = renderToStaticMarkup(
        <DatumReferencePicker
          entities={state.entities}
          index={0}
          onChange={() => {}}
          read={read}
          onPickFace={() => {}}
        />,
      );
      expect(picker).toContain(
        '<option value="reference">Datum source</option>',
      );
      expect(picker).not.toContain('<option value="scan">');
      state.entities.push({
        ...state.entities[0],
        id: "other",
        name: "Other scan",
      });
      const panel = renderToStaticMarkup(
        <DatumAlignmentTools
          api={api}
          entity={state.entities[0]}
          center={[5, 6, 7]}
          entities={state.entities}
          readReferences={read}
          onPickFace={() => {}}
          onPickPoint={() => {}}
          open={true}
          onOpenChange={() => {}}
        />,
      );
      expect(panel).toContain(
        '<option value="reference">Datum source</option>',
      );
      expect(panel).toContain('aria-label="Move Other scan"');
      expect(panel).not.toContain('aria-label="Move Datum source"');
    } finally {
      api.dispose();
    }
  },
);
