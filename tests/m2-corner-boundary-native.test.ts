import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter.stl":
    "19267a18ef340ccba57624ca4ef57631b8d9f65643ee7f59e83fc4102ac401c0",
  "cutter-roundtrip.stl":
    "b6f276a4f7d52356ffaecce779c41b33ee0c8e74d2748b65f823c9ff9da54d69",
  "native-result.stl":
    "08159f9fb9b795981f72aedb03556eec79ecb16a619bbf8959d6f0af07795e67",
  "session.qsf":
    "50e449d99778b5294c6fafbfa86e5020292cdd9faf4ec894e7a41cf0a6f4cae6",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-corner-boundary-native-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hashes[name]);
  return b;
}
function mesh(name: Exclude<keyof typeof hashes, "session.qsf">) {
  const b = bytes(name);
  return parseMesh(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "stl",
  );
}
function facets(v: ArrayLike<number>) {
  return Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[f * 9 + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
}
it("pins the native source, cutter and separated indexed result", () => {
  expect(facets(mesh("cutter.stl"))).toEqual(
    facets(mesh("cutter-roundtrip.stl")),
  );
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(6);
  const vertices = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(532)).toBe(2);
  const faces = Array.from({ length: 2 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(536 + 12 * i + 4 * a)),
  );
  expect(facets(faces.flatMap((f) => f.flatMap((i) => vertices[i])))).toEqual(
    facets(mesh("native-result.stl")),
  );
  expect(faces[0].every((id) => !faces[1].includes(id))).toBe(true);
});
it("matches native corner-to-boundary facets and disconnected indices", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
  const indices = result.indexedMesh!.triangles;
  expect(indices.length).toBe(6);
  expect(
    Array.from(indices.slice(0, 3)).every(
      (id) => !Array.from(indices.slice(3, 6)).includes(id),
    ),
  ).toBe(true);
});
