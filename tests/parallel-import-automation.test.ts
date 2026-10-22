import { afterEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import type { Entity } from "../src/types";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("publishes every parallel result against current state with structured MCP progress", async () => {
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  let entities: Entity[] = [];
  let active = 0,
    peak = 0;
  vi.mocked(importScan).mockImplementation(async (file, options) => {
    peak = Math.max(peak, ++active);
    options?.onProgress?.(0.4);
    await new Promise((resolve) =>
      setTimeout(resolve, file.name === "a.stl" ? 20 : 1),
    );
    active--;
    if (file.name === "bad.stl") throw Error("Invalid scan");
    return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  const view = vi.fn(),
    progress = vi.fn(),
    commits: number[] = [];
  const host = {
    snapshot: () => ({ entities }),
    commit: (next: Entity[]) => {
      entities = next;
      commits.push(next.length);
    },
    select: vi.fn(),
    view,
    present: async () => {
      await Promise.resolve();
    },
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    mutate: (write: () => void) => write(),
    progress,
    artifactBlob: (name: string) => new File(["scan"], name),
  } as unknown as CommandContext;
  const result = await createOperations(host).project_import_batch(
    { artifactIds: ["a.stl", "bad.stl", "b.stl"] },
    context,
  );
  expect(peak).toBe(2);
  expect(commits).toEqual([1, 2]);
  expect(entities.map((entity) => entity.name).sort()).toEqual([
    "a.stl",
    "b.stl",
  ]);
  expect(view).toHaveBeenCalledExactlyOnceWith("fit");
  expect(result).toMatchObject({
    completed: [{ triangles: 1 }, { triangles: 1 }],
    failed: [{ index: 1, error: "Invalid scan" }],
    cancelled: false,
  });
  expect(
    progress.mock.calls.some(
      (call) =>
        call[2]?.kind === "importBatch" &&
        call[2].files.filter((file: any) => file.status === "importing")
          .length === 2,
    ),
  ).toBe(true);
});
