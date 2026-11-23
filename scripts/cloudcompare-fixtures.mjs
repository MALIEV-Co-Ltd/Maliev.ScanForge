import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Independent native replay inputs, in mm; no ScanForge registration code.
const directory = resolve(
  process.argv[2] ?? "docs/evidence/cloudcompare-20261028/fixtures",
);
await mkdir(directory, { recursive: true });
const fixed = [];
for (let y = 0; y < 19; y++)
  for (let x = 0; x < 23; x++)
    fixed.push([
      x + 0.07 * Math.sin(y * 1.7),
      y + 0.05 * Math.cos(x * 1.3),
      0.027 * x * x + 0.013 * y * y + 0.08 * Math.sin(x * 0.7 + y),
    ]);
const angle = (2 * Math.PI) / 180;
const c = Math.cos(angle),
  s = Math.sin(angle);
const moving = fixed.map(([x, y, z]) => [
  c * x - s * y + 0.15,
  s * x + c * y - 0.12,
  z + 0.3,
]);
const ply = async (name, points, normals) => {
  const header = [
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    ...(normals
      ? ["property float nx", "property float ny", "property float nz"]
      : []),
    "end_header",
  ];
  await writeFile(
    join(directory, name),
    [
      ...header,
      ...points.map((p, i) => [...p, ...(normals ? normals[i] : [])].join(" ")),
    ].join("\n") + "\n",
  );
};
await ply("fixed.ply", fixed);
await ply("moving.ply", moving);
await ply("collinear.ply", [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
]);
const sphere = Array.from({ length: 1200 }, (_, i) => {
  const z = 1 - (2 * (i + 0.5)) / 1200,
    a = i * Math.PI * (3 - Math.sqrt(5)),
    r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
});
await ply(
  "sphere-normals.ply",
  sphere.map((p) => p.map((v) => v * 10)),
  sphere,
);
await ply(
  "sphere-no-normals.ply",
  sphere.map((p) => p.map((v) => v * 10)),
);
await writeFile(
  join(directory, "truth.json"),
  JSON.stringify(
    {
      units: "mm",
      points: fixed.length,
      movingFromFixed: {
        rotation: [c, -s, 0, s, c, 0, 0, 0, 1],
        translation: [0.15, -0.12, 0.3],
      },
      fixedFromMoving: {
        rotation: [c, s, 0, -s, c, 0, 0, 0, 1],
        translation: [-c * 0.15 + s * 0.12, s * 0.15 + c * 0.12, -0.3],
      },
      pairs: [0, 22, 414, 436],
    },
    null,
    2,
  ) + "\n",
);
console.log(directory);
