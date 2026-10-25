import { expect, it, vi } from "vitest";
import { prepareImportedScan } from "../src/imported-scan";
import { importScan } from "../src/import-client";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));

it("assigns lime green to new ASC clouds while retaining source RGB and mesh defaults", async () => {
  const colors = Uint8Array.of(12, 34, 56, 255);
  vi.mocked(importScan).mockImplementation(async (_file, options) => {
    options?.onPointCloud?.({ pointColors: colors });
    return Float32Array.of(0, 0, 0);
  });
  const cloud = await prepareImportedScan(new File(["0 0 0"], "scan.asc"));
  expect(cloud.kind).toBe("pointcloud");
  expect(cloud.color).toBe("#aaff00");
  expect(cloud.pointColorMode).toBe("solid");
  expect(cloud.pointColors).toBe(colors);
  vi.mocked(importScan).mockResolvedValue(
    Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  );
  expect((await prepareImportedScan(new File([], "mesh.stl"))).color).toBe(
    "#a6a6a6",
  );
});
