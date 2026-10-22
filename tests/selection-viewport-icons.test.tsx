import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanToolIcon } from "../src/ui/ScanToolIcon";
import { ViewportTools } from "../src/ui/ViewportTools";

it("uses generated raster artwork for selection expansion, contraction, clipping and saving", () => {
  for (const name of ["grow", "shrink", "clip", "save"] as const) {
    const html = renderToStaticMarkup(<ScanToolIcon name={name} size={36} />);
    expect(html).not.toContain("<svg");
    expect(html).toContain(`data-scan-icon="${name}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="36"');
    expect(html).toContain("<img");
  }
});

it("illustrates all seven viewport actions while preserving labels, state and disabled selection", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    <ViewportTools
      flat
      grid
      normals
      spacing={10}
      automatic={true}
      onAutomatic={() => {}}
      snap={false}
      hasSelection={false}
      onFlat={noop}
      onGrid={noop}
      onSpacing={noop}
      onSnap={noop}
      onFitSelection={noop}
      onFitAll={noop}
    />,
  );
  for (const kind of [
    "normals",
    "flat",
    "smooth",
    "grid",
    "snap",
    "selection",
    "all",
  ]) {
    expect(html).toContain(`data-viewport-icon="${kind}"`);
  }
  expect(html.match(/<img /g)).toHaveLength(7);
  expect(html).toContain("<img");
  expect(html).toContain('aria-label="Normals"');
  expect(html).toContain('aria-label="Fit selection"');
  expect(html).toContain('disabled=""');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
});

it("gives every mesh action nonempty, distinct artwork, including connected and boundary selection", () => {
  const names = [
    "wand",
    "brush",
    "freehand",
    "line",
    "rectangle",
    "circle",
    "through",
    "grow",
    "shrink",
    "boundary",
    "all",
    "isolate",
    "hide",
    "reveal",
    "revealSelected",
    "invert",
    "clear",
    "clip",
    "save",
    "cut",
    "copy",
    "delete",
    "smooth",
    "defeature",
    "split",
    "components",
    "connected",
    "holes",
    "boundaries",
  ] as const;
  const artwork = names.map((name) => {
    const html = renderToStaticMarkup(<ScanToolIcon name={name} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('draggable="false"');
    expect(html).toContain(`/icons/generated/scan-${name}.png`);
    expect(html).not.toMatch(/<svg|<image|<filter|<linearGradient/);
    return html.replace(/data-scan-icon="[^"]*"/, "");
  });
  expect(new Set(artwork).size).toBe(names.length);
});
