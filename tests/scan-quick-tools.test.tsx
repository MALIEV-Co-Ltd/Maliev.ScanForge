import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanQuickTools } from "../src/ui/ScanQuickTools";

it("exposes selection actions while keeping unrecovered geometry tools unavailable", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    <ScanQuickTools
      x={300}
      y={250}
      onDelete={noop}
      onHide={noop}
      onIsolate={noop}
      onInvert={noop}
      onClear={noop}
    />,
  );
  expect(html).toContain('role="toolbar"');
  for (const label of [
    "Delete selected",
    "Hide selected",
    "Isolate selected",
    "Invert selection",
    "Deselect all",
  ])
    expect(html).toContain(`aria-label="${label}"`);
  expect(html).toMatch(/aria-label="Defeature" disabled/);
  expect(html).toMatch(/aria-label="Smooth" disabled/);
});
