import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { Entity } from "../src/types";
import { analyzePrimitiveFit } from "../src/primitive-fitting";
import {
  decodeProjectFile,
  encodeProjectFileLocally,
} from "../src/project-file";
import {
  serializeProject,
  serializeProjectBlob,
  parseProject,
  validateProject,
} from "../src/io";
import { copyFitResult } from "../src/fitted-primitive";

it.each([
  { active: true, selectionOnly: undefined, cloud: false },
  { active: true, selectionOnly: false, cloud: false },
  { active: true, selectionOnly: true, cloud: false },
  { active: false, selectionOnly: undefined, cloud: false },
  { active: true, selectionOnly: false, cloud: true },
])(
  "creates a fitted plane with shared selection defaults %j, exact frame and preserved source",
  async ({ active, selectionOnly, cloud }) => {
    const source: Entity = {
      id: "scan",
      name: "Scan",
      kind: cloud ? "pointcloud" : "mesh",
      positions: new Float32Array(
        cloud
          ? [0, 0, 5, 10, 0, 5, 0, 10, 5, 10, 10, 5]
          : [
              0, 0, 5, 10, 0, 5, 0, 10, 5, 100, 100, 100, 110, 100, 100, 100,
              110, 100,
            ],
      ),
      visible: true,
      locked: true,
      opacity: 1,
      color: "#aaaaaa",
    };
    const state: WorkspaceSnapshot = {
      name: "Fit",
      entities: [source],
      history: [],
      future: [],
      authoring: {},
      settings: {},
      selectedId: active ? source.id : null,
      selection: new Uint8Array(cloud ? [1, 1, 1, 0] : [1, 0]),
    };
    const host: WorkspaceHost = {
      snapshot: () => state,
      cad: () => {
        throw Error("Plane requires no CAD");
      },
      commit: (entities, label) => {
        state.history.push({ entities: state.entities, label });
        state.entities = entities;
      },
      replace: vi.fn(),
      select: (id) => {
        state.selectedId = id;
      },
      setSelection: vi.fn(),
      setSketch: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      view: vi.fn(),
      settings: vi.fn(),
      busy: () => false,
      activity: vi.fn(),
    };
    const api = new ApplicationApi(host, createOperations(host));
    try {
      const args = {
        entityId: source.id,
        kind: "plane",
        expectedRevision: api.currentRevision(),
        requestId: "fit-plane",
        ...(selectionOnly === undefined ? {} : { selectionOnly }),
      };
      const first = await api.invoke("primitive_fit_create", args);
      expect(first.ok, JSON.stringify(first)).toBe(true);
      expect(await api.invoke("primitive_fit_create", args)).toEqual(first);
      let completed: any;
      for (let i = 0; i < 10; i++) {
        const wire = await api.invoke("job_get", {
          jobId: (first as any).result.jobId,
        });
        expect(wire.ok).toBe(true);
        completed = (wire as any).result;
        if (completed.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(completed.status, JSON.stringify(completed)).toBe("succeeded");
      expect(completed.result.fit).toEqual(
        analyzePrimitiveFit(
          source,
          "plane",
          active && selectionOnly !== false ? state.selection : undefined,
        ).fit,
      );
      expect(state.history).toHaveLength(1);
      expect(state.entities).toHaveLength(2);
      expect(state.entities[0]).toBe(source);
      expect(state.entities[0].positions).toBe(source.positions);
      const plane = state.entities[1];
      expect(plane.kind).toBe("plane");
      expect(plane.planeFrame!.center).toEqual(completed.result.fit.center);
      expect(plane.planeFrame!.normal).toEqual(completed.result.fit.axis);
      expect(state.selectedId).toBe(plane.id);
      expect(plane.positions).toHaveLength(18);
      const restored = await decodeProjectFile(
        await encodeProjectFileLocally({
          project: {
            format: "maliev-scanforge",
            version: 1,
            units: "mm",
            name: state.name,
            entities: state.entities,
          },
          history: state.history,
          future: [],
        }),
      );
      expect(restored.project.entities[1].planeFrame).toEqual(plane.planeFrame);
      expect(restored.project.entities[1].fit).toEqual(plane.fit);
      for (const text of [
        serializeProject("Fit", state.entities),
        await (await serializeProjectBlob("Fit", state.entities)).text(),
      ]) {
        expect(parseProject(text).entities[1].fit).toEqual(plane.fit);
      }
    } finally {
      api.dispose();
    }
  },
);

it("validates and detaches persisted primitive dimensions and residuals", () => {
  const fit = {
    kind: "sphere" as const,
    center: [1, 2, 3],
    axis: [0, 0, 1],
    radius: 2,
    rms: 0,
    maxError: 0,
  };
  const copy = copyFitResult(fit);
  fit.center[0] = 9;
  expect(copy.center).toEqual([1, 2, 3]);
  for (const patch of [
    { radius: -1 },
    { rms: NaN },
    { axis: [0, 0, 0] },
    { center: [0, Infinity, 0] },
  ]) {
    expect(() => copyFitResult({ ...fit, ...patch })).toThrow(/fitted/i);
    expect(() =>
      validateProject({
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Invalid",
        entities: [
          {
            id: "a",
            name: "a",
            kind: "mesh",
            color: "#aaaaaa",
            visible: true,
            opacity: 1,
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            fit: { ...fit, ...patch },
          },
        ],
      }),
    ).toThrow(/fitted/i);
  }
});
