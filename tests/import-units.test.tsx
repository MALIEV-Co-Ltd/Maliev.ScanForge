import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { convertScanUnits, SCAN_UNITS } from "../src/import-units";
import { ImportUnitsDialog } from "../src/ui/ImportUnitsDialog";

it.each(Object.entries(SCAN_UNITS))(
  "converts %s into millimeters without another geometry buffer",
  (unit, definition) => {
    const positions = new Float32Array([-2, 0, 3]);
    expect(convertScanUnits(positions, unit as keyof typeof SCAN_UNITS)).toBe(
      positions,
    );
    expect(Array.from(positions)).toEqual(
      Array.from(
        new Float32Array([
          -2 * definition.millimetres,
          0,
          3 * definition.millimetres,
        ]),
      ),
    );
  },
);
it("rejects overflow rather than committing invalid coordinates", () => {
  expect(() => convertScanUnits(new Float32Array([3e38]), "m")).toThrow(
    "supported range",
  );
});
it("shows file units before import, with explicit import and cancel actions", () => {
  const html = renderToStaticMarkup(
    <ImportUnitsDialog onImport={() => {}} onCancel={() => {}} />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).not.toContain("<p");
  expect(html).toContain("Units");
  expect(html).toContain(">Import</button>");
  expect(html).toContain("Millimeter");
  expect(html).toContain("Inches");
  expect(html).toContain("Cancel");
  expect(html).toContain("Import scan");
});
