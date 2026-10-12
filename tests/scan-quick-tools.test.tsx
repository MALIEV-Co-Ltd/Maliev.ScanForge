import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanQuickTools } from "../src/ui/ScanQuickTools";

it("exposes selection actions and enables geometry tools only with working callbacks", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    <ScanQuickTools
      x={300}
      y={250}
      onDelete={noop}
      onHide={noop}
      onIsolate={noop}
      onInvert={noop}
    />,
  );
  expect(html).toContain('role="toolbar"');
  for (const label of [
    "Delete selected",
    "Hide selected",
    "Isolate selected",
    "Invert selection",
  ])
    expect(html).toContain(`aria-label="${label}"`);
  expect(html).toMatch(/aria-label="Defeature" disabled/);
  expect(html).toMatch(/aria-label="Smooth selected" disabled/);
  const labels = Array.from(
    html.matchAll(/<button[^>]*aria-label="([^"]+)"/g),
    (match) => match[1],
  );
  expect(labels).toEqual([
    "Delete selected",
    "Defeature",
    "Smooth selected",
    "Hide selected",
    "Invert selection",
    "Isolate selected",
  ]);
  const available = renderToStaticMarkup(
    <ScanQuickTools
      x={300}
      y={250}
      onDelete={noop}
      onHide={noop}
      onIsolate={noop}
      onInvert={noop}
      onSmooth={noop}
      onDefeature={noop}
    />,
  );
  expect(available).not.toMatch(/aria-label="Defeature" disabled/);
  expect(available).not.toMatch(/aria-label="Smooth selected" disabled/);
});
