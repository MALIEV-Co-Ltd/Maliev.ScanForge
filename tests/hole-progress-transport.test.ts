import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import {
  getWorkingJobProgress,
  getWorkingJobStatus,
} from "../src/working-job-status";
import { releaseProcessingSession } from "../src/processing-session";
import type { HoleFillProgress } from "../src/hole-fill-progress";

class WorkerTransport {
  static latest: WorkerTransport;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: unknown;
  terminated = false;
  constructor() {
    WorkerTransport.latest = this;
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
afterEach(() => {
  releaseProcessingSession();
  vi.unstubAllGlobals();
});

it.each(["complete", "cancel", "error"])(
  "carries batch counts through the worker, shared GUI state and MCP job_get until %s",
  async (ending) => {
    vi.stubGlobal("Worker", WorkerTransport);
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const state: WorkspaceSnapshot = {
      name: "Progress test",
      entities: [
        {
          id: "mesh",
          name: "Scan",
          kind: "mesh",
          positions,
          color: "#ffffff",
          visible: true,
          opacity: 1,
        },
      ],
      selectedId: "mesh",
      selection: null,
      settings: {},
      history: [],
      future: [],
      authoring: {},
    };
    const commit = vi.fn();
    const host = {
      snapshot: () => state,
      busy: () => false,
      activity: vi.fn(),
      commit,
      select: vi.fn(),
    } as unknown as WorkspaceHost;
    const api = new ApplicationApi(host, createOperations(host));
    try {
      const started = await api.invoke("mesh_process", {
        entityId: "mesh",
        operation: { kind: "scanEdit", action: "fillHoles" },
        expectedRevision: api.currentRevision(),
        requestId: `progress-${ending}`,
      });
      expect(started).toMatchObject({
        ok: true,
        result: { status: "running" },
      });
      const jobId = (
        started.ok ? (started.result as { jobId: string }) : undefined
      )!.jobId;
      const worker = WorkerTransport.latest;
      const details: HoleFillProgress = {
        kind: "holeFill",
        phase: "closing",
        processed: 2,
        total: 3,
        closed: 1,
        skipped: 1,
      };
      worker.reply({ progress: 2 / 3, stage: "Closing holes", details });
      expect(getWorkingJobProgress()).toEqual(details);
      expect(getWorkingJobStatus()).toBe("Closing holes · 67%");
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: {
          status: "running",
          progressDetails: details,
          progress: 2 / 3,
        },
      });
      if (ending === "cancel") await api.invoke("job_cancel", { jobId });
      else if (ending === "error") worker.reply({ error: "Patch failed" });
      else {
        const complete = {
          ...details,
          phase: "complete" as const,
          processed: 3,
          closed: 2,
        };
        worker.reply({
          progress: 1,
          stage: "Hole filling complete",
          details: complete,
        });
        worker.reply({
          result: {
            kind: "scanEdit",
            scanEdit: {
              positions,
              diagnostics: { filledHoles: 2, skippedHoles: 1 },
            },
            diagnostics: { filledHoles: 2, skippedHoles: 1 },
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getWorkingJobStatus()).toBe("");
      expect(getWorkingJobProgress()).toBeUndefined();
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: {
          status:
            ending === "complete"
              ? "succeeded"
              : ending === "cancel"
                ? "cancelled"
                : "failed",
        },
      });
      if (ending !== "complete") {
        expect(commit).not.toHaveBeenCalled();
        expect(worker.terminated).toBe(ending === "cancel");
      }
      worker.reply({ progress: 1, stage: "Late event", details });
      expect(getWorkingJobProgress()).toBeUndefined();
    } finally {
      api.dispose();
    }
  },
);
