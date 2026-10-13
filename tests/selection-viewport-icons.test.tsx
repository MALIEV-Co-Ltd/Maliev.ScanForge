import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanToolIcon } from "../src/ui/ScanToolIcon";
import { ViewportTools } from "../src/ui/ViewportTools";

it("uses generated artwork for selection expansion, contraction, clipping and saving", () => {
  for (const name of ["grow", "shrink", "clip", "save"] as const) {
    const html = renderToStaticMarkup(<ScanToolIcon name={name} size={36} />);
    expect(html).toContain("<img");
    expect(html).toContain(`data-scan-icon="${name}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="36"');
    expect(html).not.toContain("<svg");
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
  expect(html).not.toContain("<svg");
  expect(html).toContain('aria-label="Normals"');
  expect(html).toContain('aria-label="Fit selection"');
  expect(html).toContain('disabled=""');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
});
