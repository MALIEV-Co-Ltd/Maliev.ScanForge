import { expect, it, vi } from "vitest";
import { ApplicationApi, type WorkspaceHost } from "../src/automation/api";
import { createScanSelectionOperations } from "../src/automation/scan-selection-operations";

function setup() {
  const entity = {
    id: "cloud",
    kind: "pointcloud",
    visible: true,
    positions: new Float32Array(9),
    meshSelection: { hidden: [1], saved: [] },
  };
  const state = {
    name: "Test",
    entities: [entity],
    selectedId: "cloud",
    selection: Uint8Array.from([1, 0, 0]),
    history: [],
    future: [],
    authoring: {},
    settings: {},
  };
  const host = {
    snapshot: () => state,
    busy: () => false,
    activity: vi.fn(),
    inspectScanSelection: () => ({ entityId: "cloud", clip: null }),
    controlScanSelection: vi.fn(),
    selectScanRegion: vi.fn(async () => Uint8Array.from([0, 1, 1])),
    setSelection: vi.fn((_id: string, mask: Uint8Array) => {
      state.selection = new Uint8Array(mask);
    }),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createScanSelectionOperations(host));
  return { state, host, api };
}
it("discovers public screen-region selection and preserves hidden source slots", async () => {
  const { state, api } = setup();
  try {
    const response = await api.invoke("scan_select_region", {
      entityId: "cloud",
      region: { kind: "rectangle", start: [0, 0], end: [100, 100] },
      through: true,
      operation: "add",
      expectedRevision: api.currentRevision(),
      requestId: "r",
    });
    expect(response.ok).toBe(true);
    const jobId = (response as any).result.jobId;
    await vi.waitFor(async () =>
      expect(
        ((await api.invoke("job_get", { jobId })) as any).result.status,
      ).toBe("succeeded"),
    );
    expect([...state.selection]).toEqual([1, 0, 1]);
  } finally {
    api.dispose();
  }
});
it("rejects a locked or unselected target before querying the viewport", async () => {
  const { state, host, api } = setup();
  (state.entities[0] as any).locked = true;
  try {
    const response = await api.invoke("scan_selection_control", {
      entityId: "cloud",
      action: "hide",
      expectedRevision: api.currentRevision(),
      requestId: "locked",
    });
    expect(response.ok).toBe(false);
    expect(host.controlScanSelection).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it("rejects malformed clipping bounds without changing editor state", async () => {
  const { host, api } = setup();
  try {
    const response = await api.invoke("scan_selection_control", {
      entityId: "cloud",
      action: "configure",
      clip: { min: [2, 0, 0], max: [1, 1, 1] },
      expectedRevision: api.currentRevision(),
      requestId: "clip",
    });
    expect(response.ok).toBe(false);
    expect(host.controlScanSelection).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it.each([null, { min: [0, 0, 0], max: [1, 1, 1] }])(
  "accepts a valid clipping configuration %j",
  async (clip) => {
    const { host, api } = setup();
    try {
      const result = await api.invoke("scan_selection_control", {
        entityId: "cloud",
        action: "configure",
        clip,
        expectedRevision: api.currentRevision(),
        requestId: "valid-clip",
      });
      expect(result.ok).toBe(true);
      expect(host.controlScanSelection).toHaveBeenCalledOnce();
    } finally {
      api.dispose();
    }
  },
);
it.each(["cancel", "revision"])(
  "discards late screen masks after %s",
  async (reason) => {
    const { host, state, api } = setup();
    let finish!: (mask: Uint8Array) => void;
    vi.mocked(host.selectScanRegion!).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const args = {
        entityId: "cloud",
        region: { kind: "rectangle", start: [0, 0], end: [100, 100] },
        expectedRevision: api.currentRevision(),
        requestId: reason,
      };
      const response = (await api.invoke("scan_select_region", args)) as any;
      const jobId = response.result.jobId;
      expect(await api.invoke("scan_select_region", args)).toEqual(response);
      expect(host.selectScanRegion).toHaveBeenCalledOnce();
      if (reason === "cancel") await api.invoke("job_cancel", { jobId });
      else state.name = "Other revision";
      finish(Uint8Array.from([0, 0, 1]));
      await vi.waitFor(async () =>
        expect(
          ((await api.invoke("job_get", { jobId })) as any).result.status,
        ).toBe(reason === "cancel" ? "cancelled" : "failed"),
      );
      expect([...state.selection]).toEqual([1, 0, 0]);
      expect(host.setSelection).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  },
);
