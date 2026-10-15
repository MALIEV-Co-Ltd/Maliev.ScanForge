import { expect, it, vi } from "vitest";
import { InteractiveGizmoDrag } from "../src/interactive-gizmo-drag";
it("coalesces pending movement while preserving the native threshold anchor", async () => {
  const pending: ((accepted: boolean) => void)[] = [];
  const send = vi.fn(
    () => new Promise<boolean>((resolve) => pending.push(resolve)),
  );
  const drag = new InteractiveGizmoDrag(send, vi.fn());
  drag.begin(4, [0.1, 0.2]);
  drag.move([0.11, 0.2]);
  drag.move([0.12, 0.2]);
  drag.move([0.13, 0.2]);
  expect(send).toHaveBeenCalledTimes(1);
  pending.shift()!(false);
  await Promise.resolve();
  expect(send.mock.calls[1]).toEqual([
    { handle: 4, from: [0.1, 0.2], to: [0.13, 0.2], continuation: false },
  ]);
  drag.move([0.15, 0.2]);
  pending.shift()!(true);
  await Promise.resolve();
  expect(send.mock.calls[2]).toEqual([
    { handle: 4, from: [0.13, 0.2], to: [0.15, 0.2], continuation: true },
  ]);
  drag.end();
  pending.shift()!(true);
  await Promise.resolve();
  expect(drag.active).toBe(false);
});
it("does not let an obsolete response advance a new gesture", async () => {
  let resolve!: (value: boolean) => void;
  const send = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const drag = new InteractiveGizmoDrag(send, vi.fn());
  drag.begin(4, [0, 0]);
  drag.move([0.2, 0]);
  drag.cancel();
  drag.begin(5, [0.3, 0.3]);
  resolve(true);
  await Promise.resolve();
  drag.move([0.4, 0.3]);
  expect(send.mock.calls[1]).toEqual([
    { handle: 5, from: [0.3, 0.3], to: [0.4, 0.3], continuation: false },
  ]);
  drag.cancel();
  resolve(true);
  await Promise.resolve();
});
it("reports a failed shared command once and releases the gesture", async () => {
  const fail = vi.fn();
  const drag = new InteractiveGizmoDrag(async () => {
    throw Error("stale session");
  }, fail);
  drag.begin(10, [0, 0]);
  drag.move([0.2, 0]);
  await Promise.resolve();
  expect(fail).toHaveBeenCalledOnce();
  expect(drag.active).toBe(false);
});
