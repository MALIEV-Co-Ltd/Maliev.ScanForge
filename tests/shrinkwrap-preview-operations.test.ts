import { ApplicationApi } from "../src/automation/api";
import {
  cancelScanToolOnSourceChange,
  cancelShrinkwrapOperation,
  runShrinkwrapPreviewCommand,
} from "../src/ui/shrinkwrap-preview-command";
import { afterEach, expect, it, vi } from "vitest";
import {
  releaseScanPreviewOperation,
  createScanPreviewOperation,
} from "../src/automation/scan-preview-operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
function setup() {
  const source: Entity = {
    id: "mesh",
    name: "Scan",
    kind: "mesh",
    positions: triangle.slice(),
    visible: true,
    color: "#fff",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    name: "test",
    entities: [source],
    history: [],
    future: [],
    authoring: {},
    selectedId: source.id,
    selection: new Uint8Array([1]),
    settings: {},
  };
  const host = {
    snapshot: () => state,
    commit: vi.fn((next: Entity[]) => {
      state.entities = next;
    }),
    select: vi.fn(),
    showScanPreview: vi.fn(),
    clearScanPreview: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    progress: vi.fn(),
    check: vi.fn(),
    artifact: vi.fn(),
    artifactBlob: vi.fn(),
  } as unknown as CommandContext;
  const execute = createScanPreviewOperation(host);
  vi.mocked(processMesh).mockResolvedValue({
    kind: "scanPreview",
    positions: triangle.slice(),
    diagnostics: { summary: "wrapped", sampleInterval: 0.5 },
  });
  return { source, state, host, context, execute };
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("creates an immutable GUI-visible MCP preview, compares and accepts a new object in one history write", async () => {
  const h = setup();
  const created = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.entities[0]).toBe(h.source);
  expect(h.host.showScanPreview).toHaveBeenCalled();
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanPreview",
    noiseComparison: {
      rgb: new Uint8Array(9),
      threshold: 0.1,
      statistics: { percentage: 100 } as never,
    },
    diagnostics: { summary: "sampled comparison" },
  });
  expect(
    await h.execute(
      {
        action: "compare",
        entityId: "mesh",
        previewId: created.previewId,
        deviation: 0.1,
      },
      h.context,
    ),
  ).toMatchObject({ statistics: { percentage: 100 } });
  await h.execute(
    {
      action: "accept",
      entityId: "mesh",
      previewId: created.previewId,
      createNew: true,
    },
    h.context,
  );
  expect(h.host.commit).toHaveBeenCalledOnce();
  expect(h.state.entities).toHaveLength(2);
  expect(h.state.entities[0]).toBe(h.source);
  expect(h.host.clearScanPreview).toHaveBeenCalledWith(created.previewId);
});
it("cancel and automatic expiry release retained outputs without touching geometry/history", async () => {
  vi.useFakeTimers();
  const h = setup();
  let created = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  await h.execute(
    { action: "cancel", entityId: "mesh", previewId: created.previewId },
    h.context,
  );
  expect(h.host.clearScanPreview).toHaveBeenCalledWith(created.previewId);
  created = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  vi.advanceTimersByTime(60_001);
  await expect(
    h.execute(
      { action: "accept", entityId: "mesh", previewId: created.previewId },
      h.context,
    ),
  ).rejects.toThrow(/expired/i);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.entities[0]).toBe(h.source);
});
it("rejects changed sources, locks and injected internal geometry atomically", async () => {
  const h = setup();
  await expect(
    h.execute(
      {
        action: "create",
        entityId: "mesh",
        operation: { kind: "shrinkwrap", selection: [1] },
      },
      h.context,
    ),
  ).rejects.toThrow(/workspace/i);
  const created = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  h.state.entities = [{ ...h.source, positions: triangle.slice() }];
  await expect(
    h.execute(
      { action: "accept", entityId: "mesh", previewId: created.previewId },
      h.context,
    ),
  ).rejects.toThrow(/changed/i);
  expect(h.host.commit).not.toHaveBeenCalled();
});

