import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelTimeline } from "../src/ui/ModelTimeline";
it("renders a compact accessible draggable marker and both past and future steps without a separate range input", () => {
  const html = renderToStaticMarkup(
    <ModelTimeline
      labels={["Opening part", "Delete triangles"]}
      cursor={1}
      disabled={false}
      onSeek={() => {}}
      onContextMenu={() => {}}
    />,
  );
  expect(html).toContain('role="slider"');
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('aria-valuemax="2"');
  expect(html).toContain('aria-valuetext="Opening part"');
  expect(html).toContain("timeline-future");
  expect(html).toContain("2: Delete triangles");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("timeline-position");
});
it("disables step actions and the playhead during processing", () => {
  const html = renderToStaticMarkup(
    <ModelTimeline
      labels={["Opening part"]}
      cursor={0}
      disabled={true}
      onSeek={() => {}}
      onContextMenu={() => {}}
    />,
  );
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toMatch(/aria-label="1: Opening part"[^>]*disabled/);
});
