import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Entity } from "../src/types";
import { entityDisplayStats } from "../src/entity-display-stats";
import { GeometryStatistics } from "../src/ui/GeometryStatistics";
import { StatusMetrics } from "../src/ui/StatusMetrics";
import {
  inspectReferenceEntity,
  supportsSampledGeometry,
  assertSampledGeometry,
} from "../src/reference-entity";
import { createOperations } from "../src/automation/operations";
import {
  coordinateAlignmentInterface,
  createWorkflowOperations,
  type InterfacePatch,
} from "../src/automation/workflow-operations";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";

const base: Entity = {
  id: "shape",
  name: "Shape",
  kind: "mesh",
  positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
  visible: true,
  color: "#fff",
  opacity: 1,
};
function reference(line = false): Entity {
  return {
    ...base,
    kind: line ? "referenceLine" : "referencePoint",
    positions: [],
    constructionOrderKey: "01".repeat(16),
    reference: {
      version: 1,
      evaluation: { completionWord: 0x100 },
      geometry: line
        ? { kind: "line", start: [10, 2, 3], direction: [-2, 3, 0], length: 4 }
        : { kind: "point", position: [-0, 1 + 2 ** -40, Number.MIN_VALUE] },
      definition: line
        ? {
            version: 1,
            kind: "line",
            mode: "average",
            sources: [],
            records: [],
          }
        : {
            version: 1,
            kind: "point",
            mode: "coordinates",
            position: [0, 0, 0],
            sources: [],
          },
    },
  };
}

it.each([false, true])(
  "shows semantic counts/bounds rather than empty mesh statistics (line=%s)",
  (line) => {
    const entity = reference(line),
      stats = entityDisplayStats(entity);
    const shared = inspectReferenceEntity(entity, [entity])!;
    expect(stats).toMatchObject({
      kind: "reference",
      points: line ? 0 : 1,
      lines: line ? 1 : 0,
      triangles: 0,
      min: shared.bounds.min,
      max: shared.bounds.max,
    });
    expect(stats).not.toHaveProperty("area");
    expect(stats).not.toHaveProperty("volume");
    expect(stats).not.toHaveProperty("vertices");
    if (line)
      expect(stats).toMatchObject({
        min: [2, 2, 3],
        max: [10, 14, 3],
        size: [8, 12, 0],
        center: [6, 8, 3],
      });
    else
      expect(stats).toMatchObject({
        min: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
        size: [0, 0, 0],
        center: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
      });
    const html = renderToStaticMarkup(<GeometryStatistics stats={stats} />);
    expect(html).toContain(line ? "Reference lines" : "Reference points");
    expect(html).toContain("<dd>1</dd>");
    expect(html).not.toMatch(/Surface area|Volume|triangle soup|Triangles/);
    const status = renderToStaticMarkup(
      <StatusMetrics
        reference={{ points: shared.points, lines: shared.lines }}
      />,
    );
    expect(status).toContain(
      line ? "Reference lines: 1" : "Reference points: 1",
    );
    expect(status).not.toMatch(/Facets:|Total scan points/);
  },
);

it("refreshes semantic bounds when payload identity changes but the empty carrier is reused", () => {
  const entity = reference(),
    first = entityDisplayStats(entity);
  const next = {
    ...entity,
    reference: {
      ...entity.reference!,
      geometry: { kind: "point" as const, position: [10, 20, 30] as const },
    },
  };
  expect(next.positions).toBe(entity.positions);
  expect(entityDisplayStats(next)).toMatchObject({
    min: [10, 20, 30],
    center: [10, 20, 30],
  });
  expect(first.min).toEqual([-0, 1 + 2 ** -40, Number.MIN_VALUE]);
});

it("retains finite centers for large coincident endpoints", () => {
  const entity = reference(true);
  entity.reference!.geometry = {
    kind: "line",
    start: [1e308, -1e308, 0],
    direction: [0, 0, 0],
    length: 0,
  };
  expect(entityDisplayStats(entity)).toMatchObject({
    center: [1e308, -1e308, 0],
    size: [0, 0, 0],
  });
});

