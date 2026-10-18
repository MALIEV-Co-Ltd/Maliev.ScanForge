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
      expect(markup).toContain("<svg");
      expect(markup).not.toContain("<img");
      expect(markup).not.toContain("href=");
      expect(markup).toContain('data-icon-style="geometric-isometric"');
      expect(markup).toContain('viewBox="0 0 32 32"');
      expect(markup).toMatch(/(?:fill|stroke)="#(?:[a-f0-9]{3}|[a-f0-9]{6})"/);
    }
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
  it("uses the same vector diagram at compact and full ribbon sizes", () => {
    for (const command of ["delete", "repairMesh", "newFreeform"]) {
      const compact = renderToStaticMarkup(
        <RibbonCommandIcon command={command} compact />,
      );
      expect(compact).toContain("<svg");
      expect(compact).not.toContain("<img");
      expect(compact).toContain(`data-artwork="${command}"`);
      const fullSize = renderToStaticMarkup(
        <RibbonCommandIcon command={command} />,
      );
      expect(fullSize).toContain("<svg");
      expect(fullSize).not.toContain("<img");
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
      expect(markup).toContain("<svg");
    }
    const solidMarkup = renderToStaticMarkup(
      <RibbonCommandIcon command="primitive" />,
    );
    expect(solidMarkup).toContain('data-palette="cad"');
    expect(solidMarkup).not.toContain("<img");
  });
});
