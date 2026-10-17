import { expect, it, vi } from "vitest";
import { ApplicationApi, type WorkspaceHost } from "../src/automation/api";
import {
  createGlobalAlignmentOperations,
  inspectGlobalAlignmentPreview,
} from "../src/automation/global-alignment-operations";

const gate = vi.hoisted(() => {
  let entered!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>((resolve) => {
      entered = resolve;
    }),
    pending: new Promise<void>((resolve) => {
      release = resolve;
    }),
    enter: () => entered(),
    release: () => release(),
    prepare: vi.fn(),
    normalize: vi.fn(),
  };
});
vi.mock("../src/global-alignment-input", async () => {
  gate.enter();
  await gate.pending;
  return {
    prepareGlobalAlignmentInput: gate.prepare,
    normalizeGlobalSearchTolerance: gate.normalize,
  };
});

it("cancels its owning job while the input module is still loading without mutating the workspace", async () => {
  let busy = false;
  const snapshot = {
    name: "Cold initialization",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const host = {
    snapshot: () => snapshot,
    busy: () => busy,
    activity: vi.fn((running: boolean) => {
      busy = running;
    }),
    showDatumPreview: vi.fn(),
    setInterface: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
    commit: vi.fn(),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createGlobalAlignmentOperations(host));
  let request = 0;
  const mutation = () => ({
    expectedRevision: api.currentRevision(),
    requestId: `cold-${++request}`,
  });
  try {
    const start = await api.invoke("global_alignment_preview", mutation());
    expect(start.ok).toBe(true);
    if (!start.ok) throw Error(start.error.message);
    const { jobId } = start.result as { jobId: string };
    await gate.entered;
    expect(busy).toBe(true);
    expect(inspectGlobalAlignmentPreview(host).state).toBe("idle");
    await api.invoke("global_alignment_cancel", {
      ...mutation(),
      jobId: "different-job",
    });
    expect(busy).toBe(true);
    expect(host.setInterface).not.toHaveBeenCalled();
    const cancelled = await api.invoke("global_alignment_cancel", {
      ...mutation(),
      jobId,
    });
    expect(cancelled.ok).toBe(true);
    gate.release();
    await vi.waitFor(async () => {
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: { status: "cancelled" },
      });
    });
    expect(gate.prepare).not.toHaveBeenCalled();
    expect(gate.normalize).not.toHaveBeenCalled();
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.showDatumPreview).not.toHaveBeenCalled();
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.history).toEqual([]);
    expect(busy).toBe(false);
  } finally {
    gate.release();
    api.dispose();
  }
});
