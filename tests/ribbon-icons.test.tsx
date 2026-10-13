import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RIBBON_TABS } from "../src/ui/ribbon-model";
import { RIBBON_RASTER_ICONS } from "../src/ui/RibbonRasterIcons";
import {
  RibbonCommandIcon,
  RIBBON_ICON_ARTWORK,
} from "../src/ui/RibbonCommandIcon";
import {
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_PART_COLOR,
  DEFAULT_REFERENCE_COLOR,
} from "../src/appearance";

describe("complete ribbon artwork", () => {
  const commands = [
    ...new Set(
      RIBBON_TABS.flatMap((tab) =>
        tab.groups.flatMap((group) =>
          group.tools.flatMap((tool) => [
            tool.id,
            ...(tool.options ?? []).map((option) => option.id),
          ]),
        ),
      ),
    ),
  ];
  it("uses generated illustrations for every full-size ribbon command", () => {
    expect(
      commands.filter((command) => !RIBBON_RASTER_ICONS[command]).sort(),
    ).toEqual([]);
  });
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
      if (RIBBON_RASTER_ICONS[command]) {
        expect(markup).toContain("<img");
        expect(markup).toContain('alt=""');
        expect(markup).toContain(RIBBON_RASTER_ICONS[command]);
      } else {
        expect(markup).not.toContain("href=");
        expect(markup).toContain('viewBox="0 0 32 32"');
        expect(markup).toMatch(/(?:fill|stroke)="#[a-f0-9]{6}"/);
      }
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
      ["exportStep", "exportStl"],
      ["fillet", "chamfer"],
    ])
      expect(
        new Set(
          group.map((id) => RIBBON_RASTER_ICONS[id] ?? RIBBON_ICON_ARTWORK[id]),
        ).size,
      ).toBe(group.length);
  });
  it("rejects missing artwork instead of silently displaying a generic fallback", () => {
    expect(() =>
      renderToStaticMarkup(<RibbonCommandIcon command="unregistered" />),
    ).toThrow("Missing ribbon artwork");
  });
  it("keeps compact command controls simple while their ribbon illustrations stay generated", () => {
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
      expect(fullSize).toContain("<img");
    }
  });
  it("uses purple authoring geometry and grey CAD geometry throughout their tabs", () => {
    for (const [tabId, family, color] of [
      ["freeform", "freeform", DEFAULT_FREEFORM_COLOR],
      ["cad", "cad", DEFAULT_PART_COLOR],
    ]) {
      const tab = RIBBON_TABS.find((tab) => tab.id === tabId)!;
      for (const tool of tab.groups.flatMap((group) => group.tools)) {
        const markup = renderToStaticMarkup(
          <RibbonCommandIcon command={tool.id} />,
        );
        expect(markup).toContain(`data-palette="${family}"`);
        if (!RIBBON_RASTER_ICONS[tool.id]) expect(markup).toContain(color);
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
      if (!RIBBON_RASTER_ICONS[command])
        expect(markup).toContain(DEFAULT_REFERENCE_COLOR);
    }
    const solidMarkup = renderToStaticMarkup(
      <RibbonCommandIcon command="primitive" />,
    );
    expect(solidMarkup).toContain('data-palette="cad"');
    if (!RIBBON_RASTER_ICONS.primitive)
      expect(solidMarkup).toContain(DEFAULT_PART_COLOR);
  });
});
