import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FitSurfaceDialog } from "../src/ui/FitSurfaceDialog";
import type { SurfaceFitSession } from "../src/surface-fit-session";
const session: SurfaceFitSession = {
  source: {
    id: "s",
    name: "Scan",
    kind: "mesh",
    positions: [],
    color: "#aaa",
    visible: true,
    opacity: 1,
  },
  scan: [],
  triangles: 5,
};
const noop = () => {};
it("offers documented initial grid counts, staged acceptance and a cancel action during fitting", () => {
  const markup = renderToStaticMarkup(
    <FitSurfaceDialog
      session={session}
      busy
      onApply={noop}
      onAccept={noop}
      onCancel={noop}
    />,
  );
  expect(markup).toContain('aria-label="Fit Surface"');
  expect(markup.match(/value="10"/g)).toHaveLength(2);
  expect(markup).toContain('disabled="">OK');
  expect(markup).toContain("<button>Cancel</button>");
  expect(markup).toContain("Selection-bounds orientation");
});
