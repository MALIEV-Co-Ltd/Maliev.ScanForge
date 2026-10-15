import { expect, it, vi } from "vitest";
import { createInteractiveEditor } from "../src/automation/interactive-editor";
it("binds dialog and pointer edits to the latest shared session version and fresh retry receipts", async () => {
  let state: { sessionId: string; version: number } | null = {
    sessionId: "one",
    version: 2,
  };
  const invoke = vi.fn(
    async (_command: string, _args?: Record<string, unknown>) => ({
      ok: true as const,
      revision: 7,
      result: { accepted: true },
    }),
  );
  const editor = createInteractiveEditor(
    { invoke, currentRevision: () => 7 },
    () => state,
  );
  expect(
    await editor.edit({
      action: "drag",
      handle: 4,
      from: [0.1, 0.1],
      to: [0.2, 0.2],
    }),
  ).toMatchObject({ accepted: true });
  state = { sessionId: "one", version: 3 };
  await editor.edit({ action: "reset" });
  expect(invoke.mock.calls[0][1]).toMatchObject({
    sessionId: "one",
    expectedSessionVersion: 2,
    expectedRevision: 7,
  });
  expect(invoke.mock.calls[1][1]).toMatchObject({ expectedSessionVersion: 3 });
  expect(invoke.mock.calls[0][1]!.requestId).not.toBe(
    invoke.mock.calls[1][1]!.requestId,
  );
  state = null;
  await expect(editor.edit({ action: "reset" })).rejects.toThrow(
    /Begin Interactive/,
  );
});
it("uses the shared cancel tool and waits for Apply job completion", async () => {
  const invoke = vi.fn(
    async (command: string, _args?: Record<string, unknown>) => ({
      ok: true as const,
      revision: 1,
      result:
        command === "interactive_alignment_apply"
          ? { jobId: "job" }
          : command === "job_get"
            ? { status: "succeeded", result: { applied: true } }
            : { cancellationRequested: true },
    }),
  );
  const editor = createInteractiveEditor(
    { invoke, currentRevision: () => 1 },
    () => ({ sessionId: "one", version: 0 }),
  );
  expect(await editor.apply()).toMatchObject({ applied: true });
  expect(invoke.mock.calls.map((c) => c[0])).toEqual([
    "interactive_alignment_apply",
    "job_get",
  ]);
  await editor.cancel();
  expect(invoke.mock.calls.at(-1)).toEqual([
    "preview_discard",
    expect.objectContaining({ target: "interactive" }),
  ]);
});
