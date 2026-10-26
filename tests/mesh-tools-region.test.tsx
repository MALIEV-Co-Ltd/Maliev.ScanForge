import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeshTools } from "../src/ui/MeshTools";
import type { Entity } from "../src/types";
const scan: Entity = {
  id: "moving",
  name: "Moving scan",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#aaa",
  visible: true,
  opacity: 1,
};
const noop = () => {};
it("explains selection priority without implying partial mesh movement", () => {
  const render = (mask: Uint8Array) =>
    renderToStaticMarkup(
      <MeshTools
        entities={[scan]}
        selected={scan}
        triangleSelection={mask}
        onReplace={noop}
        onCreateSegments={noop}
        onError={noop}
        onStatus={noop}
      />,
    );
  expect(render(new Uint8Array([1]))).toContain(
    "Selected visible triangles drive fine alignment; the whole scan moves.",
  );
  expect(render(new Uint8Array([0]))).toContain(
    "Visible triangles drive fine alignment; the whole scan moves.",
  );
  expect(render(new Uint8Array([0]))).toContain("Target overlap RMS (mm)");
  expect(render(new Uint8Array([0]))).toContain("Expected overlap (%)");
  expect(render(new Uint8Array([0]))).toContain("Fitting sample count");
  expect(render(new Uint8Array([0]))).toContain("Fine align with dense ICP");
  expect(render(new Uint8Array([0]))).toContain(
    "Whole-cloud RMS includes every eligible source point",
  );
});
