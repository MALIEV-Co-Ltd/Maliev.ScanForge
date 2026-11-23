import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSession } from "../src/project-file";

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[],
  cursor: 0,
}));
vi.mock("react", () => ({
  useRef: (initial: unknown) =>
    (hooks.refs[hooks.cursor++] ??= { current: initial }),
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock("../src/project-backup", async (original) => ({
  ...(await original<typeof import("../src/project-backup")>()),
  listBackups: vi.fn(async () => []),
}));
import { IntervalBackupController } from "../src/project-backup";
import { useProjectBackups } from "../src/ui/useProjectBackups";

afterEach(() => {
  hooks.refs = [];
  hooks.effects = [];
  hooks.cursor = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("updates the pending backup on document replacement before the next interval", () => {
  vi.useFakeTimers();
  const update = vi.spyOn(IntervalBackupController.prototype, "update");
  const tick = vi.spyOn(IntervalBackupController.prototype, "tick");
  const session = (projectId?: string) =>
    ({
      projectId,
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: projectId ?? "Empty",
        entities: [],
        authoring: {},
      },
      history: [],
      future: [],
    }) as ProjectSession;
  const old = session("old");
  useProjectBackups(old, true);
  const effects = hooks.effects.splice(0);
  const cleanup = effects[0]();
  try {
    effects[1]();
    expect(update).toHaveBeenLastCalledWith(
      "old",
      old,
      expect.any(Array),
      true,
    );
    hooks.cursor = 0;
    const next = session("new");
    useProjectBackups(next, true);
    hooks.effects.splice(0)[1]();
    expect(update).toHaveBeenLastCalledWith(
      "new",
      next,
      expect.any(Array),
      true,
    );
    hooks.cursor = 0;
    const empty = session();
    useProjectBackups(empty, true);
    hooks.effects.splice(0)[1]();
    expect(update).toHaveBeenLastCalledWith(
      "",
      empty,
      expect.any(Array),
      false,
    );
    expect(tick).not.toHaveBeenCalled();
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
});
