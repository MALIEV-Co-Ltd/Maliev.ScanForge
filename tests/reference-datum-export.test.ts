import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createReferenceFrameEntity } from "../src/reference-frame";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import { createFittedPlane } from "../src/primitive-fitting";
import type { Entity } from "../src/types";
import type { CadClient } from "../src/cad/client";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
const pose = () => numericDatumFrame([2, 3, 4], [0, 0, 1], [1, 0, 0]);
function datums(): Entity[] {
  return [
    createReferenceFrameEntity(pose(), 5, "frame", "Frame"),
    createNumericDatumPlane(pose(), 5, "numeric-plane", "Numeric plane"),
    {
      ...createFittedPlane(
        {
          kind: "plane",
          center: [2, 3, 4],
          axis: [0, 0, 1],
          rms: 0,
          maxError: 0,
        },
        5,
      ),
      id: "fitted-plane",
    },
  ];
}
function setup(references: Entity[], withRawMesh = false) {
  const cadEntity: Entity = {
    id: "cad",
    name: "Body",
    kind: "cad",
    kernelId: "body-1",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const snapshot: WorkspaceSnapshot = {
    name: "Datum STEP",
    entities: [
      cadEntity,
      ...references,
      ...(withRawMesh
        ? [
            {
              ...cadEntity,
              id: "raw-scan",
              kind: "mesh" as const,
              kernelId: undefined,
            },
          ]
        : []),
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const bytes = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;"),
    exportStep = vi.fn(async () => bytes);
  const host: WorkspaceHost = {
    snapshot: () => snapshot,
    cad: () => ({ exportStep }) as unknown as CadClient,
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
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  return { api, snapshot, exportStep, bytes };
}
async function exportJob(api: ApplicationApi, visible = true) {
  const launched = await api.invoke("project_export", {
    format: "step",
    visible,
  });
  expect(launched.ok, JSON.stringify(launched)).toBe(true);
  if (!launched.ok) throw Error(launched.error.message);
  for (let i = 0; i < 100; i++) {
    const response = await api.invoke("job_get", {
      jobId: (launched.result as { jobId: string }).jobId,
    });
    if (!response.ok) throw Error(response.error.message);
    const job = response.result as {
      status: string;
      result: { artifactId: string };
      error?: { message: string };
    };
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("STEP eligibility test job did not settle");
}
it.each(["frame", "numeric-plane", "fitted-plane", "all"])(
  "excludes visible %s datum display from public STEP export while keeping the exact body",
  async (kind) => {
    const references = datums().filter(
        (entity) => kind === "all" || entity.id === kind,
      ),
      { api, snapshot, exportStep, bytes } = setup(references),
      before = structuredClone(snapshot);
    const job = await exportJob(api);
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    expect(exportStep).toHaveBeenCalledExactlyOnceWith(["body-1"]);
    const artifact = await api.invoke("artifact_read", {
      artifactId: job.result.artifactId,
    });
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) throw Error(artifact.error.message);
    expect(
      Buffer.from((artifact.result as { base64: string }).base64, "base64"),
    ).toEqual(Buffer.from(bytes));
    expect(snapshot).toEqual(before);
  },
);
it("matches the existing GUI by excluding raw source scans alongside reference datums", async () => {
  const { api, exportStep, snapshot } = setup(datums(), true),
    before = structuredClone(snapshot);
  const job = await exportJob(api);
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(exportStep).toHaveBeenCalledExactlyOnceWith(["body-1"]);
  expect(snapshot).toEqual(before);
});
it("includes hidden exact CAD only when visibility filtering is explicitly disabled", async () => {
  const { api, snapshot, exportStep } = setup(datums());
  snapshot.entities[0].visible = false;
  const hidden = await exportJob(api);
  expect(hidden.status).toBe("failed");
  expect(hidden.error?.message).toContain("Create or import exact CAD first");
  expect(exportStep).not.toHaveBeenCalled();
  const all = await exportJob(api, false);
  expect(all.status).toBe("succeeded");
  expect(exportStep).toHaveBeenCalledExactlyOnceWith(["body-1"]);
});
it("rejects datum-only scenes before allocating a STEP kernel export", async () => {
  const { api, snapshot, exportStep } = setup(datums());
  snapshot.entities = snapshot.entities.filter((entity) => !entity.kernelId);
  const before = structuredClone(snapshot);
  const result = await exportJob(api);
  expect(result.status).toBe("failed");
  expect(result.error?.message).toContain("Create or import exact CAD first");
  expect(exportStep).not.toHaveBeenCalled();
  expect(snapshot).toEqual(before);
});
