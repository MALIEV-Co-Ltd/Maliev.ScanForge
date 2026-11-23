import { afterEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import type { Entity } from "../src/types";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it.each([
  { cores: 8, expectedPeak: 2, reason: "parallel" },
  { cores: 2, expectedPeak: 1, reason: "cpu" },
])(
  "publishes every result with MCP admission reason $reason",
  async ({ cores, expectedPeak, reason }) => {
    vi.stubGlobal("navigator", { hardwareConcurrency: cores, deviceMemory: 8 });
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
        expect(view).toHaveBeenCalledTimes(entities.length);
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
    expect(peak).toBe(expectedPeak);
    expect(
      progress.mock.calls.every(
        (call) => call[2]?.admission?.concurrency === expectedPeak,
      ),
    ).toBe(true);
    expect(commits).toEqual([1, 2]);
    expect(entities.map((entity) => entity.name).sort()).toEqual([
      "a.stl",
      "b.stl",
    ]);
    expect(view).toHaveBeenCalledTimes(2);
    expect(view.mock.calls).toEqual([["fit"], ["fit"]]);
    expect(result).toMatchObject({
      admission: { concurrency: expectedPeak, reason },
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
    ).toBe(expectedPeak === 2);
  },
);

it("frames the completed point cloud even when the remaining batch is cancelled", async () => {
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  const controller = new AbortController();
  let entities: Entity[] = [];
  vi.mocked(importScan).mockImplementation(async (file, options) => {
    if (file.name === "second.asc")
      await new Promise((_, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    options?.onPointCloud?.({});
    return new Float32Array([5000, -3000, 200, 5010, -2990, 210]);
  });
  const view = vi.fn();
  const host = {
    snapshot: () => ({ entities }),
    commit: (next: Entity[]) => {
      entities = next;
    },
    select: vi.fn(),
    view,
    present: async () => {
      expect(view).toHaveBeenCalledExactlyOnceWith("fit");
      controller.abort();
    },
  } as unknown as WorkspaceHost;
  const context = {
    signal: controller.signal,
    check: () => controller.signal.throwIfAborted(),
    mutate: (write: () => void) => {
      controller.signal.throwIfAborted();
      write();
    },
    progress: vi.fn(),
    artifactBlob: (name: string) => new File(["scan"], name),
  } as unknown as CommandContext;
  await expect(
    createOperations(host).project_import_batch(
      { artifactIds: ["first.asc", "second.asc"] },
      context,
    ),
  ).rejects.toThrow("Import batch cancelled");
  expect(entities).toHaveLength(1);
  expect(entities[0].kind).toBe("pointcloud");
  expect(view).toHaveBeenCalledTimes(1);
});
