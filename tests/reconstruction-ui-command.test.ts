import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ApiResult, ApplicationApi } from "../src/automation/api";
import { runReconstructionCommand } from "../src/ui/reconstruction-command";
import { runApplicationJobCommand } from "../src/ui/application-job-command";
import { runShrinkwrapPreviewCommand } from "../src/ui/shrinkwrap-preview-command";

const ok = (result: unknown) => ({ ok: true as const, revision: 7, result });
const done = (result: unknown = { entityId: "new-mesh" }) =>
  ok({ status: "succeeded", progress: 1, stage: "done", result });
function apiWith(
  invoke: (
    command: string,
    args: Record<string, unknown>,
  ) => Promise<ApiResult>,
) {
  return {
    invoke: (command: string, args: Record<string, unknown> = {}) =>
      invoke(command, args),
    currentRevision: vi.fn(() => 7),
  } satisfies Pick<ApplicationApi, "invoke" | "currentRevision">;
}
afterEach(() => {
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("retains an inspected CAD reference revision instead of silently refreshing it", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "cad-job" }),
  );
  const api = apiWith(invoke);
  await runApplicationJobCommand(
    api,
    "cad_create",
    { name: "Fillet", recipe: {} },
    {
      expectedRevision: 3,
      cancelledMessage: "cancelled",
      leaseMessage: "expired",
    },
  );
  expect(invoke.mock.calls[0][1].expectedRevision).toBe(3);
  expect(api.currentRevision).not.toHaveBeenCalled();
});

it("routes the GUI reconstruction branch through the shared application job", () => {
  const app = readFileSync(
    new URL("../src/ui/App.tsx", import.meta.url),
    "utf8",
  );
  expect(app).toContain('parameters.kind === "repolygonize"');
  expect(app).toMatch(/runReconstructionCommand\(\s*workspaceApi/);
});

it("dispatches only the public reconstruction job with captured revision and request identity", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "job" }),
  );
  const api = apiWith(invoke);
  const args = { entityId: "source", targetIds: ["other"], resolution: 0.25 };
  const before = structuredClone(args);
  expect(await runReconstructionCommand(api, args)).toEqual({
    entityId: "new-mesh",
  });
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "mesh_process",
    "job_get",
  ]);
  expect(invoke.mock.calls[0][1]).toEqual({
    entityId: "source",
    targetIds: ["other"],
    operation: {
      kind: "scanTools",
      operation: { kind: "repolygonize", resolution: 0.25 },
    },
    expectedRevision: 7,
    requestId: expect.any(String),
  });
  expect(invoke.mock.calls[0][1].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(api.currentRevision).toHaveBeenCalledOnce();
  expect(args).toEqual(before);
});

it("omits optional public arguments and leaves reconstruction defaults to the executor", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "job" }),
  );
  await runReconstructionCommand(apiWith(invoke), { entityId: "source" });
  expect(invoke.mock.calls[0][1]).toEqual({
    entityId: "source",
    operation: { kind: "scanTools", operation: { kind: "repolygonize" } },
    expectedRevision: 7,
    requestId: expect.any(String),
  });
});

it("reports running and terminal progress without refreshing revision", async () => {
  vi.useFakeTimers();
  let polls = 0;
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command !== "job_get"
        ? ok({ jobId: "job" })
        : ++polls === 1
          ? ok({ status: "running", progress: 0.4, stage: "reconstructing" })
          : done(),
  );
  const api = apiWith(invoke),
    onProgress = vi.fn();
  const pending = runReconstructionCommand(
    api,
    { entityId: "source" },
    { onProgress },
  );
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(onProgress.mock.calls).toEqual([
    [0.4, "reconstructing"],
    [1, "done"],
  ]);
  expect(api.currentRevision).toHaveBeenCalledOnce();
  expect(
    invoke.mock.calls
      .slice(1)
      .every(([, args]) => JSON.stringify(args) === '{"jobId":"job"}'),
  ).toBe(true);
});

it.each(["failed", "cancelled"])(
  "surfaces %s terminal errors without another mutation",
  async (status) => {
    const invoke = vi.fn(
      async (command: string, _args: Record<string, unknown>) =>
        command === "job_get"
          ? ok({
              status,
              progress: 0.5,
              stage: "stopped",
              error: { message: "specific failure" },
            })
          : ok({ jobId: "job" }),
    );
    await expect(
      runReconstructionCommand(apiWith(invoke), { entityId: "source" }),
    ).rejects.toThrow("specific failure");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "mesh_process",
      "job_get",
    ]);
  },
);

it("surfaces submission and polling API errors", async () => {
  const failure = {
    ok: false as const,
    revision: 7,
    error: { code: "CONFLICT", message: "revision changed" },
  };
  await expect(
    runReconstructionCommand(apiWith(vi.fn(async () => failure)), {
      entityId: "source",
    }),
  ).rejects.toThrow("revision changed");
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? failure : ok({ jobId: "job" }),
  );
  await expect(
    runReconstructionCommand(apiWith(invoke), { entityId: "source" }),
  ).rejects.toThrow("revision changed");
  expect(
    invoke.mock.calls.filter(([command]) => command === "job_cancel"),
  ).toHaveLength(1);
});

