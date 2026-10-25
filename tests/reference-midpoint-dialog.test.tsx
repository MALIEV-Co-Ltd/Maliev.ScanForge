import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceConstructionDialog } from "../src/ui/ReferenceConstructionDialog";
import type { ApplicationApi } from "../src/automation/api";
import type { Entity } from "../src/types";
it("offers the same midpoint source mode and retained source in the point editor", () => {
  const line: Entity = {
    id: "line",
    name: "Stored line",
    kind: "referenceLine",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
    constructionOrderKey: "01".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start: [0, 0, 0],
        end: [2, 0, 0],
        sources: [],
        records: [],
      },
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 2,
      },
      evaluation: { completionWord: 0x100 },
    },
  };
  const midpoint: Entity = {
    ...line,
    id: "point",
    kind: "referencePoint",
    constructionOrderKey: "02".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "center",
        sources: [
          { id: line.id, constructionOrderKey: line.constructionOrderKey! },
        ],
      },
      geometry: { kind: "point", position: [1, 0, 0] },
      evaluation: { completionWord: 0x100 },
    },
  };
  const html = renderToStaticMarkup(
    <ReferenceConstructionDialog
      api={{} as ApplicationApi}
      kind="point"
      entity={midpoint}
      entities={[
        line,
        {
          ...line,
          id: "cad",
          name: "Unsupported CAD",
          kind: "cad",
          reference: undefined,
        },
      ]}
      onClose={vi.fn()}
    />,
  );
  expect(html).toContain("Point construction");
  expect(html).toContain("Line midpoint");
  expect(html).toContain("Source line");
  expect(html).toContain("Stored line");
  expect(html).toContain('value="line" selected=""');
  expect(html).not.toContain("Unsupported CAD");
  expect(html).not.toContain("Position X");
});
