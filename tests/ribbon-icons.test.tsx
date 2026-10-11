import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RIBBON_TABS } from "../src/ui/ribbon-model";
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
        tab.groups.flatMap((group) => group.tools.map((tool) => tool.id)),
      ),
    ),
  ];
  it("renders local decorative artwork for every command, including unavailable tools", () => {
    expect(Object.keys(RIBBON_ICON_ARTWORK).sort()).toEqual(
      [...commands].sort(),
    );
    for (const command of commands) {
      const markup = renderToStaticMarkup(
        <RibbonCommandIcon command={command} />,
      );
      expect(markup).toContain(`data-artwork="${command}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('viewBox="0 0 32 32"');
      expect(markup).not.toMatch(/lucide|<image|<script|href=|url\(/);
      expect(markup).toMatch(/(?:fill|stroke)="#[a-f0-9]{6}"/);
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
      expect(new Set(group.map((id) => RIBBON_ICON_ARTWORK[id])).size).toBe(
        group.length,
      );
  });
  it("rejects missing artwork instead of silently displaying a generic fallback", () => {
    expect(() =>
      renderToStaticMarkup(<RibbonCommandIcon command="unregistered" />),
    ).toThrow("Missing ribbon artwork");
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
        expect(markup).toContain(color);
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
      expect(markup).toContain(DEFAULT_REFERENCE_COLOR);
    }
    expect(
      renderToStaticMarkup(<RibbonCommandIcon command="primitive" />),
    ).toContain(DEFAULT_PART_COLOR);
  });
});
