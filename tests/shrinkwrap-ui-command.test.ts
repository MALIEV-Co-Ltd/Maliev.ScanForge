import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  cancelShrinkwrapOperation,
  runShrinkwrapPreviewCommand,
} from "../src/ui/shrinkwrap-preview-command";
it("GUI routes every ShrinkWrap phase through the discoverable shared lifecycle", async () => {
  const invoke = vi.fn(
    async (command: string, args: Record<string, unknown>) =>
      command === "job_get"
        ? {
            ok: true as const,
            revision: 3,
            result: {
              status: "succeeded",
              result: { previewId: "shared" },
              progress: 1,
              stage: "done",
            },
          }
        : { ok: true as const, revision: 3, result: { jobId: "job" } },
  );
  for (const action of ["create", "compare", "accept"])
    expect(
      await runShrinkwrapPreviewCommand(
        { invoke, currentRevision: () => 3 },
        { action, entityId: "mesh" },
      ),
    ).toEqual({ previewId: "shared" });
  expect(
    invoke.mock.calls
      .filter(([command]) => command === "scan_preview")
      .map(([, args]) => args.action),
  ).toEqual(["create", "compare", "accept"]);
  const app = readFileSync(
    new URL("../src/ui/App.tsx", import.meta.url),
    "utf8",
  );
  expect(app).toContain('parameters.kind === "shrinkwrap"');
  expect(app).toContain("runScanPreviewCommand(workspaceApi");
  expect(app).toContain("workspaceApi.discardScanPreview()");
  expect(app).toMatch(
    /cancelShrinkwrapOperation\(\s*workspaceApi,\s*scanToolAbort\.current,?\s*\)/,
  );
});

it("GUI Cancel operation cancels a shared MCP job without requiring a GUI controller", () => {
  const api = { cancelActive: vi.fn(), discardScanPreview: vi.fn() };
  cancelShrinkwrapOperation(api, null);
  expect(api.cancelActive).toHaveBeenCalledOnce();
  expect(api.discardScanPreview).toHaveBeenCalledOnce();
  const controller = new AbortController();
  cancelShrinkwrapOperation(api, controller);
  expect(controller.signal.aborted).toBe(true);
});
