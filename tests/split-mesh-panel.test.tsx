import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitMeshPanel } from "../src/ui/SplitMeshPanel";
import { RIBBON_TABS } from "../src/ui/ribbon-model";

it("offers an independent Scan Data command for splitting meshes", () => {
  const scan = RIBBON_TABS.find((tab) => tab.id === "scan")!;
  expect(scan.groups.flatMap((group) => group.tools)).toContainEqual(
    expect.objectContaining({
      id: "splitMesh",
      action: "splitMesh",
      label: "Split mesh",
    }),
  );
});
it("requires a cutting object and explains when none are available", () => {
  const html = renderToStaticMarkup(
    <SplitMeshPanel
      cutters={[]}
      busy={false}
      onSplit={() => {}}
      onClose={() => {}}
    />,
  );
  expect(html).toContain("Add a cutting object");
  expect(html).toMatch(/<button disabled=""[^>]*>/);
  expect(html).toContain('aria-label="Mesh splitter"');
});
it("disables the cutter picker during processing", () => {
  const html = renderToStaticMarkup(
    <SplitMeshPanel cutters={[]} busy onSplit={() => {}} onClose={() => {}} />,
  );
  expect(html).toMatch(/<select[^>]*disabled=""/);
});
