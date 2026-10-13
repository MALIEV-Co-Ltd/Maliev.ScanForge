import { expect, it } from "vitest";
import { isSampledScan } from "../src/scan-source";
it("distinguishes legacy preview sampling from native facet rejection", () => {
  const source = { bytes: 184, triangles: 2, displayedTriangles: 1 };
  expect(isSampledScan()).toBe(false);
  expect(isSampledScan(source)).toBe(true);
  expect(isSampledScan({ ...source, acceptedTriangles: 1 })).toBe(false);
  expect(isSampledScan({ ...source, acceptedTriangles: 2 })).toBe(true);
});
