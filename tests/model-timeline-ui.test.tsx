import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ribbonCommandPalette } from "../src/ui/RibbonCommandIcon";
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
  expect(html).not.toContain("<img");
  expect(html).toContain('data-artwork="open"');
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

it("keeps only four navigation buttons and gives operation tracks the toolbar palette", () => {
  const html = renderToStaticMarkup(
    <ModelTimeline
      labels={[
        "Delete triangles",
        "Create freeform",
        "Create plane",
        "Extrude sketch",
      ]}
      cursor={2}
      disabled={false}
      onSeek={() => {}}
      onContextMenu={() => {}}
    />,
  );
  const toolbar = html.slice(
    html.indexOf('role="toolbar"'),
    html.indexOf('class="timeline-track"'),
  );
  expect(toolbar.match(/<button/g)).toHaveLength(4);
  expect(html).not.toContain("Scroll timeline left");
  expect(html).not.toContain("Scroll timeline right");
  expect(html).toContain("Middle-drag pans");
  for (const command of ["editScan", "newFreeform", "fitPlane", "extrude"])
    expect(html).toContain(
      `--timeline-operation-color:${ribbonCommandPalette(command).base}`,
    );
});
