import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Actual classic-worker protocol and bundled WASM. Run only in the admitted heavy lane.
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("public/kernel/opencascade.wasm.wasm", root),
);
const requests = new Map();
let id = 0;
const context = vm.createContext({
  console,
  WebAssembly,
  Uint8Array,
  ArrayBuffer,
  TextDecoder,
  TextEncoder,
  URL,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  self: {
    location: { href: new URL("public/cad-worker.js", root).href },
    postMessage(reply) {
      if (reply.progress !== undefined) return;
      const pending = requests.get(reply.id);
      requests.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error));
      else pending.resolve(reply.result);
    },
  },
});
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), "utf8"), context, {
    filename: "opencascade.js",
  });
  const factory = context.opencascade;
  context.opencascade = (options) =>
    factory({ ...options, wasmBinary: binary });
};
vm.runInContext(
  readFileSync(new URL("public/cad-worker.js", root), "utf8"),
  context,
  { filename: "cad-worker.js" },
);
function request(operation, payload) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    requests.set(requestId, { resolve, reject });
    context.self.onmessage({ data: { id: requestId, operation, payload } });
  });
}
const expiry = setTimeout(() => {
  console.error("Sketch surface kernel checks exceeded 90 seconds.");
  process.exit(124);
}, 90_000);
const lines = (points) =>
  points.map((start, i) => ({
    kind: "line",
    start,
    end: points[(i + 1) % points.length],
  }));
const rectangle = lines([
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]);
const circle = [
  {
    kind: "arc",
    start: [2, 0],
    end: [-2, 0],
    center: [0, 0],
    clockwise: false,
  },
  {
    kind: "arc",
    start: [-2, 0],
    end: [2, 0],
    center: [0, 0],
    clockwise: false,
  },
];
const mixed = [{ kind: "line", start: [-2, 0], end: [2, 0] }, circle[0]];
const frame = {
  origin: [10, 20, 30],
  u: [0.6, 0.8, 0],
  v: [0, 0, 1],
  normal: [0.8, -0.6, 0],
};
const close = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-6,
    `${label}: ${actual} versus ${expected}`,
  );
