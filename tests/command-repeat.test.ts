import { expect, it, vi } from "vitest";
import { CommandRepeat } from "../src/command-repeat";
import { resolveKeyboardShortcut } from "../src/keyboard-shortcuts";

it("repeats the identity with the latest selection and preserves it across unavailable commands", () => {
  const repeat = new CommandRepeat();
  expect(() => repeat.run()).toThrow("No previous");
  const first = vi.fn(),
    second = vi.fn();
  repeat.configure({ fit: first }, () => false);
  repeat.run("fit");
  repeat.configure({ fit: second }, () => false);
  repeat.run();
  repeat.run();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  expect(() => repeat.run("delete")).toThrow("unavailable");
  expect(() => repeat.run("toString")).toThrow("unavailable");
  repeat.configure({ fit: undefined }, () => false);
  expect(repeat.inspect().canRepeat).toBe(false);
  expect(() => repeat.run()).toThrow("unavailable");
  expect(repeat.inspect().lastCommand).toBe("fit");
  repeat.configure({ fit: second }, () => true);
  expect(repeat.inspect().canRepeat).toBe(false);
  expect(() => repeat.run()).toThrow("active operation");
  expect(second).toHaveBeenCalledTimes(2);
});

it("Space uses the normal editing, modal, busy and held-key guards", () => {
  const context = {
    mode: "main" as const,
    allowExtensions: true,
    availableActions: new Set(["repeat-command" as const]),
  };
  const event = { key: " ", code: "Space" };
  expect(resolveKeyboardShortcut(event, context)).toEqual({
    id: "repeat-command",
  });
  for (const patch of [
    { busy: true },
    { modalOpen: true },
    { textEditing: true },
    { availableActions: new Set<never>() },
  ])
    expect(resolveKeyboardShortcut(event, { ...context, ...patch })).toBeNull();
  for (const patch of [
    { repeat: true },
    { ctrlKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])
    expect(resolveKeyboardShortcut({ ...event, ...patch }, context)).toBeNull();
});
