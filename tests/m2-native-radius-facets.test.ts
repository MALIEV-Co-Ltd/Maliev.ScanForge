import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { assembleFiniteFaceMesh } from "../src/scan-split-finite-assembly";
import type { Vec3 } from "../src/types";

const sourceHash =
  "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6";
const cases = [
  [
    "below",
    "m2-split-point-radius",
    "cutter-below.stl",
    "f1934caa75204704f3b1a37ad37d251689be2341b7899227c9510a9873f49ccf",
    "native-below-20261029.stl",
    "adb567e7a9b37e60292749e9fe4a002c4d462653259924b3dbe6f0be45337971",
  ],
  [
    "at",
    "m2-split-point-radius",
    "cutter-at.stl",
    "90694b7b19cde7b02bc71ea500c0213da4004142162855e66502350682be0323",
    "native-at-20261029.stl",
    "42a605d8460e99a367abaef2efbe52d45a69380196f07cc6e2facf91f3a5dfc6",
  ],
  [
    "above",
    "m2-split-point-radius",
    "cutter-above.stl",
    "df8c162f55c96600c9f223c131d98b7ce7e3a43eb85136b8790c08a9487ea29f",
    "native-above-20261029.stl",
    "225f62796f16f8e249b15df46c16c07f32473cc17fad5e8753c742a389914313",
  ],
  [
    "wide-below",
    "m2-split-wide-radius-20261029",
    "cutter-near-0p001-below.stl",
    "c7eb2ecef247eb1679157622cf315a6873f8d949e3bb2eecb8572df58ab98f1f",
    "native-wide-radius-below-20261029.stl",
    "11c7961ed8a23cd1177aa9aea82de56d3d41fb155d75601e4be4a4a31c5fbe89",
  ],
  [
    "wide-above",
    "m2-split-wide-radius-20261029",
    "cutter-near-0p001-above.stl",
    "4b58488fd59bb876bc4acd6891bfbe9fa30d25128baeadeedb95db69c65ac1b5",
    "native-wide-radius-above-20261029.stl",
    "78845bfb3383874ecc79957d14ccfb15cc838900b700396fa70e2ca63bad37a3",
  ],
] as const;

function load(folder: string, name: string, hash: string) {
  const bytes = readFileSync(`tests/fixtures/${folder}/${name}`);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  return parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
}
function facets(values: ArrayLike<number>) {
  return Array.from({ length: values.length / 9 }, (_, face) =>
    [0, 3, 6]
      .map((offset) =>
        [0, 1, 2]
          .map((axis) => Math.fround(values[face * 9 + offset + axis]))
          .join(","),
      )
      .sort()
      .join("|"),
  ).sort();
}
function compare([
  ,
  folder,
  cutterName,
  cutterHash,
  nativeName,
  nativeHash,
]: readonly [string, string, string, string, string, string]) {
  const source = load(folder, "source-triangle.stl", sourceHash);
  const cutter = load(folder, cutterName, cutterHash);
  const native = load(folder, nativeName, nativeHash);
  const output = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  }).positions!;
  expect(facets(output)).toEqual(facets(native));
}

it.each(cases)(
  "pins source, cutter and native export for %s",
  (_name, folder, cutterName, cutterHash, nativeName, nativeHash) => {
    const source = load(folder, "source-triangle.stl", sourceHash);
    const target = load(folder, cutterName, cutterHash);
    expect(source.length).toBe(9);
    expect(target.length).toBeGreaterThan(0);
    expect(load(folder, nativeName, nativeHash).length).toBeGreaterThan(0);
    expect(
      runScanEdit({
        kind: "scanEdit",
        action: "split",
        positions: source,
        target,
      }).positions!.length,
    ).toBeGreaterThan(0);
  },
);

// These known discrepancies remain M2 blockers, not passing parity claims.
it.fails.each(cases.slice(0, 4))(
  "matches retained native Split facets: %s",
  (...row) => compare(row),
);
it("matches retained native Split facets: wide-above", () => compare(cases[4]));

it.each(cases.slice(0, 3))(
  "rejects native source-area loss at the finite assembly boundary: %s",
  (_name, folder, _cutterName, _cutterHash, nativeName, nativeHash) => {
    const native = load(folder, nativeName, nativeHash);
    const vertices: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
    const indices = new Map(
      vertices.map((point, index) => [point.join(","), index]),
    );
    const triangles: [number, number, number][] = [];
    for (let offset = 0; offset < native.length; offset += 9) {
      const face: number[] = [];
      for (let corner = 0; corner < 9; corner += 3) {
        const point: Vec3 = [
          native[offset + corner],
          native[offset + corner + 1],
          native[offset + corner + 2],
        ];
        const key = point.join(",");
        let index = indices.get(key);
        if (index === undefined) {
          index = vertices.length;
          indices.set(key, index);
          vertices.push(point);
        }
        face.push(index);
      }
      triangles.push(face as [number, number, number]);
    }
    expect(() =>
      assembleFiniteFaceMesh(
        new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        [
          {
            ids: [0, 1, 2],
            boundaries: [],
            mesh: {
              vertices,
              triangles,
              constraints: [],
              boundaryVertices: [],
            },
          },
        ],
        { preciseCoordinates: true },
      ),
    ).toThrow(/coverage/i);
  },
);
