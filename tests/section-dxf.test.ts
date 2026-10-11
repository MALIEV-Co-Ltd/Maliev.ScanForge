import { describe, expect, it } from "vitest";
import { exportSectionDxf } from "../src/section-dxf";
import { sectionMesh } from "../src/geometry";

function pairs(text: string): [number, string][] {
  const lines = text.trim().split(/\r\n/);
  expect(lines.length % 2).toBe(0);
  return Array.from({ length: lines.length / 2 }, (_, i) => [
    Number(lines[i * 2]),
    lines[i * 2 + 1],
  ]);
}
describe("millimetre world-space DXF section export", () => {
  it("preserves all endpoints and unique entity handles with millimetre units", () => {
    const parsed = pairs(
      exportSectionDxf({
        segments: [1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6],
        length: 10,
      }),
    );
    expect(parsed).toContainEqual([1, "AC1015"]);
    const unitIndex = parsed.findIndex(
      ([code, value]) => code === 9 && value === "$INSUNITS",
    );
    expect(parsed[unitIndex + 1]).toEqual([70, "4"]);
    expect(
      parsed.filter(([code, value]) => code === 0 && value === "LINE"),
    ).toHaveLength(2);
    expect(
      parsed.filter(([code]) => code === 5).map(([, value]) => value),
    ).toEqual(["100", "101"]);
    expect(
      parsed
        .filter(([code]) => [10, 20, 30, 11, 21, 31].includes(code))
        .map(([, value]) => Number(value)),
    ).toEqual([1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6]);
    expect(parsed.at(-1)).toEqual([0, "EOF"]);
  });
  it("exports actual section intersections without flattening the plane", () => {
    const section = sectionMesh([0, 0, -1, 10, 0, 1, 0, 10, 1], "z", 0);
    const parsed = pairs(exportSectionDxf(section));
    expect(
      parsed
        .filter(([code]) => code === 30 || code === 31)
        .every(([, value]) => Number(value) === 0),
    ).toBe(true);
    expect(
      parsed.filter(([code, value]) => code === 0 && value === "LINE"),
    ).toHaveLength(section.segments.length / 6);
  });
  it("rejects incomplete, nonfinite and empty geometry and omits zero-length segments", () => {
    for (const segments of [
      [],
      [1, 2],
      [0, 0, 0, Infinity, 1, 2],
      [0, 0, 0, 0, 0, 0],
    ])
      expect(() => exportSectionDxf({ segments, length: 0 })).toThrow();
    expect(
      pairs(
        exportSectionDxf({
          segments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
          length: 1,
        }),
      ).filter(([code, value]) => code === 0 && value === "LINE"),
    ).toHaveLength(1);
  });
});
