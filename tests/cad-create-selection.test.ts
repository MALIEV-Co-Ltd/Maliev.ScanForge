import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
it.each([true, false, undefined])(
  "publishes requested CAD selection before the job succeeds (selectCreated=%s)",
  async (selectCreated) => {
    const state: WorkspaceSnapshot = {
      name: "CAD",
      entities: [],
      history: [],
      future: [],
      authoring: {},
      selectedId: null,
      selection: null,
      settings: {},
    };
    let busy = false;
    const select = vi.fn((id: string | null) => {
      state.selectedId = id;
    });
    const cad = {
      primitive: vi.fn(async () => ({
        kernelId: "native",
        brep: "brep",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      })),
      release: vi.fn(async () => true),
    } as unknown as CadClient;
    const host: WorkspaceHost = {
      snapshot: () => ({ ...state }),
      cad: () => cad,
      commit: (entities, label) => {
        state.history = [...state.history, { entities: state.entities, label }];
        state.entities = entities;
      },
      replace: vi.fn(),
      select,
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
    try {
      const args = {
        name: "Box",
        recipe: {
          kind: "primitive",
          input: { kind: "box", center: [0, 0, 0], size: [2, 2, 2] },
        },
        ...(selectCreated === undefined ? {} : { selectCreated }),
        expectedRevision: api.currentRevision(),
        requestId: "create",
      };
      const receipt = await api.invoke("cad_create", args);
      expect(receipt.ok).toBe(true);
      if (!receipt.ok) return;
      const jobId = (receipt.result as { jobId: string }).jobId;
      let job: any;
      for (let i = 0; i < 80; i++) {
        const response = await api.invoke("job_get", { jobId });
        expect(response.ok).toBe(true);
        if (!response.ok) return;
        job = response.result;
        if (job.status !== "running") break;
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(job.status).toBe("succeeded");
      expect(state.selectedId).toBe(
        selectCreated ? job.result.entityIds[0] : null,
      );
      expect(select).toHaveBeenCalledTimes(selectCreated ? 1 : 0);
      expect(await api.invoke("cad_create", args)).toEqual(receipt);
      expect(cad.primitive).toHaveBeenCalledOnce();
      expect(state.history).toHaveLength(1);
    } finally {
      api.dispose();
    }
  },
);