it("GUI cancellation invalidates an MCP-created preview before MCP can accept it", async () => {
  const h = setup();
  const created = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  releaseScanPreviewOperation(h.host);
  await expect(
    h.execute(
      { action: "accept", entityId: "mesh", previewId: created.previewId },
      h.context,
    ),
  ).rejects.toThrow(/expired/i);
  expect(h.host.commit).not.toHaveBeenCalled();
});
it("either surface accepts only once and reference edits reject the retained preview", async () => {
  const h = setup();
  const reference = { ...h.source, id: "reference" };
  h.state.entities.push(reference);
  const created = (await h.execute(
    {
      action: "create",
      entityId: "mesh",
      targetIds: ["reference"],
      operation: { kind: "shrinkwrap" },
    },
    h.context,
  )) as { previewId: string };
  h.state.entities[1] = { ...reference, visible: false };
  await expect(
    h.execute(
      { action: "accept", entityId: "mesh", previewId: created.previewId },
      h.context,
    ),
  ).rejects.toThrow(/changed/i);
  expect(h.host.clearScanPreview).toHaveBeenCalledWith(created.previewId);
  const second = (await h.execute(
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
    h.context,
  )) as { previewId: string };
  await h.execute(
    {
      action: "accept",
      entityId: "mesh",
      previewId: second.previewId,
      createNew: true,
    },
    h.context,
  );
  await expect(
    h.execute(
      { action: "accept", entityId: "mesh", previewId: second.previewId },
      h.context,
    ),
  ).rejects.toThrow(/expired/i);
  expect(h.host.commit).toHaveBeenCalledOnce();
});

