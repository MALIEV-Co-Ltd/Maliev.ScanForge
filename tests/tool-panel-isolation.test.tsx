import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeshTools } from "../src/ui/MeshTools";
const noop = () => {};
it("Fine Align renders alignment controls without unrelated mesh commands", () => {
  const html = renderToStaticMarkup(
    <MeshTools
      tool="fineAlign"
      entities={[]}
      onReplace={noop}
      onCreateSegments={noop}
      onError={noop}
      onStatus={noop}
    />,
  );
  expect(html).toContain("Registration target");
  expect(html).not.toContain("Weld tolerance");
  expect(html).not.toContain("Reduce polygons");
  expect(html).not.toContain("Segmentation angle");
  expect(html).not.toContain("Global coarse alignment");
  expect(html).not.toContain("Source landmarks");
  expect(html).not.toContain("Mesh reconstruction tools");
});

import {
  ToolWorkspace,
  ToolSection,
  commandWorkspaces,
  workspaceGroup,
} from "../src/ui/tool-panel-scope";
import { AdvancedCadTools } from "../src/ui/AdvancedCadTools";
import { SolidTools } from "../src/ui/SolidTools";
import catalog from "../src/automation/catalog.json";
import { describe } from "vitest";
const meshLabels = {
  repairMesh: "Repair mesh topology",
  segmentMesh: "Segmentation angle",
  smoothMesh: "Smoothing iterations",
  decimateMesh: "Reduction cell size",
  fineAlign: "Registration target",
  globalAlignment: "Global coarse alignment",
  landmarkAlignment: "Source landmarks",
} as const;
describe("mesh tool panels", () => {
  for (const [tool, label] of Object.entries(meshLabels))
    it(`${tool} includes only its operation`, () => {
      const html = renderToStaticMarkup(
        <MeshTools
          tool={tool as keyof typeof meshLabels}
          entities={[]}
          onReplace={noop}
          onCreateSegments={noop}
          onError={noop}
          onStatus={noop}
        />,
      );
      expect(html).toContain(label);
      for (const [other, otherLabel] of Object.entries(meshLabels))
        if (
          other !== tool &&
          !(tool === "globalAlignment" && other === "fineAlign")
        )
          expect(html).not.toContain(otherLabel);
    });
});
const cadLabels = {
  loft: "Create exact loft",
  sweep: "Create exact sweep",
  fillet: "Create fillet",
  chamfer: "Create chamfer",
  surfaceOffset: "Create exact offset",
  sewSurfaces: "Sew selected shapes",
  shell: "Create hollow shell",
  surfaceThicken: "Thicken surface",
  mirrorBody: "Create mirrored body",
  splitSolid: "Split into inside / outside",
  linearPattern: "Create exact body pattern",
  circularPattern: "Create exact body pattern",
};
describe("CAD tool panels", () => {
  for (const [tool, label] of Object.entries(cadLabels))
    it(`${tool} excludes other CAD operations`, () => {
      const html = renderToStaticMarkup(
        <ToolWorkspace.Provider value={tool}>
          <AdvancedCadTools
            entities={[]}
            disabled={false}
            onLoft={noop}
            onSweep={noop}
            onEdges={noop}
            onOffset={noop}
            onSew={noop}
            onShell={noop}
            onThicken={noop}
            onError={noop}
          />
        </ToolWorkspace.Provider>,
      );
      expect(html).toContain(label);
      for (const otherLabel of Object.values(cadLabels))
        if (otherLabel !== label) expect(html).not.toContain(otherLabel);
      if (tool === "surfaceThicken")
        expect(html).not.toContain("Faces to remove");
      if (tool === "circularPattern") {
        expect(html).toContain("Pattern center");
        expect(html).not.toContain("Pattern spacing");
      }
    });
});
for (const [tool, label] of Object.entries({
  extrude: "Extrude sketch to CAD",
  revolve: "Revolve profile to CAD",
  boolean: "Create boolean result",
}))
  it(`${tool} excludes other reconstruction operations`, () => {
    const html = renderToStaticMarkup(
      <ToolWorkspace.Provider value={tool}>
        <SolidTools
          entities={[]}
          busy={false}
          onBoolean={noop}
          onExtrude={noop}
          onRevolve={noop}
        />
      </ToolWorkspace.Provider>,
    );
    expect(html).toContain(label);
    for (const other of [
      "Extrude sketch to CAD",
      "Revolve profile to CAD",
      "Create boolean result",
    ])
      if (other !== label) expect(html).not.toContain(other);
  });
it("does not mount unrelated shared inspector sections", () => {
  const html = renderToStaticMarkup(
    <ToolWorkspace.Provider value="fineAlign">
      <ToolSection tools={["properties"]}>
        <input aria-label="Opacity" />
      </ToolSection>
      <ToolSection tools={["fineAlign"]}>
        <input aria-label="Alignment distance" />
      </ToolSection>
    </ToolWorkspace.Provider>,
  );
  expect(html).not.toContain("Opacity");
  expect(html).toContain("Alignment distance");
});
it("MCP exposes every command-specific workspace", () => {
  const schema = catalog.find((tool) => tool.name === "ui_set")!.inputSchema
    .properties!.workspace!;
  for (const command of Object.keys(commandWorkspaces))
    expect(schema.enum).toContain(command);
  expect(workspaceGroup("fineAlign")).toBe("processing");
});

import { PointCloudTools } from "../src/ui/PointCloudTools";
for (const tool of ["reduce", "noise"] as const)
  it(`point-cloud ${tool} shows only relevant operations`, () => {
    const html = renderToStaticMarkup(
      <PointCloudTools
        tool={tool}
        count={100}
        selection={null}
        busy={false}
        onApply={noop}
      />,
    );
    expect(html).not.toContain("Select connected points");
    if (tool === "reduce") {
      expect(html).toContain("Target points");
      expect(html).not.toContain("Smoothing iterations");
    } else {
      expect(html).toContain("Smoothing iterations");
      expect(html).not.toContain("Target points");
      expect(html).not.toContain("Point spacing");
    }
  });
