import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasError } from "../src/ui/CanvasError";
import { reportedHeapBytes, StatusMetrics } from "../src/ui/StatusMetrics";

it("shows a dismissible canvas alert only when an error exists", () => {
  expect(
    renderToStaticMarkup(<CanvasError message="" onDismiss={() => {}} />),
  ).toBe("");
  const html = renderToStaticMarkup(
    <CanvasError message="Could not close seam" onDismiss={() => {}} />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-label="Dismiss error"');
  expect(html).toContain("Could not close seam");
});

it("reports selected object facets and distinguishes missing selection", () => {
  expect(renderToStaticMarkup(<StatusMetrics facets={30580} />)).toContain(
    "Facets: 30,580",
  );
  expect(renderToStaticMarkup(<StatusMetrics />)).toContain("Facets: —");
  expect(renderToStaticMarkup(<StatusMetrics facets={0} />)).toContain(
    "Facets: 0",
  );
});

it("reports only valid browser heap readings, leaving unsupported readings unavailable", () => {
  expect(reportedHeapBytes({ memory: { usedJSHeapSize: 1048576 } })).toBe(
    1048576,
  );
  expect(reportedHeapBytes({ memory: { usedJSHeapSize: 0 } })).toBe(0);
  for (const source of [
    undefined,
    {},
    { memory: {} },
    { memory: { usedJSHeapSize: NaN } },
    { memory: { usedJSHeapSize: -1 } },
    { memory: { usedJSHeapSize: "100" } },
  ])
    expect(reportedHeapBytes(source)).toBeUndefined();
});

it("reports points without a facet label for the selected point cloud", () => {
  const html = renderToStaticMarkup(<StatusMetrics points={30580} />);
  expect(html).toContain("Points: 30,580");
  expect(html).not.toContain("Facets:");
});