it("GUI create is accepted through MCP and MCP create is accepted through GUI using one API controller", async () => {
  const h = setup();
  const api = new ApplicationApi(h.host, { scan_preview: h.execute });
  try {
    const gui = await runShrinkwrapPreviewCommand(api, {
      action: "create",
      entityId: "mesh",
      operation: { kind: "shrinkwrap" },
    });
    const accepted = await api.invoke("scan_preview", {
      action: "accept",
      entityId: "mesh",
      previewId: gui.previewId,
      createNew: true,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
    expect(accepted.ok).toBe(true);
    expect(h.host.commit).toHaveBeenCalledOnce();
    const receipt = await api.invoke("scan_preview", {
      action: "create",
      entityId: "mesh",
      operation: { kind: "shrinkwrap" },
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
    if (!receipt.ok) throw Error(receipt.error.message);
    const completed = await api.invoke("job_get", {
      jobId: (receipt.result as { jobId: string }).jobId,
    });
    if (!completed.ok) throw Error(completed.error.message);
    const previewId = (completed.result as { result: { previewId: string } })
      .result.previewId;
    await runShrinkwrapPreviewCommand(api, {
      action: "accept",
      entityId: "mesh",
      previewId,
      createNew: true,
    });
    expect(h.host.commit).toHaveBeenCalledTimes(2);
    await expect(
      runShrinkwrapPreviewCommand(api, {
        action: "accept",
        entityId: "mesh",
        previewId,
      }),
    ).rejects.toThrow(/expired/i);
  } finally {
    api.dispose();
  }
});

it("GUI acceptance survives its own source-positions change while external changes still cancel ordinary previews", async () => {
  const h = setup();
  const api = new ApplicationApi(h.host, { scan_preview: h.execute });
  const controller = new AbortController();
  try {
    const created = await runShrinkwrapPreviewCommand(api, {
      action: "create",
      entityId: "mesh",
      operation: { kind: "shrinkwrap" },
    });
    h.host.commit = vi.fn((next) => {
      h.state.entities = next;
      cancelScanToolOnSourceChange(controller, true);
    });
    const accepted = await runShrinkwrapPreviewCommand(
      api,
      { action: "accept", entityId: "mesh", previewId: created.previewId },
      { signal: controller.signal },
    );
    expect(accepted.accepted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(h.host.commit).toHaveBeenCalledOnce();
    cancelScanToolOnSourceChange(controller, false);
    expect(controller.signal.aborted).toBe(true);
  } finally {
    api.dispose();
  }
});

it("accept commits geometry, releases preview selection state and selects output in one tracked mutation", async () => {
  const h = setup();
  const api = new ApplicationApi(h.host, { scan_preview: h.execute });
  try {
    const created = await runShrinkwrapPreviewCommand(api, {
      action: "create",
      entityId: "mesh",
      operation: { kind: "shrinkwrap" },
    });
    h.host.clearScanPreview = vi.fn(() => {
      h.state.selection = new Uint8Array([0]);
    });
    h.host.select = vi.fn((id) => {
      h.state.selectedId = id;
    });
    const accepted = await runShrinkwrapPreviewCommand(api, {
      action: "accept",
      entityId: "mesh",
      previewId: created.previewId,
    });
    expect(accepted.accepted).toBe(true);
    expect(h.host.commit).toHaveBeenCalledOnce();
    expect(h.host.clearScanPreview).toHaveBeenCalledWith(created.previewId);
  } finally {
    api.dispose();
  }
});

it.each(["create", "compare"] as const)(
  "GUI Cancel operation stops an MCP-owned ShrinkWrap %s job without committing",
  async (action) => {
    const h = setup();
    let previewId: string | undefined;
    if (action === "compare")
      previewId = (
        (await h.execute(
          {
            action: "create",
            entityId: "mesh",
            operation: { kind: "shrinkwrap" },
          },
          h.context,
        )) as { previewId: string }
      ).previewId;
    const api = new ApplicationApi(h.host, { scan_preview: h.execute });
    vi.mocked(processMesh).mockImplementationOnce(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    try {
      const receipt = await api.invoke("scan_preview", {
        action,
        entityId: "mesh",
        ...(action === "create"
          ? { operation: { kind: "shrinkwrap" } }
          : { previewId }),
        expectedRevision: api.currentRevision(),
        requestId: crypto.randomUUID(),
      });
      if (!receipt.ok) throw Error(receipt.error.message);
      cancelShrinkwrapOperation(api, null);
      let status = "running";
      for (let attempt = 0; attempt < 10 && status === "running"; attempt++) {
        await Promise.resolve();
        const job = await api.invoke("job_get", {
          jobId: (receipt.result as { jobId: string }).jobId,
        });
        if (!job.ok) throw Error(job.error.message);
        status = (job.result as { status: string }).status;
      }
      expect(status).toBe("cancelled");
      expect(h.host.commit).not.toHaveBeenCalled();
      expect(h.state.entities[0]).toBe(h.source);
    } finally {
      api.dispose();
    }
  },
);

it("GUI Cancel operation stops an MCP-owned direct ShrinkWrap job", async () => {
  const h = setup();
  const api = new ApplicationApi(h.host, {
    mesh_process: async (_args, context) =>
      new Promise((_resolve, reject) => {
        context.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
  });
  try {
    const receipt = await api.invoke("mesh_process", {
      entityId: "mesh",
      operation: { kind: "scanTools", operation: { kind: "shrinkwrap" } },
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
    if (!receipt.ok) throw Error(receipt.error.message);
    cancelShrinkwrapOperation(api, null);
    let status = "running";
    for (let attempt = 0; attempt < 10 && status === "running"; attempt++) {
      await Promise.resolve();
      const job = await api.invoke("job_get", {
        jobId: (receipt.result as { jobId: string }).jobId,
      });
      if (!job.ok) throw Error(job.error.message);
      status = (job.result as { status: string }).status;
    }
    expect(status).toBe("cancelled");
    expect(h.host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
