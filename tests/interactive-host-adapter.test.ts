import { expect, it, vi } from "vitest";
import { interactiveHostAdapter } from "../src/automation/interactive-host-adapter";
import type { WorkspaceHost } from "../src/automation/api";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
it("flushes only opening and closing, forwarding frame updates without root React work", () => {
  let state: InteractiveAlignmentState | null = null;
  let host = {
    publishInteractive: vi.fn((next: InteractiveAlignmentState | null) => {
      state = next;
    }),
    inspectInteractive: () => state,
  } as unknown as WorkspaceHost;
  const flush = vi.fn((write: () => void) => write());
  const adapter = interactiveHostAdapter(() => host, flush);
  const first = { version: 0 } as InteractiveAlignmentState;
  adapter.publishInteractive!(first);
  expect(flush).toHaveBeenCalledOnce();
  for (let version = 1; version <= 60; version++)
    adapter.publishInteractive!({ ...first, version });
  expect(flush).toHaveBeenCalledOnce();
  expect(adapter.inspectInteractive!()?.version).toBe(60);
  adapter.publishInteractive!(null);
  expect(flush).toHaveBeenCalledTimes(2);
  const next = vi.fn();
  host = { ...host, publishInteractive: next };
  adapter.publishInteractive!(first);
  expect(next).toHaveBeenCalledWith(first);
});
it("reports unavailable callbacks accurately and forwards native inputs and nullable threshold results", () => {
  let host = {} as WorkspaceHost;
  const adapter = interactiveHostAdapter(
    () => host,
    (write) => write(),
  );
  expect(adapter.publishInteractive).toBeUndefined();
  expect(adapter.interactiveDragInput).toBeUndefined();
  expect(adapter.interactiveViewFrame).toBeUndefined();
  const drag = vi.fn(() => null);
  host = { ...host, interactiveDragInput: drag };
  const input = {
    handle: 4,
    from: [0.5, 0.5],
    to: [0.505, 0.5],
    pivot: [0, 0, 0],
    strength: 100,
  };
  expect(adapter.interactiveDragInput!(input)).toBe(null);
  expect(drag).toHaveBeenCalledWith(input);
});