it("retains sampled mesh and cloud statistics and their labels", () => {
  const mesh = entityDisplayStats(base),
    cloud = entityDisplayStats({ ...base, kind: "pointcloud" });
  expect(mesh).toMatchObject({
    kind: "mesh",
    vertices: 3,
    triangles: 1,
    area: 2,
    center: [1, 1, 0],
  });
  expect(cloud).toMatchObject({
    kind: "pointcloud",
    vertices: 3,
    triangles: 0,
    center: [1, 1, 0],
  });
  expect(renderToStaticMarkup(<GeometryStatistics stats={mesh} />)).toContain(
    "Surface area",
  );
  const html = renderToStaticMarkup(<GeometryStatistics stats={cloud} />);
  expect(html).toContain("Points");
  expect(html).not.toContain("Volume");
  expect(supportsSampledGeometry(base)).toBe(true);
  expect(supportsSampledGeometry({ ...base, kind: "pointcloud" })).toBe(true);
});

it.each([false, true])(
  "shares reference exclusion for sampled selections/sections with MCP (line=%s)",
  async (line) => {
    const entity = reference(line);
    expect(supportsSampledGeometry(entity)).toBe(false);
    expect(supportsSampledGeometry(undefined)).toBe(false);
    expect(() => assertSampledGeometry(entity)).toThrow(/sampled/);
    const state: WorkspaceSnapshot = {
      name: "test",
      entities: [entity],
      history: [],
      future: [],
      authoring: {},
      selectedId: entity.id,
      selection: null,
      settings: {},
    };
    let interfaceState: InterfacePatch = {
      workspace: "properties",
      mode: "inspect",
    };
    const host: WorkspaceHost = {
      snapshot: () => state,
      cad: () => ({}) as CadClient,
      commit: () => {
        throw new Error("Unexpected mutation");
      },
      replace: () => {},
      select: () => {},
      setSelection: () => {
        throw new Error("Unexpected selection mutation");
      },
      setSketch: () => {},
      undo: () => {},
      redo: () => {},
      view: () => {},
      settings: () => {},
      busy: () => false,
      activity: () => {},
      setInterface: (patch) => {
        interfaceState = { ...interfaceState, ...patch };
      },
      inspectApplication: () => ({ ...interfaceState }),
    };
    const api = new ApplicationApi(host, {
      ...createOperations(host),
      ...createWorkflowOperations(host),
    });
    try {
      const object = await api.invoke("object_get", { entityId: entity.id });
      expect(object.ok).toBe(true);
      if (!object.ok) throw new Error(object.error.message);
      expect(object.result).toMatchObject({
        points: line ? 0 : 1,
        lines: line ? 1 : 0,
        triangles: 0,
        bounds: {
          min: entityDisplayStats(entity).min,
          max: entityDisplayStats(entity).max,
        },
      });
      const section = await api.invoke("analysis_section", {
        entityId: entity.id,
        axis: "z",
        offset: 0,
      });
      expect(section.ok).toBe(true);
      if (!section.ok) throw new Error(section.error.message);
      const jobId = (section.result as { jobId: string }).jobId;
      let finished = false;
      for (let i = 0; i < 100; i++) {
        const response = await api.invoke("job_get", { jobId });
        if (!response.ok) throw new Error(response.error.message);
        const job = response.result as {
          status: string;
          error?: { message: string };
        };
        if (job.status !== "running") {
          expect(job.status).toBe("failed");
          expect(job.error?.message).toMatch(/sampled/);
          finished = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(finished).toBe(true);
      for (const patch of [
        { workspace: "mesh" },
        { workspace: "section" },
        { workspace: "fit" },
        { workspace: "scanTools" },
        { workspace: "deviation" },
        { mode: "brush" },
        { mode: "section", settingsOpen: true },
      ] as InterfacePatch[]) {
        expect(() => coordinateAlignmentInterface(patch, entity)).toThrow(
          /sampled/,
        );
        const ui = await api.invoke("ui_set", {
          ...patch,
          expectedRevision: api.currentRevision(),
          requestId: crypto.randomUUID(),
        });
        expect(ui.ok).toBe(false);
        if (!ui.ok) expect(ui.error.message).toMatch(/sampled/);
        expect(interfaceState).toEqual({
          workspace: "properties",
          mode: "inspect",
        });
      }
      expect(state.history).toHaveLength(0);
      const properties = await api.invoke("ui_set", {
        workspace: "properties",
        mode: "inspect",
        settingsOpen: true,
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      expect(properties).toMatchObject({
        ok: true,
        result: {
          workspace: "properties",
          mode: "inspect",
          settingsOpen: true,
        },
      });
      expect(state.entities[0]).toBe(entity);
    } finally {
      api.dispose();
    }
  },
);
