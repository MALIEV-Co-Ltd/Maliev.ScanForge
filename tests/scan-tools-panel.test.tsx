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
    expect(panel(false)).toContain(">Preview</button>");
    expect(panel(false)).not.toContain(">Accept</button>");
    expect(panel(true)).not.toContain('disabled="">Accept');
    expect(panel(true)).toContain('aria-label="Preview"');
    expect(panel(true)).toContain(">Cancel</button>");
    expect(panel(true)).toContain('type="checkbox"/>Create new object');
    expect(panel(true)).not.toContain("Update comparison");
  },
);
it.each(["reduceNoise"] as const)(
  "%s allows comparison before preview and gates acceptance on a preview",
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
    expect(panel(false)).toContain(">Preview</button>");
    expect(panel(false)).not.toContain(">Accept</button>");
    expect(panel(false)).toContain('type="checkbox"/>Measure');
    expect(panel(false)).toContain('aria-label="Preview"');
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
it("shows only the current tool and its generated technical illustration", () => {
  const html = render("reducePolygons");
  expect(html).toContain('aria-haspopup="listbox"');
  expect(html).toContain("Percentage remaining");
  expect(html).toContain('aria-label="Reduce by"');
  expect(html).toContain('value="50"');
  expect(html).toContain("/icons/generated/ribbon-reducePolygons.png");
  expect(html).not.toContain("Smooth iterations");
});
it("uses the requested millimetre defaults", () => {
  expect(render("repolygonize")).toContain('value="0.5"');
  expect(render("averageMesh")).toContain('value="10"');
  expect(render("unroll")).toContain('value="0"');
});

it("defaults mesh reconstruction to native with visible mesh references selected", () => {
  const html = render("repolygonize", mesh, [
    mesh,
    { ...mesh, id: "aligned", name: "Aligned native scan" },
    { ...mesh, id: "hidden", name: "Hidden native scan", visible: false },
  ]);
  expect(html).toContain('aria-label="Reconstruction method"');
  expect(html).toContain('value="native" selected=""');
  expect(html).toContain('checked=""/>Aligned native scan');
  expect(html).not.toContain('checked=""/>Hidden native scan');
});

it("keeps point-cloud reconstruction on the closed voxel route", () => {
  const cloud: Entity = {
    ...mesh,
    kind: "pointcloud",
    positions: [0, 0, 0, 1, 1, 1],
  };
  const html = render("repolygonize", cloud, [cloud]);
  expect(html).toContain('value="voxel" selected=""');
  expect(html).toContain("Point clouds use every XYZ");
  expect(html).toContain("separate closed components");
});

it("admits a two-point cloud only for reconstruction and lists aligned cloud targets", () => {
  const cloud: Entity = {
    ...mesh,
    id: "cloud",
    kind: "pointcloud",
    positions: [0, 0, 0, 1, 1, 1],
  };
  const target: Entity = {
    ...cloud,
    id: "cloud-target",
    name: "Aligned cloud target",
  };
  const html = render("repolygonize", cloud, [cloud, target, mesh]);
  expect(html).toContain("Points</span><strong>2</strong>");
  expect(html).toContain("Aligned cloud target");
  expect(html).not.toContain('disabled="">Apply');
  expect(html).toContain("0.866");
  expect(html).toContain("scanner normals");
  expect(render("averageMesh", mesh, [mesh, target])).not.toContain(
    "Aligned cloud target",
  );
  expect(render("flipNormals", cloud)).toContain('disabled="">Apply');
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
it("offers exact capped CAD references without fitting their display vertices", () => {
  const capped: Entity = {
    ...mesh,
    id: "capped",
    name: "Imported capped cylinder",
    kind: "cad",
    kernelId: "exact-capped-cylinder",
    positions: new Float32Array([
      0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 2, 0, 1, 2, 0, 0, 2, 0, 1, 0,
      2, 0,
    ]),
  };
  const html = render("unroll", mesh, [mesh, capped]);
  expect(html).toContain("Imported capped cylinder");
  expect(html).not.toContain('disabled="">Apply');
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

it.each([
  "reducePolygons",
  "reduceNoise",
  "scaleMesh",
  "mirrorMesh",
  "flipNormals",
  "repolygonize",
  "averageMesh",
  "unroll",
] as const)("%s keeps actions outside the scrolling content", (tool) => {
  const html = renderToStaticMarkup(
    <ScanToolsPanel
      tool={tool}
      selected={mesh}
      entities={[mesh]}
      onApply={() => {}}
      onClose={() => {}}
      onCancel={() => {}}
      onAccept={
        ["reducePolygons", "reduceNoise", "scaleMesh", "mirrorMesh"].includes(
          tool,
        )
          ? () => {}
          : undefined
      }
    />,
  );
  const footer = html.slice(html.indexOf("<footer"));
  const body = html.slice(
    html.indexOf('class="tool-panel-content"'),
    html.indexOf("<footer"),
  );
  expect(html).not.toContain("Tool options");
  expect(body).not.toContain('aria-label="Preview"');
  expect(footer).toContain('class="tool-panel-actions"');
  if (
    ["reducePolygons", "reduceNoise", "scaleMesh", "mirrorMesh"].includes(tool)
  ) {
    expect(footer.indexOf('aria-label="Preview"')).toBeLessThan(
      footer.indexOf(">Cancel</button>"),
    );
    expect(footer).toContain("ui-Search.png");
  } else expect(footer).toContain(">Apply</button>");
});

it("reports a clear triangle count without repeating the selected filename and groups comparison settings", () => {
  const html = render("reducePolygons", {
    ...mesh,
    name: "private-file-name.stl",
  });
  expect(html).not.toContain("private-file-name.stl");
  expect(html).toContain("Triangles</span><strong>10</strong>");
  const comparison = html.slice(
    html.indexOf('aria-label="Deviation comparison"'),
  );
  expect(comparison).toContain("Comparison tolerance (mm)");
});

it("offers native reconstruction references with measured open-topology guidance", () => {
  const html = render("repolygonize", mesh, [
    mesh,
    { ...mesh, id: "second", name: "Aligned scan" },
  ]);
  expect(html).toContain('aria-label="Additional reconstruction scans"');
  expect(html).toContain("Aligned scan");
  expect(html).toContain("retained unchanged");
  expect(html).toContain(
    "nonmanifold edges and separate components can remain",
  );
  expect(html).toContain("Creates a new mesh and hides the unchanged inputs");
  expect(html).toContain("not a maximum-deviation tolerance");
});
