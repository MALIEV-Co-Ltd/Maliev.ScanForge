import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PointCloudTools } from "../src/ui/PointCloudTools";

it("exposes explicit 3D normals, resolution and trimming controls only in cloud editing", () => {
  const props = {
    count: 100,
    selection: null,
    busy: false,
    hasNormals: true,
    onApply: () => {},
    onPoisson: () => {},
  };
  const html = renderToStaticMarkup(createElement(PointCloudTools, props));
  expect(html).toContain("Reconstruct a 3D surface");
  expect(html).toContain("Normal orientation");
  expect(html).toContain("Estimate using existing orientations");
  expect(html).toContain("Density trimming threshold");
  expect(html).toContain("Create Poisson mesh");
  expect(
    renderToStaticMarkup(
      createElement(PointCloudTools, { ...props, tool: "reduce" }),
    ),
  ).not.toContain("Create Poisson mesh");
});
