import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import { createHash } from "node:crypto";

function fixture(positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  const entity: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions,
    visible: true,
    color: "#aaaaaa",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    name: "Digest",
    entities: [entity],
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
    commit: vi.fn(),
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
  return { api, state, host, entity };
}
async function terminal(api: ApplicationApi, jobId: string) {
  for (let i = 0; i < 200; i++) {
    const status = await api.invoke("job_get", { jobId });
    if (!status.ok) throw Error(status.error.message);
    const job = status.result as {
      status: string;
      result?: unknown;
      error?: { code: string };
    };
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Digest job did not settle");
}
it("discovers bounded read-only geometry digest as a cancellable job and preserves project state", async () => {
  const { api, state, host, entity } = fixture();
  try {
    const discovery = await api.invoke("tools_search", {
      query: "object_geometry_digest",
    });
    expect(JSON.stringify(discovery)).toContain('"job":true');
    expect(JSON.stringify(discovery)).toContain('"readOnly":true');
    const before = structuredClone(state);
    const revision = api.currentRevision();
    const receipt = await api.invoke("object_geometry_digest", {
      entityId: "scan",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    const result = await terminal(
      api,
      (receipt.result as { jobId: string }).jobId,
    );
    expect(result.status).toBe("succeeded");
    expect(result.result).toMatchObject({
      entityId: "scan",
      units: "mm",
      buffers: [
        {
          path: "positions",
          encoding: "f32",
          elements: 9,
          rawBytes: 36,
          sha256: createHash("sha256")
            .update(new Uint8Array((entity.positions as Float32Array).buffer))
            .digest("hex"),
        },
      ],
    });
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it("honors job cancellation without publishing a digest or mutating geometry", async () => {
  const { api, entity } = fixture(new Float32Array(600_000));
  try {
    const before = entity.positions;
    const receipt = await api.invoke("object_geometry_digest", {
      entityId: "scan",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    const cancelled = await api.invoke("job_cancel", {
      jobId: (receipt.result as { jobId: string }).jobId,
    });
    expect(cancelled.ok).toBe(true);
    const result = await terminal(
      api,
      (receipt.result as { jobId: string }).jobId,
    );
    expect(result.status).toBe("cancelled");
    expect(result.result).toBeUndefined();
    expect(entity.positions).toBe(before);
  } finally {
    api.dispose();
  }
});
it("rejects an obsolete snapshot instead of returning a digest for changed geometry", async () => {
  const { api, entity, state } = fixture(new Float32Array(600_000));
  try {
    const receipt = await api.invoke("object_geometry_digest", {
      entityId: "scan",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    state.entities = [{ ...entity, positions: new Float32Array([1, 2, 3]) }];
    const result = await terminal(
      api,
      (receipt.result as { jobId: string }).jobId,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("REVISION_CONFLICT");
    expect(result.result).toBeUndefined();
  } finally {
    api.dispose();
  }
});

it("still rejects a genuine selection change while a read-only digest yields", async () => {
  const { api, entity, state, host } = fixture(new Float32Array(600003));
  const positions = entity.positions;
  state.selectedId = entity.id;
  state.selection = new Uint8Array(66667);
  try {
    const receipt = await api.invoke("object_geometry_digest", {
      entityId: entity.id,
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    const changed = new Uint8Array(state.selection);
    changed[0] = 1;
    state.selection = changed;
    const result = await terminal(
      api,
      (receipt.result as { jobId: string }).jobId,
    );
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("REVISION_CONFLICT");
    expect(result.result).toBeUndefined();
    expect(entity.positions).toBe(positions);
    expect(state.selection[0]).toBe(1);
    expect(host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
