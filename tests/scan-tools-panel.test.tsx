import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanToolsPanel, type ScanToolId } from "../src/ui/ScanToolsPanel";
import type { Entity } from "../src/types";

const mesh: Entity = {
  id: "mesh",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array(90),
  color: "#aaa",
  visible: true,
  opacity: 1,
};
it.each(["scaleMesh", "mirrorMesh"] as const)(
  "%s separates preview from acceptance and offers cancellation without comparison controls",
  (tool) => {
    const panel = (previewReady: boolean) =>
      renderToStaticMarkup(
        <ScanToolsPanel
          tool={tool}
          selected={mesh}
          entities={[mesh]}
          previewReady={previewReady}
          onApply={() => {}}
          onAccept={() => {}}
          onCancel={() => {}}
          onClose={() => {}}
        />,
      );
    expect(panel(false)).toContain('disabled="">Accept');
    expect(panel(true)).not.toContain('disabled="">Accept');
    expect(panel(true)).toContain(">Preview</button>");
    expect(panel(true)).toContain(">Cancel</button>");
    expect(panel(true)).toContain('type="checkbox"/>Create new object');
    expect(panel(true)).not.toContain("Update comparison");
  },
);
it.each(["reduceNoise"] as const)(
  "%s gates comparison and acceptance on an available preview",
  (tool) => {
    const panel = (previewReady: boolean) =>
      renderToStaticMarkup(
        <ScanToolsPanel
          tool={tool}
          selected={mesh}
          entities={[mesh]}
          previewReady={previewReady}
          onApply={() => {}}
          onAccept={() => {}}
          onCompare={() => {}}
          onCancel={() => {}}
          onClose={() => {}}
        />,
      );
    expect(panel(false)).toContain('disabled="">Accept');
    expect(panel(false)).toContain('type="checkbox" disabled=""/>Measure');
    expect(panel(false)).toContain(">Preview</button>");
    expect(panel(true)).not.toContain('disabled="">Accept');
    expect(panel(true)).not.toContain('type="checkbox" disabled=""/>Measure');
    expect(panel(true)).toContain(">Cancel</button>");
  },
);
function render(
  tool: ScanToolId,
  selected: Entity | undefined = mesh,
  entities: Entity[] = [mesh],
) {
  return renderToStaticMarkup(
    <ScanToolsPanel
      tool={tool}
      selected={selected}
      entities={entities}
      onApply={() => {}}
      onCancel={() => {}}
      onClose={() => {}}
    />,
  );
}
it("shows only the current tool and a colored geometry diagram", () => {
  const html = render("reducePolygons");
  expect(html).toContain("Number of triangles");
  expect(html).toContain("Percentage remaining");
  expect(html).toContain("Deviation from original");
  expect(html).toContain('value="50"');
  expect(html).toContain('stroke="#87d3e8"');
  expect(html).not.toContain("Smooth iterations");
});
it("uses the requested millimetre defaults", () => {
  expect(render("repolygonize")).toContain('value="0.5"');
  expect(render("averageMesh")).toContain('value="10"');
  expect(render("unroll")).toContain('value="0"');
});
it("offers factor and percentage Scale input while retaining the origin default", () => {
  const html = render("scaleMesh");
  expect(html).toContain("Scale by");
  expect(html).toContain('value="factor" selected=""');
  expect(html).toContain('value="percentage">Percentage');
  expect(html).toContain("Scale factor");
  expect(html).toContain("Scale center (mm)");
});
it("defaults noise reduction to one whole-mesh iteration with boundaries enabled and comparison off", () => {
  const html = render("reduceNoise");
  expect(html).toContain('max="5" step="1" value="1"');
  expect(html).toContain('type="checkbox"/>Apply to selection only');
  expect(html).toContain('type="checkbox" checked=""/>Smooth boundary edges');
  expect(html).toContain('type="checkbox"/>Measure deviation from original');
  expect(html).not.toContain("Maximum deviation");
  expect(html).not.toContain("Comparison threshold");
});
it("offers the three origin planes for mirroring", () => {
  const html = render("mirrorMesh");
  for (const label of [
    "XY origin plane",
    "YZ origin plane",
    "XZ origin plane",
    "CAD / construction plane",
  ])
    expect(html).toContain(label);
});
it("gates averaging and unrolling on eligible reference objects", () => {
  expect(render("averageMesh")).toContain("Add another mesh to average with.");
  expect(render("averageMesh")).toContain('disabled="">Apply');
  expect(render("unroll")).toContain("Select a fitted cylinder");
  const cylinder: Entity = {
    ...mesh,
    id: "cylinder",
    name: "Cylinder reference",
    kind: "cylinder",
    fit: {
      kind: "cylinder",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 10,
      rms: 0,
      maxError: 0,
    },
  };
  expect(render("unroll", mesh, [mesh, cylinder])).toContain(
    "Cylinder reference",
  );
  expect(render("unroll", mesh, [mesh, cylinder])).not.toContain(
    'disabled="">Apply',
  );
});
it("requires mesh copies for exact CAD and explains an empty selection", () => {
  expect(
    render("flipNormals", { ...mesh, kind: "cad", kernelId: "exact" }),
  ).toContain("explicit mesh copy");
  expect(
    renderToStaticMarkup(
      <ScanToolsPanel
        tool="scaleMesh"
        entities={[]}
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
      />,
    ),
  ).toContain("Select a mesh");
});
it("keeps cancellation available while an operation is running", () => {
  const html = renderToStaticMarkup(
    <ScanToolsPanel
      tool="reduceNoise"
      selected={mesh}
      entities={[mesh]}
      busy
      progress="Smoothing"
      onApply={() => {}}
      onCancel={() => {}}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Cancel operation");
  expect(html).toContain('disabled="">Apply');
  expect(html).toContain("Smoothing");
});
