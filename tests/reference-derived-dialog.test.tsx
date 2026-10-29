import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApplicationApi } from "../src/automation/api";
import type { Entity } from "../src/types";
import { ReferenceConstructionDialog } from "../src/ui/ReferenceConstructionDialog";
const api = { currentRevision: () => 7 } as ApplicationApi;
const point = (id: string, index: number): Entity => ({
  id,
  name: `Source ${id}`,
  kind: "referencePoint",
  positions: [],
  color: "#ffffff",
  visible: true,
  opacity: 1,
  constructionOrderKey: index.toString(16).padStart(32, "0"),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [index, 0, 0],
      sources: [],
    },
    geometry: { kind: "point", position: [index, 0, 0] },
    evaluation: { completionWord: 0x100 },
  },
});
const sources = [point("a", 1), point("b", 2), point("c", 3)];
function editor(mode: "center" | "pair" | "threePlanes", count: number) {
  const entity: Entity = {
    ...point("edited", 4),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode,
        sources: sources.slice(0, count).map((source) => ({
          id: source.id,
          constructionOrderKey: source.constructionOrderKey!,
        })),
      },
      geometry: { kind: "point", position: [2, 3, 4] },
      evaluation: { completionWord: 0x100 },
    },
  };
  return renderToStaticMarkup(
    <ReferenceConstructionDialog
      api={api}
      kind="point"
      entity={entity}
      entities={sources}
      onClose={vi.fn()}
    />,
  );
}
it("offers the admitted shared point construction modes alongside numeric and midpoint compatibility", () => {
  const html = renderToStaticMarkup(
    <ReferenceConstructionDialog api={api} kind="point" onClose={vi.fn()} />,
  );
  for (const mode of [
    "coordinates",
    "midpoint",
    "center",
    "pair",
    "threePlanes",
  ])
    expect(html).toContain(`value="${mode}"`);
});
it("preserves a two-selector center definition instead of converting it to the one-line midpoint alias", () => {
  const html = editor("center", 2);
  expect(html).toContain('value="center" selected=""');
  expect(html).toContain("Source 1");
  expect(html).toContain("Source 2");
  expect(html).toContain('value="a" selected=""');
  expect(html).toContain('value="b" selected=""');
  expect(html).not.toContain("Position X");
});
it("keeps both pair sources visible while the shared source query is pending", () => {
  const html = editor("pair", 2);
  expect(html).toContain('value="pair" selected=""');
  expect(html).toContain('value="a" selected=""');
  expect(html).toContain('value="b" selected=""');
  expect(html).not.toContain("Position X");
});
it("keeps all three plane bindings on an existing three-plane point", () => {
  const html = editor("threePlanes", 3);
  expect(html).toContain('value="threePlanes" selected=""');
  expect(html).toContain("Source 3");
  for (const id of ["a", "b", "c"])
    expect(html).toContain(`value="${id}" selected=""`);
  expect(html).not.toContain("Position X");
});

it("offers shared viewport coordinate acquisition for numeric points", () => {
  const html = renderToStaticMarkup(
    <ReferenceConstructionDialog
      api={api}
      kind="point"
      pickCoordinate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(html).toContain("Pick position");
});
it("offers independent picked start and end coordinates for finite lines", () => {
  const html = renderToStaticMarkup(
    <ReferenceConstructionDialog
      api={api}
      kind="line"
      pickCoordinate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(html).toContain("Pick start");
  expect(html).toContain("Pick end");
});
