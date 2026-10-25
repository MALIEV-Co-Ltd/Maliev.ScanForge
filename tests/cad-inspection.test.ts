import { expect, it, vi } from "vitest";
import { createCadInspectionOperation } from "../src/automation/cad-inspection";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import { ApplicationApi } from "../src/automation/api";

const { inspect, dispose } = vi.hoisted(() => ({
  inspect: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../src/cad/client", () => ({
  CadClient: class {
    inspectBrep = inspect;
    dispose = dispose;
  },
}));

function setup() {
  inspect.mockReset();
  dispose.mockReset();
  const source = {
    id: "cad",
    name: "CAD",
    kind: "cad",
    brep: "BREP",
    kernelId: "live",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
  };
  const host = {
    snapshot: () => ({
      name: "Inspection",
      entities: [source],
      history: [],
      future: [],
      authoring: {},
      settings: {},
      selectedId: "cad",
      selection: null,
    }),
    cad: vi.fn(),
    commit: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  } as unknown as WorkspaceHost;
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    check: vi.fn(() => controller.signal.throwIfAborted()),
  } as unknown as CommandContext;
  return {
    operation: createCadInspectionOperation(host),
    host,
    context,
    controller,
    source,
  };
}
it("inspects saved exact geometry in an isolated worker without touching the live client or model", async () => {
  const h = setup();
  inspect.mockResolvedValue({ valid: true, volumeMm3: 6 });
  expect(await h.operation({ entityId: "cad" }, h.context)).toEqual({
    entityId: "cad",
    valid: true,
    volumeMm3: 6,
  });
  expect(inspect).toHaveBeenCalledWith("BREP");
  expect(dispose).toHaveBeenCalledOnce();
  expect(h.host.cad).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.source.kernelId).toBe("live");
});
it("fences stale inspection results and always disposes the diagnostic worker", async () => {
  const h = setup();
  inspect.mockResolvedValue({ valid: true });
  vi.mocked(h.context.check)
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw Error("revision changed");
    });
  await expect(h.operation({ entityId: "cad" }, h.context)).rejects.toThrow(
    "revision changed",
  );
  expect(dispose).toHaveBeenCalledOnce();
});
it("cancels only its diagnostic worker and preserves the abort failure", async () => {
  const h = setup();
  inspect.mockImplementation(
    () =>
      new Promise((_, reject) =>
        dispose.mockImplementation(() =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  const running = h.operation({ entityId: "cad" }, h.context);
  h.controller.abort();
  await expect(running).rejects.toThrow("Aborted");
  expect(h.host.cad).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});
it("rejects missing exact geometry before creating a worker", async () => {
  const h = setup();
  await expect(h.operation({ entityId: "missing" }, h.context)).rejects.toThrow(
    "exact CAD",
  );
  expect(inspect).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
});

it("exposes a read-only MCP contract and does not change revision or history", async () => {
  const h = setup();
  inspect.mockResolvedValue({ valid: true, volumeMm3: 6 });
  const api = new ApplicationApi(h.host, { cad_inspect: h.operation });
  const revision = api.currentRevision();
  try {
    const receipt = await api.invoke("cad_inspect", { entityId: "cad" });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    let status: any;
    for (let i = 0; i < 20; i++) {
      const reply = await api.invoke("job_get", {
        jobId: (receipt.result as { jobId: string }).jobId,
      });
      expect(reply.ok).toBe(true);
      if (!reply.ok) return;
      status = reply.result;
      if (status.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(status.status).toBe("succeeded");
    expect(status.result).toEqual({
      entityId: "cad",
      valid: true,
      volumeMm3: 6,
    });
    expect(api.currentRevision()).toBe(revision);
    expect(h.host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});

it("rejects oversized BREP before admitting a diagnostic worker", async () => {
  const h = setup();
  h.source.brep = "x".repeat(64 * 1024 * 1024 + 1);
  await expect(h.operation({ entityId: "cad" }, h.context)).rejects.toThrow(
    "resource limit",
  );
  expect(inspect).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
});
