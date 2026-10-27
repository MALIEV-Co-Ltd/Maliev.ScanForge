import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RIBBON_TABS } from "../src/ui/ribbon-model";
import {
  RibbonCommandIcon,
  RIBBON_ICON_ARTWORK,
} from "../src/ui/RibbonCommandIcon";
describe("complete ribbon artwork", () => {
  const commands = [
    ...new Set([
      "backup",
      ...RIBBON_TABS.flatMap((tab) =>
        tab.groups.flatMap((group) =>
          group.tools.flatMap((tool) => [
            tool.id,
            ...(tool.options ?? []).map((option) => option.id),
          ]),
        ),
      ),
    ]),
  ];
  it("renders local decorative artwork for every command, including unavailable tools", () => {
    expect(Object.keys(RIBBON_ICON_ARTWORK)).toEqual(
      expect.arrayContaining(commands),
    );
    for (const command of commands) {
      const markup = renderToStaticMarkup(
        <RibbonCommandIcon command={command} />,
      );
      expect(markup).toContain(`data-artwork="${command}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toMatch(/lucide|<image|<script|url\(/);
      expect(markup).not.toContain("<svg");
      expect(markup).toContain("<img");
      expect(markup).not.toContain("<use");
      expect(markup).toContain('data-icon-style="generated-technical"');
      expect(markup).toContain('alt=""');
      expect(markup).toContain(
        `/icons/generated/${RIBBON_ICON_ARTWORK[command]}.png`,
      );
    }
  });
  it("reuses plane artwork for the numeric reference-plane result", () => {
    expect(RIBBON_ICON_ARTWORK.referencePlane).toBe(
      RIBBON_ICON_ARTWORK.fitPlane,
    );
    const markup = renderToStaticMarkup(
      <RibbonCommandIcon command="referencePlane" />,
    );
    expect(markup).toContain('data-palette="reference"');
  });
  it("distinguishes operations with different geometric results", () => {
    for (const group of [
      ["top", "bottom", "left", "right", "front", "back", "iso"],
      ["boolean", "combine", "cut", "intersect"],
      ["cleanup", "repairMesh", "segmentMesh", "reducePolygons", "reduceNoise"],
      [
        "fitSurface",
        "nurbsSurface",
        "loft",
        "sweep",
        "surfaceOffset",
        "surfaceThicken",
      ],
      ["exportStep", "exportStl", "extrude"],
      ["align", "transform", "alignNPoints", "fineAlign", "globalFineAlign"],
      ["newDocument", "open", "save", "backup"],
      ["fillet", "chamfer"],
    ])
      expect(new Set(group.map((id) => RIBBON_ICON_ARTWORK[id])).size).toBe(
        group.length,
      );
  });
  it("rejects missing artwork instead of silently displaying a generic fallback", () => {
    expect(() =>
      renderToStaticMarkup(<RibbonCommandIcon command="unregistered" />),
    ).toThrow("Missing ribbon artwork");
  });
  it("uses the same generated raster artwork at compact and full ribbon sizes", () => {
    for (const command of ["delete", "repairMesh", "newFreeform"]) {
      const compact = renderToStaticMarkup(
        <RibbonCommandIcon command={command} compact />,
      );
      expect(compact).not.toContain("<svg");
      expect(compact).toContain("<img");
      expect(compact).toContain(`data-artwork="${command}"`);
      const fullSize = renderToStaticMarkup(
        <RibbonCommandIcon command={command} />,
      );
      expect(fullSize).not.toContain("<svg");
      expect(fullSize).toContain("<img");
    }
  });
  it("retains operation-family identity across all authoring commands", () => {
    for (const [tabId, family] of [
      ["freeform", "freeform"],
      ["cad", "cad"],
    ]) {
      const tab = RIBBON_TABS.find((tab) => tab.id === tabId)!;
      for (const tool of tab.groups.flatMap((group) => group.tools)) {
        const markup = renderToStaticMarkup(
          <RibbonCommandIcon command={tool.id} />,
        );
        expect(markup).toContain(`data-palette="${family}"`);
        expect(markup).not.toContain("#edbe48");
      }
    }
  });
  it("distinguishes reference primitives from STEP-exportable primitive solids", () => {
    for (const command of ["fitPlane", "fitCylinder", "fitCone", "fitSphere"]) {
      const markup = renderToStaticMarkup(
        <RibbonCommandIcon command={command} />,
      );
      expect(markup).toContain('data-palette="reference"');
      expect(markup).not.toContain("<svg");
    }
    const solidMarkup = renderToStaticMarkup(
      <RibbonCommandIcon command="primitive" />,
    );
    expect(solidMarkup).toContain('data-palette="cad"');
    expect(solidMarkup).toContain("<img");
  });
});
