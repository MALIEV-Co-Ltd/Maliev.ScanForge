import { expect, it } from "vitest";
import { readAscPointCloud } from "../src/asc-import";

it("defaults to XYZ/RGB and retains explicit XYZ/normal interpretation for ambiguous integers", async () => {
  const file = new Blob(["1 2 3 0 1 0\n4 5 6 255 128 64"]);
  const colors = await readAscPointCloud(file);
  expect(colors.normals).toBeUndefined();
  expect(colors.pointColors).toEqual(
    new Uint8Array([0, 1, 0, 255, 255, 128, 64, 255]),
  );
  const normals = await readAscPointCloud(file, { attributes: "xyz-normal" });
  expect(normals.normals).toEqual(new Float32Array([0, 1, 0, 255, 128, 64]));
  expect(normals.pointColors).toBeUndefined();
});

it("uses XYZ fallback for fractional normal columns and white for uncolored records", async () => {
  const result = await readAscPointCloud(
    new Blob(["1 2 3 .2 .3 .4\n4 5 6\n7 8 9 -1 256 511"]),
  );
  expect(result.positions).toEqual(
    new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
  );
  expect(result.normals).toBeUndefined();
  expect(result.pointColors).toEqual(
    new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255]),
  );
});

it("detects and retains the native file separator and skips records that cannot parse XYZ", async () => {
  const result = await readAscPointCloud(
    new Blob(["header\n1,2,3,10,20,30\n4 5 6 7 8 9\n7,8,9\n"]),
  );
  expect(result.positions).toEqual(new Float32Array([1, 2, 3, 7, 8, 9]));
  expect(result.pointColors).toEqual(
    new Uint8Array([10, 20, 30, 255, 255, 255, 255, 255]),
  );
});

it("rejects unsupported ASC interpretations before reading", async () => {
  await expect(
    readAscPointCloud(new Blob(["1 2 3"]), { attributes: "guess" as never }),
  ).rejects.toThrow(/interpretation/i);
});