const shapes = vm.runInContext("shapes", context);
const created = [];
async function create(operation, payload) {
  const result = await request(operation, payload);
  created.push(result.kernelId);
  return result;
}
async function inspect(result) {
  return request("inspectBrep", {
    brep: result.brep,
    edgeOffset: 0,
    edgeLimit: 128,
  });
}
try {
  const oc = await vm.runInContext("kernel()", context);
  for (const sample of [
    {
      label: "rectangle",
      edges: rectangle,
      area: 12,
      kinds: ["line", "line", "line", "line"],
    },
    {
      label: "two-arc circle",
      edges: circle,
      area: 4 * Math.PI,
      kinds: ["circle", "circle"],
    },
    {
      label: "clockwise circle",
      edges: circle.map((e) => ({ ...e, clockwise: true })),
      area: 4 * Math.PI,
      kinds: ["circle", "circle"],
    },
    {
      label: "line and arc",
      edges: mixed,
      area: 2 * Math.PI,
      kinds: ["circle", "line"],
    },
  ]) {
    const result = await create("sketchSurface", { edges: sample.edges });
    const shape = shapes.get(result.kernelId);
    assert.ok(
      shape && !shape.isDeleted(),
      `${sample.label} transfers a live face`,
    );
    assert.equal(
      shape.ShapeType().value,
      oc.TopAbs_ShapeEnum.TopAbs_FACE.value,
    );
    assert.ok(result.positions.length > 0 && result.edgePositions.length > 0);
    assert.ok(result.planeFrame, `${sample.label} retains its exact plane`);
    const check = await inspect(result);
    assert.equal(check.valid, true, `${sample.label} native topology`);
    assert.equal(check.faces, 1);
    assert.equal(check.solids, 0);
    assert.equal(check.edges, sample.kinds.length);
    close(check.areaMm2, sample.area, `${sample.label} analytic area`);
    assert.equal(check.volumeMm3, 0);
    assert.deepEqual(
      Array.from(check.edgeReferences.items, (e) => e.kind).sort(),
      sample.kinds,
    );
    if (sample.label.includes("circle"))
      for (const edge of check.edgeReferences.items)
        close(edge.lengthMm, 2 * Math.PI, "exact semicircle length");
  }

  const placed = await create("sketchSurface", { edges: rectangle, frame });
  const placedCheck = await inspect(placed);
  close(placedCheck.areaMm2, 12, "rotated and offset face area");
  const bounds = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (let i = 0; i < placed.positions.length; i++) {
    const axis = i % 3;
    bounds[axis] = Math.min(bounds[axis], placed.positions[i]);
    bounds[axis + 3] = Math.max(bounds[axis + 3], placed.positions[i]);
  }
  [10, 20, 30, 12.4, 23.2, 33].forEach((value, i) =>
    close(bounds[i], value, "rotated and offset display bounds"),
  );
  const plane = placed.planeFrame;
  assert.ok(plane);
  close(
    Math.abs(plane.normal.reduce((sum, n, i) => sum + n * frame.normal[i], 0)),
    1,
    "placed exact plane normal",
  );
  for (const edge of placedCheck.edgeReferences.items)
    for (const point of edge.endpoints)
      close(
        point.reduce(
          (sum, n, i) => sum + (n - frame.origin[i]) * frame.normal[i],
          0,
        ),
        0,
        "exact edge lies in placed plane",
      );

  // Protect the old prism path while its analytic wire/face construction is extracted.
  for (const sample of [
    { edges: rectangle, volume: 36 },
    { edges: circle, volume: 12 * Math.PI },
    { edges: mixed, volume: 6 * Math.PI },
  ]) {
    const result = await create("extrudeCurves", {
      edges: sample.edges,
      height: 3,
      frame,
    });
    const check = await inspect(result);
    assert.equal(check.valid, true);
    assert.equal(check.solids, 1);
    close(
      check.signedVolumeMm3,
      sample.volume,
      "existing analytic extrusion outward volume",
    );
  }

  const thickeningCircle = [
    {
      kind: "arc",
      start: [3.210029929876, 0.06886227428913],
      end: [-2.789970070124, 0.06886227428913],
      center: [0.210029929876, 0.06886227428913],
      clockwise: false,
    },
    {
      kind: "arc",
      start: [-2.789970070124, 0.06886227428913],
      end: [3.210029929876, 0.06886227428913],
      center: [0.210029929876, 0.06886227428913],
      clockwise: false,
    },
  ];
  const thickeningFailures = [];
  const collectThickening = (verify) => {
    try {
      verify();
    } catch (error) {
      thickeningFailures.push(error.message);
    }
  };
  for (const placement of [
    {
      label: "offset OXY",
      frame: {
        origin: [0, 0, 5],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
    { label: "rotated", frame },
  ]) {
    for (const clockwise of [false, true]) {
      const label = `${placement.label} ${clockwise ? "CW" : "CCW"} circle`;
      try {
        const source = await create("sketchSurface", {
          edges: thickeningCircle.map((edge) => ({ ...edge, clockwise })),
          frame: placement.frame,
        });
        const sourceShape = shapes.get(source.kernelId);
        const sourceBrep = context.serializeBrep(oc, sourceShape);
        collectThickening(() => {
          assert.ok(source.planeFrame, `${label} retains its exact plane`);
          close(
            source.planeFrame.normal.reduce(
              (sum, n, i) => sum + n * placement.frame.normal[i],
              0,
            ),
            1,
            `${label} signed face normal agrees with authored normal`,
          );
        });
        for (const thickness of [1.8, -1.8]) {
          const caseLabel = `${label} thickness ${thickness}`;
          try {
            const thickened = await create("thicken", {
              kernelId: source.kernelId,
              thickness,
            });
            collectThickening(() =>
              assert.ok(
                context.serializeBrep(oc, sourceShape) === sourceBrep,
                `${caseLabel} thickening changed the exact source BREP`,
              ),
            );
            const check = await inspect(thickened);
            collectThickening(() =>
              assert.equal(
                check.valid,
                true,
                `${caseLabel} thickened native topology`,
              ),
            );
            collectThickening(() =>
              assert.equal(
                check.solids,
                1,
                `${caseLabel} thickens to one solid`,
              ),
            );
            collectThickening(() =>
              assert.equal(
                check.edgeReferences.nextOffset,
                null,
                `${caseLabel} exact edge page is complete`,
              ),
            );
            const projections = [];
            for (const edge of check.edgeReferences.items) {
              collectThickening(() =>
                assert.ok(
                  edge.endpoints?.length === 2,
                  `${caseLabel} exact edge endpoints`,
                ),
              );
              for (const point of edge.endpoints ?? [])
                projections.push(
                  point.reduce(
                    (sum, n, i) =>
                      sum +
                      (n - placement.frame.origin[i]) *
                        placement.frame.normal[i],
                    0,
                  ),
                );
            }
            collectThickening(() =>
              assert.ok(
                projections.length > 0,
                `${caseLabel} has exact endpoint samples`,
              ),
            );
            collectThickening(() =>
              close(
                Math.min(...projections),
                Math.min(0, thickness),
                `${caseLabel} authored-normal lower extent`,
              ),
            );
            collectThickening(() =>
              close(
                Math.max(...projections),
                Math.max(0, thickness),
                `${caseLabel} authored-normal upper extent`,
              ),
            );
            collectThickening(() =>
              close(
                check.signedVolumeMm3,
                16.2 * Math.PI,
                `${caseLabel} positive analytic thickening volume`,
              ),
            );
          } catch (error) {
            thickeningFailures.push(
              `${caseLabel} request/inspection: ${error.message}`,
            );
          }
        }
      } catch (error) {
        thickeningFailures.push(
          `${label} request/inspection: ${error.message}`,
        );
      }
    }
  }
  try {
    const source = await create("surface", {
      format: "scanforge-nurbs",
      version: 1,
      countU: 2,
      countV: 2,
      degreeU: 1,
      degreeV: 1,
      knotsU: [0, 0, 1, 1],
      knotsV: [0, 0, 1, 1],
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 20, 0],
        [10, 20, 2],
      ],
      weights: [1, 1, 1, 1],
    });
    collectThickening(() =>
      assert.equal(
        source.planeFrame,
        undefined,
        "curved fixture has no plane frame",
      ),
    );
    const sourceShape = shapes.get(source.kernelId);
    const sourceBrep = context.serializeBrep(oc, sourceShape);
    for (const thickness of [0.1, -0.1]) {
      const label = `curved face thickness ${thickness}`;
      try {
        const thickened = await create("thicken", {
          kernelId: source.kernelId,
          thickness,
        });
        collectThickening(() =>
          assert.ok(
            context.serializeBrep(oc, sourceShape) === sourceBrep,
            `${label} changed the exact source BREP`,
          ),
        );
        const check = await inspect(thickened);
        collectThickening(() =>
          assert.equal(check.valid, true, `${label} native topology`),
        );
        collectThickening(() =>
          assert.equal(check.solids, 1, `${label} creates one solid`),
        );
        collectThickening(() =>
          assert.ok(
            check.signedVolumeMm3 > 0,
            `${label} signed volume must be positive: ${check.signedVolumeMm3}`,
          ),
        );
      } catch (error) {
        thickeningFailures.push(
          `${label} request/inspection: ${error.message}`,
        );
      }
    }
  } catch (error) {
    thickeningFailures.push(`curved face creation: ${error.message}`);
  }
  if (thickeningFailures.length)
    throw new Error(
      `Sketch thickening regressions:\n${thickeningFailures.join("\n")}`,
    );

  const branchedProfiles = [
    {
      label: "branch at repeated vertex",
      edges: lines([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
        [-2, 0],
        [-2, -2],
        [0, -2],
      ]),
    },
    {
      label: "branch at near repeated vertex across spatial cells",
      edges: lines([
        [9e-9, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [11e-9, 0],
        [-2, 0],
        [-2, -2],
        [0, -2],
      ]),
    },
  ];
  const invalidProfiles = [
    ["empty", [], /2 to 10000/],
    ["single edge", [circle[0]], /2 to 10000/],
    ["too many edges", Array(10001).fill(rectangle[0]), /2 to 10000/],
    ["open cycle", rectangle.slice(0, 3), /closed cycle/],
    [
      "zero length",
      [{ ...rectangle[0], end: [0, 0] }, ...rectangle.slice(1)],
      /closed cycle/,
    ],
    [
      "inconsistent arc radii",
      [{ ...circle[0], center: [1, 0] }, circle[1]],
      /radii/,
    ],
    [
      "zero arc radius",
      [
        {
          kind: "arc",
          start: [0, 0],
          end: [2, 0],
          center: [0, 0],
          clockwise: false,
        },
        { kind: "line", start: [2, 0], end: [0, 0] },
      ],
      /radii/,
    ],
    [
      "unknown edge",
      [{ ...rectangle[0], kind: "spline" }, ...rectangle.slice(1)],
      /Unknown sketch/,
    ],
    [
      "nonfinite coordinate",
      [{ ...rectangle[0], start: [NaN, 0] }, ...rectangle.slice(1)],
      /coordinates|closed cycle/,
    ],
    [
      "unbounded coordinate",
      [{ ...rectangle[0], start: [1e10, 0] }, ...rectangle.slice(1)],
      /coordinates|closed cycle/,
    ],
    [
      "zero area",
      lines([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
      /zero area/,
    ],
    [
      "tiny area",
      lines([
        [0, 0],
        [0.00002, 0],
        [0.00002, 0.00001],
        [0, 0.00001],
      ]),
      /zero area/,
    ],
    [
      "self intersection",
      lines([
        [0, 0],
        [4, 3],
        [0, 3],
        [3, 0],
      ]),
      /intersects|invalid geometry/,
    ],
    ...branchedProfiles.map(({ label, edges }) => [
      label,
      edges,
      /intersects|invalid geometry/,
    ]),
    [
      "disconnected cycles",
      [
        ...rectangle,
        ...lines([
          [8, 0],
          [9, 0],
          [9, 1],
          [8, 1],
        ]),
      ],
      /closed cycle/,
    ],
  ];
  const retained = shapes.size;
  for (const [label, edges, error] of invalidProfiles) {
    await assert.rejects(request("sketchSurface", { edges }), error, label);
    assert.equal(shapes.size, retained, `${label} must not retain a shape`);
  }
  for (const { label, edges } of branchedProfiles) {
    await assert.rejects(
      request("extrudeCurves", { edges, height: 3 }),
      /intersects|invalid geometry/,
      `existing extrusion also rejects ${label}`,
    );
    assert.equal(shapes.size, retained, `${label} extrusion retains no output`);
  }
  for (const invalid of [
    null,
    { ...frame, origin: [0, 0] },
    { ...frame, origin: [Infinity, 0, 0] },
    { ...frame, origin: [1e10, 0, 0] },
    { ...frame, u: [2, 0, 0] },
    { ...frame, v: frame.u },
    { ...frame, normal: [-0.8, 0.6, 0] },
  ]) {
    await assert.rejects(
      request("sketchSurface", { edges: rectangle, frame: invalid }),
      /frame/i,
    );
    assert.equal(
      shapes.size,
      retained,
      "invalid frame retains no native output",
    );
  }
  await assert.rejects(
    request("sketchSurface", {
      edges: rectangle,
      frame: { ...frame, origin: [1e9, 0, 0] },
    }),
    /Placed sketch coordinates/,
  );
  assert.equal(
    shapes.size,
    retained,
    "placed-coordinate failure retains no output",
  );
  const owned = created.map((kernelId) => shapes.get(kernelId));
  await request("release", created.splice(0));
  assert.ok(
    owned.every((shape) => shape.isDeleted()),
    "release deletes every transferred face, prism and thickened solid",
  );
  assert.equal(shapes.size, 0);
  assert.equal(requests.size, 0);
  console.log(
    "Exact sketch surface geometry, thickening direction, validation, ownership and extrusion regression checks passed.",
  );
} finally {
  try {
    if (shapes.size) await request("release", [...shapes.keys()]);
  } finally {
    clearTimeout(expiry);
  }
}
