import { expect, it } from "vitest";
import { readAscPointCloud } from "../src/asc-import";
import { pointCloudStats } from "../src/point-cloud";
import { convertScanUnits } from "../src/import-units";
import { placeScanOnOrigin } from "../src/import-origin";

it("reads XYZ and optional scanner normals, including comments, delimiters and the final line", async () => {
  const result = await readAscPointCloud(
    new Blob(["# scan\r\n1 2 3 0 0 1\r\n4,5,6,0,1,0"]),
  );
  expect(result.positions).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
  expect(result.normals).toEqual(new Float32Array([0, 0, 1, 0, 1, 0]));
  expect(
    (await readAscPointCloud(new Blob(["1;2;3"]))).normals,
  ).toBeUndefined();
  expect(pointCloudStats(result.positions)).toMatchObject({
    vertices: 2,
    triangles: 0,
    min: [1, 2, 3],
    max: [4, 5, 6],
  });
});
it.each([
  "",
  "# empty",
  "1 2",
  "1 2 NaN",
  "1 2 Infinity",
  "1 2 3\n4 5 6 0 0 1",
  "1 2 1e40",
])("rejects invalid point records: %s", async (text) => {
  await expect(readAscPointCloud(new Blob([text]))).rejects.toThrow();
});
it("converts units and places non-triangular point counts at the origin without changing normals", async () => {
  const result = await readAscPointCloud(
    new Blob(["1 2 3 0 0 1\n4 5 6 0 1 0"]),
  );
  convertScanUnits(result.positions, "cm");
  placeScanOnOrigin(result.positions, true);
  expect(result.positions).toEqual(new Float32Array([-15, -15, 0, 15, 15, 30]));
  expect(result.normals).toEqual(new Float32Array([0, 0, 1, 0, 1, 0]));
});
it("releases a cancelled read and reports progress", async () => {
  const controller = new AbortController();
  await expect(
    readAscPointCloud(new Blob(["1 2 3"]), { signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    readAscPointCloud(new Blob(["1 2 3"]), {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
