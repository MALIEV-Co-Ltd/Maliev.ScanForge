import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApplicationApi } from "../src/automation/api";
import type { Entity } from "../src/types";
import { ReferenceConstructionDialog } from "../src/ui/ReferenceConstructionDialog";

const api = { currentRevision: () => 7 } as ApplicationApi;
const source = (id: string, key: string): Entity => ({
  id,
  name: id,
  kind: "referenceLine",
  positions: [],
  color: "#ffffff",
  opacity: 1,
  visible: true,
  constructionOrderKey: key.repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [0, 0, 0],
      end: [10, 0, 0],
      sources: [],
      records: [],
    },
    geometry: {
      kind: "line",
      start: [0, 0, 0],
      direction: [1, 0, 0],
      length: 10,
    },
    evaluation: { completionWord: 256 },
  },
});
const sources = [source("first", "02"), source("second", "01")];
function markup(mode?: "pair" | "average") {
  const entity: Entity | undefined = mode
    ? {
        ...source("edited", "03"),
        reference: {
          ...source("edited", "03").reference!,
          definition: {
            version: 1,
            kind: "line",
            mode,
            sources: [...sources].reverse().map((row) => ({
              id: row.id,
              constructionOrderKey: row.constructionOrderKey!,
            })),
            records: [
              sources[0],
              sources[1],
              ...(mode === "average" ? [sources[0]] : []),
            ].map((row) => ({
              entityId: row.id,
              storage: "native-pick-record-f32" as const,
              coordinates: [1, 0, 0] as const,
            })),
          },
        },
      }
    : undefined;
  return renderToStaticMarkup(
    <ReferenceConstructionDialog
      api={api}
      kind="line"
      entity={entity}
      entities={sources}
      onClose={vi.fn()}
    />,
  );
}

it("offers endpoint, pair and average modes through the shared line editor", () => {
  const html = markup();
  for (const mode of ["endpoints", "pair", "average"])
    expect(html).toContain(`value="${mode}"`);
  expect(html).toContain("Start X");
  expect(html).toContain("End X");
});

it("opens a pair using retained record order rather than sorted common dependencies", () => {
  const html = markup("pair");
  expect(html).toContain('value="pair" selected=""');
  expect(html.indexOf('value="first" selected=""')).toBeLessThan(
    html.indexOf('value="second" selected=""'),
  );
  expect(html).not.toContain("Start X");
});

it("keeps repeated average records visible without inventing new acquisition fractions", () => {
  const html = markup("average");
  expect(html).toContain('value="average" selected=""');
  expect(html).toContain("Source 3");
  expect(html.match(/value="first" selected=""/g)).toHaveLength(2);
  expect(html).not.toContain("Start X");
});