it("cancels a running job if its progress callback throws", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get"
        ? ok({ status: "running", progress: 0.4, stage: "working" })
        : ok({ jobId: "job" }),
  );
  await expect(
    runReconstructionCommand(
      apiWith(invoke),
      { entityId: "source" },
      {
        onProgress: () => {
          throw Error("observer failed");
        },
      },
    ),
  ).rejects.toThrow("observer failed");
  expect(
    invoke.mock.calls.filter(([command]) => command === "job_cancel"),
  ).toHaveLength(1);
});

it("does not submit already aborted work", async () => {
  const controller = new AbortController();
  controller.abort();
  const invoke = vi.fn(async () => ok({}));
  await expect(
    runReconstructionCommand(
      apiWith(invoke),
      { entityId: "source" },
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("cancels a job when abort raced with its receipt, without polling or publishing", async () => {
  const controller = new AbortController();
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) => {
      if (command === "mesh_process") controller.abort();
      return command === "job_get" ? done() : ok({ jobId: "job" });
    },
  );
  await expect(
    runReconstructionCommand(
      apiWith(invoke),
      { entityId: "source" },
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "mesh_process",
    "job_cancel",
  ]);
});

it("cancels during an in-flight poll and removes the abort listener", async () => {
  vi.useFakeTimers();
  const controller = new AbortController(),
    remove = vi.spyOn(controller.signal, "removeEventListener");
  const invoke = vi.fn((command: string, _args: Record<string, unknown>) =>
    command === "job_get"
      ? new Promise<never>(() => {})
      : Promise.resolve(ok({ jobId: "job" })),
  );
  const pending = runReconstructionCommand(
    apiWith(invoke),
    { entityId: "source" },
    { signal: controller.signal },
  );
  const rejection = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejection;
  expect(
    invoke.mock.calls.filter(([command]) => command === "job_cancel"),
  ).toHaveLength(1);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("returns authoritative success even if terminal progress triggers abort", async () => {
  const controller = new AbortController();
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "job" }),
  );
  await expect(
    runReconstructionCommand(
      apiWith(invoke),
      { entityId: "source" },
      {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
    ),
  ).resolves.toEqual({ entityId: "new-mesh" });
  expect(
    invoke.mock.calls.filter(([command]) => command === "job_cancel"),
  ).toHaveLength(0);
});

it("cancels an in-flight poll at the bounded 15-minute lease", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn((command: string, _args: Record<string, unknown>) =>
    command === "job_get"
      ? new Promise<never>(() => {})
      : Promise.resolve(ok({ jobId: "job" })),
  );
  const pending = runReconstructionCommand(apiWith(invoke), {
    entityId: "source",
  });
  const rejection = expect(pending).rejects.toThrow(/Reconstruction.*lease/);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  await rejection;
  expect(
    invoke.mock.calls.filter(([command]) => command === "job_cancel"),
  ).toHaveLength(1);
});

it("keeps ShrinkWrap messages and routes its wrapper through the same lifecycle", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get"
        ? ok({ status: "cancelled", progress: 0, stage: "cancelled" })
        : ok({ jobId: "job" }),
  );
  await expect(
    runShrinkwrapPreviewCommand(apiWith(invoke), { action: "create" }),
  ).rejects.toThrow("ShrinkWrap operation cancelled.");
  expect(invoke.mock.calls[0][0]).toBe("scan_preview");
  const other = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done({ shared: true }) : ok({ jobId: "job" }),
  );
  expect(
    await runApplicationJobCommand(
      apiWith(other),
      "mesh_process",
      {},
      {
        cancelledMessage: "Stopped",
        leaseMessage: "Lease expired",
      },
    ),
  ).toEqual({ shared: true });
});

it("preserves ShrinkWrap's exact lease message and clears successful abort subscriptions", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn((command: string, _args: Record<string, unknown>) =>
    command === "job_get"
      ? new Promise<never>(() => {})
      : Promise.resolve(ok({ jobId: "job" })),
  );
  const pending = runShrinkwrapPreviewCommand(apiWith(invoke), {
    action: "create",
  });
  const rejected = expect(pending).rejects.toThrow(
    "ShrinkWrap reached its operation lease; retry with a smaller region.",
  );
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  await rejected;
  const controller = new AbortController();
  const completed = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "job" }),
  );
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  await runShrinkwrapPreviewCommand(
    apiWith(completed),
    { action: "compare" },
    { signal: controller.signal },
  );
  controller.abort();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(completed.mock.calls.map(([command]) => command)).toEqual([
    "scan_preview",
    "job_get",
  ]);
});

it("uses a fresh guarded request ID for each submission and ignores caller revision overrides", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) =>
      command === "job_get" ? done() : ok({ jobId: "job" }),
  );
  const api = apiWith(invoke);
  for (let i = 0; i < 2; i++)
    await runApplicationJobCommand(
      api,
      "scan_preview",
      {
        expectedRevision: -1,
        requestId: "caller-value",
      },
      { cancelledMessage: "Stopped", leaseMessage: "Expired" },
    );
  const submissions = invoke.mock.calls.filter(
    ([command]) => command === "scan_preview",
  );
  expect(submissions.map(([, args]) => args.expectedRevision)).toEqual([7, 7]);
  expect(submissions[0][1].requestId).not.toBe(submissions[1][1].requestId);
  expect(submissions[0][1].requestId).not.toBe("caller-value");
});
