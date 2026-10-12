import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen } from "lucide-react";
import { HeaderIconButton } from "../src/ui/HeaderIconButton";
import { SaveProjectButton } from "../src/ui/SaveProjectButton";
import { SaveReminderClock } from "../src/ui/save-reminder";
import { SpaceMouseIcon } from "../src/ui/SpaceMouseIcon";

it("keeps header actions icon-only with accessible names, hover labels and the actual callback", () => {
  const onClick = vi.fn();
  const button = HeaderIconButton({
    label: "Open scan",
    onClick,
    children: <FolderOpen />,
  });
  button.props.onClick();
  expect(onClick).toHaveBeenCalledOnce();
  const html = renderToStaticMarkup(button);
  expect(html).toContain('aria-label="Open scan"');
  expect(html).toContain('class="header-tooltip" role="tooltip">Open scan');
  expect(html).toContain("lucide-folder-open");
  expect(
    renderToStaticMarkup(
      <HeaderIconButton label="Open scan" disabled onClick={() => {}}>
        <FolderOpen />
      </HeaderIconButton>,
    ),
  ).toContain('disabled=""');
});
it("counts the oldest unsaved change and resets on a successful clean/save state", () => {
  const clock = new SaveReminderClock();
  expect(clock.message(0)).toBeUndefined();
  clock.setDirty(true, 0);
  expect(clock.message(59_999)).toBe("Unsaved · less than a minute");
  expect(clock.message(60_000)).toBe("Unsaved for 1 minute");
  clock.setDirty(true, 90_000);
  expect(clock.message(120_000)).toBe("Unsaved for 2 minutes");
  clock.setDirty(false, 130_000);
  expect(clock.message(200_000)).toBeUndefined();
  clock.setDirty(true, 200_000);
  expect(clock.message(210_000)).toBe("Unsaved · less than a minute");
});
it("does not invent unsaved time for a clean or newly opened project", () => {
  const clean = renderToStaticMarkup(
    <SaveProjectButton dirty={false} disabled={false} onSave={() => {}} />,
  );
  expect(clean).not.toContain("needs-save");
  expect(clean).not.toContain("save-reminder");
  const dirty = renderToStaticMarkup(
    <SaveProjectButton dirty disabled={false} onSave={() => {}} />,
  );
  expect(dirty).toContain("needs-save");
  expect(dirty).toContain('aria-label="Save project"');
});
it("draws a short SpaceMouse cap and base instead of joystick artwork", () => {
  const icon = renderToStaticMarkup(<SpaceMouseIcon />);
  expect(icon).toContain('data-icon="spacemouse"');
  expect(icon).toContain("<ellipse");
  expect(icon).not.toContain("joystick");
});
