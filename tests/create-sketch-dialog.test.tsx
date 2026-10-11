import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateSketchDialog } from "../src/ui/CreateSketchDialog";
import { SketchTools } from "../src/ui/SketchTools";
import { coordinateSketchFrame } from "../src/sketch-frame";
it("keeps Cancel available while extracting and gates creation on a current preview", () => {
  const html = renderToStaticMarkup(
    <CreateSketchDialog
      source={{
        id: "scan",
        name: "Scan",
        kind: "mesh",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        color: "#aaaaaa",
        visible: true,
        opacity: 1,
      }}
      busy
      onApply={() => {}}
      onCreate={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Create Sketch"');
  expect(html).toContain("Through selection only");
  expect(html).toContain('disabled="">Create');
  expect(html).toContain("<button>Cancel</button>");
});
it("renders large reference samples as one path without converting them to editable curves", () => {
  const segments: number[] = [];
  for (let i = 0; i < 65000; i++) segments.push(i, 0, i, 1);
  const html = renderToStaticMarkup(
    <SketchTools
      value={{
        version: 1,
        points: [],
        segments: [],
        constraints: [],
        frame: coordinateSketchFrame("OXY", 2),
        reference: {
          kind: "section",
          sourceId: "scan",
          axis: "z",
          offset: 2,
          onSlicingPlane: true,
          selectedOnly: false,
          sampled: false,
          segments,
        },
      }}
      onExtrude={() => {}}
    />,
  );
  expect(html.match(/aria-label="Scan section references"/g)).toHaveLength(1);
  expect(html).not.toContain("Remove segment");
});
