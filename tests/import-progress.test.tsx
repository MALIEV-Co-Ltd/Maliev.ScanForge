import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportProgress } from "../src/ui/ImportProgress";

it("shows the real import percentage with a compact cancellable progressbar", () => {
  const html = renderToStaticMarkup(
    <ImportProgress name="scan.stl" fraction={0.48} onCancel={() => {}} />,
  );
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="48"');
  expect(html).toContain("width:48%");
  expect(html).toContain("48%");
  expect(html).toContain('aria-label="Cancel import"');
});
it("does not invent a percentage for importers without progress reports", () => {
  const html = renderToStaticMarkup(
    <ImportProgress name="part.step" fraction={null} />,
  );
  expect(html).toContain("indeterminate");
  expect(html).not.toContain("aria-valuenow");
  expect(html).not.toContain("Cancel import");
});
