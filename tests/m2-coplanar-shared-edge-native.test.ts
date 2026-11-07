import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "1f062fa356f8cf9145d9d9fdfc236031c23acb0f2c416444db20555d063d5ac5",
  "cutter.stl":
    "d1520467d19d1aed82ff52d74218fd773f557ad36c4ada1eb1b99ecc5bb098b0",
  "native-source-split.stl":
    "fd467c80acc748d993bf1a4cfffb77a872a1c476d9a8dad8bf528b81f20b7883",
  "native-cutter.stl":
    "f1cae3c8bbb9b9a376312509876ad88d4b25757d65018e74f59493431596833c",
  "coplanar-shared-edge-native.qsf":
    "af5ebaaa346b469c5c8c6d3417bf50abbe6f0f23c9de5c8a994facbe38ab84fd",
} as const;

function bytes(name: keyof typeof hashes) {
  const data = readFileSync(
    new URL(
      `./fixtures/m2-coplanar-shared-edge-native-pending-20261106/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(data).digest("hex")).toBe(hashes[name]);
  return data;
}

function mesh(
  name: Exclude<keyof typeof hashes, "coplanar-shared-edge-native.qsf">,
) {
  const data = bytes(name);
  return parseMesh(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
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

it("pins the native split and its disconnected indexed shared edge", () => {
  expect(facets(mesh("native-cutter.stl"))).toEqual(facets(mesh("cutter.stl")));
  const data = bytes("coplanar-shared-edge-native.qsf");
  expect(data.readUInt32LE(456)).toBe(8);
  expect(data.readUInt32LE(556)).toBe(4);
  const vertices = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => data.readFloatLE(460 + i * 12 + a * 4)),
  );
  const faces = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) =>
      data.readUInt32LE(560 + i * 12 + a * 4),
    ),
  );
  expect(
    facets(faces.flatMap((face) => face.flatMap((i) => vertices[i]))),
  ).toEqual(facets(mesh("native-source-split.stl")));
  expect(faces).toEqual([
    [4, 3, 2],
    [4, 2, 0],
    [3, 1, 2],
    [5, 7, 6],
  ]);
  expect(vertices[0]).toEqual(vertices[6]);
  expect(vertices[1]).toEqual(vertices[7]);
  expect(vertices[3][1]).toBeCloseTo(0.3);
  expect(vertices[4][1]).toBeCloseTo(0.7);
});

it("records the current shared operation's different, conforming result", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(result.positions!.length / 9).toBe(8);
  expect(facets(result.positions!)).not.toEqual(
    facets(mesh("native-source-split.stl")),
  );
});
