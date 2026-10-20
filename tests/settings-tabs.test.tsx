import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { SettingsTabs } from "../src/ui/SettingsTabs";

it("associates each category with its panel and keeps one tab in keyboard focus order", () => {
  const html = renderToStaticMarkup(
    <SettingsTabs value="spacemouse" onChange={() => {}} />,
  );
  expect(html).toContain('aria-label="Settings categories"');
  expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  for (const category of ["appearance", "spacemouse", "import", "agents"])
    expect(html).toContain(`aria-controls="settings-panel-${category}"`);
});

it.each([
  ["ArrowLeft", "appearance", "agents"],
  ["ArrowRight", "agents", "appearance"],
  ["Home", "import", "appearance"],
  ["End", "appearance", "agents"],
] as const)("supports %s navigation from %s to %s", (key, value, expected) => {
  const onChange = vi.fn(),
    focus = vi.fn(),
    preventDefault = vi.fn();
  const querySelector = vi.fn(() => ({ focus }));
  const element = SettingsTabs({ value, onChange });
  element.props.onKeyDown({
    key,
    preventDefault,
    currentTarget: { querySelector },
  } as unknown as KeyboardEvent<HTMLDivElement>);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
});
