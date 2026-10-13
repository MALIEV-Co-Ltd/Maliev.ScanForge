import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Exercise the actual classic-worker protocol without a server or detached worker.
// Run only after resource admission: WASM initialization requires substantial RAM.
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
      if (reply.progress !== undefined) {
        requests.get(reply.id)?.onProgress?.(reply.progress);
        return;
      }
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
  readFileSync(new URL("public/cad-worker.js", root), "utf8").replace(
    "error instanceof Error ? error.message",
    "error instanceof Error ? error.stack",
  ),
  context,
  { filename: "cad-worker.js" },
);
function request(operation, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    requests.set(requestId, { resolve, reject, onProgress });
    context.self.onmessage({ data: { id: requestId, operation, payload } });
  });
}
const expiry = setTimeout(() => {
  console.error("CAD smoke exceeded 90 seconds.");
  process.exit(1);
}, 90_000);
function volume(positions) {
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    result +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(result / 6);
}
function bounds(positions) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return [...min, ...max];
}
function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-6,
    `${message}: ${actual} versus ${expected}`,
  );
}
try {
  const oc = await vm.runInContext("kernel()", context);
  const planeHandles = [];
  let exactPlane;
  try {
    const wire = context.polygonWire(
      oc,
      [
        [2, 3, 4],
        [5, 3, 7],
        [5, 9, 7],
        [2, 9, 4],
      ],
      planeHandles,
    );
    const maker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    planeHandles.push(maker);
    exactPlane = context.register(oc, maker.Face());
  } finally {
    context.cleanup(planeHandles);
  }
  assert.ok(
    exactPlane.planeFrame,
    "Analytic planar CAD extracts a stored frame",
  );
  const assertPlaneFrame = (result) => {
    const frame = result.planeFrame;
    assert.ok(frame, "Exact plane frame retained");
    close(Math.hypot(...frame.normal), 1, "Plane unit normal");
    close(Math.hypot(...frame.tangent), 1, "Plane unit tangent");
    close(
      frame.normal.reduce((s, n, i) => s + n * frame.tangent[i], 0),
      0,
      "Plane axes orthogonal",
    );
    for (let i = 0; i < result.positions.length; i += 3)
      close(
        frame.normal.reduce(
          (s, n, a) => s + n * (result.positions[i + a] - frame.center[a]),
          0,
        ),
        0,
        "Plane frame matches world CAD geometry",
      );
  };
  assertPlaneFrame(exactPlane);
  const exactPlaneStep = await request("export", [exactPlane.kernelId]);
  if (process.env.SCANFORGE_QA_PLANE_STEP)
    writeFileSync(process.env.SCANFORGE_QA_PLANE_STEP, exactPlaneStep);
  const restoredPlane = await request("import", {
    data: exactPlaneStep,
    extension: "step",
  });
  assertPlaneFrame(restoredPlane);
  for (const key of ["center", "normal", "tangent"])
    restoredPlane.planeFrame[key].forEach((v, i) =>
      close(v, exactPlane.planeFrame[key][i], `STEP plane ${key}`),
    );
  const restoredPlaneBrep = await request("import", {
    data: new TextEncoder().encode(restoredPlane.brep),
    extension: "brep",
  });
  assertPlaneFrame(restoredPlaneBrep);
  const movedPlane = await request("transform", {
    kernelId: restoredPlaneBrep.kernelId,
    translation: [7, -2, 5],
    rotation: [15, 35, 70],
    scale: 2,
  });
  assertPlaneFrame(movedPlane);
  assert.notDeepEqual(
    movedPlane.planeFrame.tangent,
    restoredPlaneBrep.planeFrame.tangent,
  );
  const box = await request("primitive", {
    kind: "box",
    center: [0, 0, 0],
    size: [10, 20, 30],
  });
  assert.equal(box.positions.length, 108);
  assert.equal(
    box.planeFrame,
    undefined,
    "A multi-face solid is not one plane reference",
  );
  assert.equal(
    box.edgePositions.length,
    72,
    "Box has 12 unique topology edges, without face diagonals",
  );
  const planarPatch = (origin, u, v) => ({
    format: "scanforge-nurbs",
    version: 1,
    degreeU: 1,
    degreeV: 1,
    countU: 2,
    countV: 2,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 1, 1],
    points: [
      origin,
      origin.map((x, i) => x + u[i]),
      origin.map((x, i) => x + v[i]),
      origin.map((x, i) => x + u[i] + v[i]),
    ],
    weights: [1, 1, 1, 1],
  });
  const shellPatches = [
    planarPatch([0, 0, 0], [0, 0, 30], [0, 20, 0]),
    planarPatch([10, 0, 0], [0, 20, 0], [0, 0, 30]),
    planarPatch([0, 0, 0], [10, 0, 0], [0, 0, 30]),
    planarPatch([0, 20, 0], [0, 0, 30], [10, 0, 0]),
    planarPatch([0, 0, 0], [0, 20, 0], [10, 0, 0]),
    planarPatch([0, 0, 30], [10, 0, 0], [0, 20, 0]),
  ];
  const beforeShell = vm.runInContext("shapes.size", context);
  const reconstructed = await request("closedShell", {
    patches: shellPatches,
    tolerance: 1e-6,
  });
  close(
    volume(reconstructed.positions),
    6000,
    "Closed patch reconstruction volume",
  );
  assert.deepEqual(bounds(reconstructed.positions), [0, 0, 0, 10, 20, 30]);
  assert.equal(
    vm.runInContext("shapes.size", context),
    beforeShell + 1,
    "temporary CAD faces released",
  );
  const reconstructedStep = await request("export", [reconstructed.kernelId]);
  const reconstructedRoundtrip = await request("import", {
    data: reconstructedStep,
    extension: "step",
  });
  close(
    volume(reconstructedRoundtrip.positions),
    6000,
    "Reconstructed STEP solid volume",
  );
  const beforeInvalidShell = vm.runInContext("shapes.size", context);
  await assert.rejects(
    request("closedShell", { patches: shellPatches.slice(1), tolerance: 1e-6 }),
    /closed|boundaries/,
  );
  assert.equal(
    vm.runInContext("shapes.size", context),
    beforeInvalidShell,
    "failed reconstruction released faces",
  );
  assert.ok(box.positions.every(Number.isFinite));
  assert.ok(box.brep.length > 100);
  const brep = await request("import", {
    data: new TextEncoder().encode(box.brep),
    extension: "brep",
  });
  assert.deepEqual(brep.positions, box.positions);
  const sphere = await request("primitive", {
    kind: "sphere",
    center: [20, 5, 2],
    radius: 3,
  });
  assert.ok(
    sphere.positions.length / 9 > 2000,
    "Fine curved-body display tessellation",
  );
  assert.equal(sphere.normals.length, sphere.positions.length);
  for (let i = 0; i < sphere.normals.length; i += 3)
    assert.ok(
      Math.abs(Math.hypot(...sphere.normals.slice(i, i + 3)) - 1) < 1e-6,
      "Unit CAD surface normal",
    );
  const sphereStep = await request("export", [sphere.kernelId]);
  const progress = [];
  const sphereRestored = await request(
    "import",
    {
      data: sphereStep,
      extension: "step",
    },
    (value) => progress.push(value),
  );
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(
    progress.length >= 8 &&
      progress.every((v, i) => !i || v >= progress[i - 1]),
    "Actual CAD import reports ordered stages and tessellation progress",
  );
  assert.ok(
    sphereRestored.edgePositions.length > 72,
    "Curved STEP topology has sampled edge segments",
  );
  assert.ok(sphereRestored.brep.length > 100);
  assert.equal(sphereRestored.normals.length, sphereRestored.positions.length);
  const probePoint = sphereRestored.positions.slice(0, 3),
    probeNormal = sphereRestored.normals.slice(0, 3);
  const outward = probePoint.map((value, i) => value - [20, 5, 2][i]);
  assert.ok(
    probeNormal.reduce((sum, value, i) => sum + value * outward[i], 0) /
      Math.hypot(...outward) >
      0.99,
    "STEP normals follow the exact outward surface direction",
  );
  if (process.env.SCANFORGE_QA_STEP)
    writeFileSync(process.env.SCANFORGE_QA_STEP, sphereStep);

  const cylinder = await request("primitive", {
    kind: "cylinder",
    center: [1, 2, 3],
    axis: [1, 0, 0],
    radius: 4,
    height: 12,
  });
  assert.ok(cylinder.positions.length > 108);
  const step = await request("export", [
    box.kernelId,
    sphere.kernelId,
    cylinder.kernelId,
  ]);
  assert.match(new TextDecoder().decode(step), /ISO-10303-21/);
  const imported = await request("import", { data: step, extension: "step" });
  assert.ok(imported.positions.length >= box.positions.length);
  const first = await request("primitive", {
    kind: "box",
    center: [0, 0, 0],
    size: [10, 10, 10],
  });
  const second = await request("primitive", {
    kind: "box",
    center: [5, 0, 0],
    size: [10, 10, 10],
  });
  for (const [operation, expectedVolume] of [
    ["union", 1500],
    ["subtract", 500],
    ["intersect", 500],
  ]) {
    const result = await request("boolean", {
      operation,
      firstId: first.kernelId,
      secondId: second.kernelId,
    });
    close(volume(result.positions), expectedVolume, `${operation} volume`);
    assert.ok(result.brep.length > 100);
    const encoded = await request("export", [result.kernelId]);
    const roundtrip = await request("import", {
      data: encoded,
      extension: "step",
    });
    close(
      volume(roundtrip.positions),
      expectedVolume,
      `${operation} STEP roundtrip volume`,
    );
  }
  const transformed = await request("transform", {
    kernelId: box.kernelId,
    translation: [5, 10, 20],
    rotation: [0, 0, 90],
    scale: 2,
  });
  bounds(transformed.positions).forEach((value, i) =>
    close(value, [-15, 0, -10, 25, 20, 50][i], "Transform bounds"),
  );
  close(volume(transformed.positions), 48000, "Scaled box volume");
  assert.ok(transformed.brep.length > 100);
  const transformedBrep = await request("import", {
    data: new TextEncoder().encode(transformed.brep),
    extension: "brep",
  });
  bounds(transformedBrep.positions).forEach((value, i) =>
    close(value, bounds(transformed.positions)[i], "Transformed BREP bounds"),
  );
  const angles = [13, -21, 42];
  const arbitrary = await request("transform", {
    kernelId: box.kernelId,
    translation: [3, -4, 6],
    rotation: angles,
    scale: 1.2,
  });
  const expectedPositions = [];
  for (let i = 0; i < box.positions.length; i += 3) {
    let [x, y, z] = box.positions.slice(i, i + 3).map((value) => value * 1.2);
    const [rx, ry, rz] = angles.map((value) => (value * Math.PI) / 180);
    [y, z] = [
      y * Math.cos(rx) - z * Math.sin(rx),
      y * Math.sin(rx) + z * Math.cos(rx),
    ];
    [x, z] = [
      x * Math.cos(ry) + z * Math.sin(ry),
      -x * Math.sin(ry) + z * Math.cos(ry),
    ];
    [x, y] = [
      x * Math.cos(rz) - y * Math.sin(rz),
      x * Math.sin(rz) + y * Math.cos(rz),
    ];
    expectedPositions.push(x + 3, y - 4, z + 6);
  }
  bounds(arbitrary.positions).forEach((value, i) =>
    close(value, bounds(expectedPositions)[i], "XYZ transform order bounds"),
  );
  const extrusion = await request("extrude", {
    points: [
      [0, 0],
      [10, 0],
      [10, 20],
      [0, 20],
    ],
    height: 3,
  });
  close(volume(extrusion.positions), 600, "Extrusion volume");
  bounds(extrusion.positions).forEach((value, i) =>
    close(value, [0, 0, 0, 10, 20, 3][i], "Extrusion bounds"),
  );
  // Actual worker and STEP output must share the sketch's rigid placement.
  const profile = [
    [0, 0],
    [10, 0],
    [10, 20],
    [0, 20],
  ];
  for (const [frame, expected] of [
    [
      { origin: [0, 0, 7], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
      [0, 0, 7, 10, 20, 10],
    ],
    [
      { origin: [21, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
      [21, 0, 0, 24, 10, 20],
    ],
    [
      { origin: [0, -5, 0], u: [0, 0, 1], v: [1, 0, 0], normal: [0, 1, 0] },
      [0, -5, 0, 20, -2, 10],
    ],
    [
      {
        origin: [4, 5, 6],
        u: [0.6, 0.8, 0],
        v: [-0.8, 0.6, 0],
        normal: [0, 0, 1],
      },
      [-12, 5, 6, 10, 25, 9],
    ],
    [
      {
        origin: [4, 5, 6],
        u: [0.6, 0, 0.8],
        v: [0, 1, 0],
        normal: [-0.8, 0, 0.6],
      },
      [1.6, 5, 6, 10, 25, 15.8],
    ],
  ]) {
    const placed = await request("extrude", {
      points: profile,
      height: 3,
      frame,
    });
    bounds(placed.positions).forEach((n, i) =>
      close(n, expected[i], "Placed extrusion bounds"),
    );
    close(volume(placed.positions), 600, "Placed extrusion volume");
    const data = await request("export", [placed.kernelId]);
    const restored = await request("import", { data, extension: "step" });
    bounds(restored.positions).forEach((n, i) =>
      close(n, expected[i], "Placed STEP roundtrip bounds"),
    );
    await request("release", [placed.kernelId, restored.kernelId]);
  }
  const handlesBeforeBadFrame = vm.runInContext("shapes.size", context);
  for (const frame of [
    { origin: [0, 0, 0], u: [2, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, -1] },
    { origin: [NaN, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  ])
    await assert.rejects(
      request("extrude", { points: profile, height: 3, frame }),
      /frame/i,
    );
  assert.equal(
    vm.runInContext("shapes.size", context),
    handlesBeforeBadFrame,
    "Invalid frame retains handle ownership",
  );
  const concave = await request("extrude", {
    points: [
      [0, 0],
      [0, 10],
      [5, 10],
      [5, 5],
      [10, 5],
      [10, 0],
      [0, 0],
    ],
    height: 4,
  });
  close(
    volume(concave.positions),
    300,
    "Clockwise closed concave polygon volume",
  );
  await assert.rejects(
    request("extrude", {
      points: [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ],
      height: 3,
    }),
    /intersect/,
  );
  await assert.rejects(
    request("extrude", {
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      height: 3,
    }),
    /area/,
  );
  await assert.rejects(
    request("primitive", {
      kind: "box",
      center: [1e10, 0, 0],
      size: [1, 1, 1],
    }),
    /finite/,
  );
  await assert.rejects(
    request("transform", {
      kernelId: box.kernelId,
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 0,
    }),
    /positive/,
  );
  function exactVolume(kernelId) {
    const shape = vm.runInContext(
      `shapes.get(${JSON.stringify(kernelId)})`,
      context,
    );
    const properties = new oc.GProp_GProps_1();
    try {
      // Integrate analytic surfaces, not tessellation approximations.
      oc.BRepGProp.VolumeProperties_1(shape, properties, true, false, false);
      return Math.abs(properties.Mass());
    } finally {
      properties.delete();
    }
  }
  const cone = await request("primitive", {
    kind: "cone",
    center: [1, 2, 3],
    axis: [1, 0, 0],
    radius: 4,
    topRadius: 2,
    height: 12,
  });
  close(
    exactVolume(cone.kernelId),
    112 * Math.PI,
    "Oriented cone exact volume",
  );
  const pointedCone = await request("primitive", {
    kind: "cone",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    radius: 4,
    topRadius: 0,
    height: 9,
  });
  close(
    exactVolume(pointedCone.kernelId),
    48 * Math.PI,
    "Pointed cone exact volume",
  );
  const equalRadiusCone = await request("primitive", {
    kind: "cone",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    radius: 4,
    topRadius: 4,
    height: 9,
  });
  close(
    exactVolume(equalRadiusCone.kernelId),
    144 * Math.PI,
    "Equal cone radii cylinder limit",
  );
  for (const [angleDegrees, expected] of [
    [360, 4500 * Math.PI],
    [180, 2250 * Math.PI],
  ]) {
    const revolved = await request("revolve", {
      points: [
        [10, 0],
        [20, 0],
        [20, 15],
        [10, 15],
      ],
      angleDegrees,
    });
    close(
      exactVolume(revolved.kernelId),
      expected,
      `${angleDegrees} degree revolve exact volume`,
    );
    const encoded = await request("export", [revolved.kernelId]);
    const roundtrip = await request("import", {
      data: encoded,
      extension: "step",
    });
    close(
      exactVolume(roundtrip.kernelId),
      expected,
      `${angleDegrees} degree revolve STEP roundtrip volume`,
    );
    assert.ok(revolved.positions.every(Number.isFinite));
  }
  const axisTouching = await request("revolve", {
    points: [
      [0, 0],
      [4, 0],
      [4, 9],
      [0, 9],
      [0, 0],
    ],
    angleDegrees: 360,
  });
  close(
    exactVolume(axisTouching.kernelId),
    144 * Math.PI,
    "Axis-touching closed revolve profile volume",
  );
  const coneStep = await request("export", [cone.kernelId]);
  const coneRoundtrip = await request("import", {
    data: coneStep,
    extension: "step",
  });
  close(
    exactVolume(coneRoundtrip.kernelId),
    112 * Math.PI,
    "Cone STEP roundtrip volume",
  );
  await assert.rejects(
    request("revolve", {
      points: [
        [-1, 0],
        [4, 0],
        [4, 9],
        [-1, 9],
      ],
      angleDegrees: 360,
    }),
    /radii/,
  );
  for (const angleDegrees of [0, -90, 361, NaN])
    await assert.rejects(
      request("revolve", {
        points: [
          [0, 0],
          [4, 0],
          [4, 9],
          [0, 9],
        ],
        angleDegrees,
      }),
      /angle/,
    );
  await assert.rejects(
    request("revolve", {
      points: [
        [0, 0],
        [4, 9],
        [0, 9],
        [4, 0],
      ],
      angleDegrees: 180,
    }),
    /intersect/,
  );
  for (const invalid of [{ topRadius: -1 }, { axis: [0, 0, 0] }, { height: 0 }])
    await assert.rejects(
      request("primitive", {
        kind: "cone",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 4,
        topRadius: 2,
        height: 9,
        ...invalid,
      }),
      /valid/,
    );
  const square = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ];
  const patch = {
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
      [10, 20, 0],
    ],
    weights: [1, 1, 1, 1],
  };
  const nurbs = await request("surface", patch);
  assert.ok(nurbs.planeFrame, "Planar NURBS retains an exact UV plane frame");
  assertPlaneFrame(nurbs);
  [5, 10, 0].forEach((value, axis) =>
    close(nurbs.planeFrame.center[axis], value, "Exact NURBS frame center"),
  );
  [1, 0, 0].forEach((value, axis) =>
    close(nurbs.planeFrame.tangent[axis], value, "Exact NURBS U tangent"),
  );
  assert.deepEqual(
    bounds(nurbs.positions),
    [0, 0, 0, 10, 20, 0],
    "Exact NURBS planar face bounds",
  );
  const patchStep = await request("export", [nurbs.kernelId]);
  const thickened = await request("thicken", {
    kernelId: nurbs.kernelId,
    thickness: 2,
  });
  close(
    exactVolume(thickened.kernelId),
    400,
    "Planar NURBS thickening exact volume",
  );
  const patchImported = await request("import", {
    data: patchStep,
    extension: "step",
  });
  assertPlaneFrame(patchImported);
  for (const field of ["center", "normal", "tangent"])
    nurbs.planeFrame[field].forEach((value, axis) =>
      close(
        patchImported.planeFrame[field][axis],
        value,
        `NURBS STEP ${field}`,
      ),
    );
  const tiltedNurbs = await request("surface", {
    ...patch,
    points: [
      [2, 3, 4],
      [5, 3, 7],
      [2, 9, 4],
      [5, 9, 7],
    ],
    weights: [1, 2, 3, 4],
  });
  assertPlaneFrame(tiltedNurbs);
  const movedNurbs = await request("transform", {
    kernelId: tiltedNurbs.kernelId,
    translation: [7, -2, 5],
    rotation: [15, 35, 70],
    scale: 2,
  });
  assertPlaneFrame(movedNurbs);
  assert.notDeepEqual(
    movedNurbs.planeFrame.tangent,
    tiltedNurbs.planeFrame.tangent,
  );
  const movedNurbsStep = await request("export", [movedNurbs.kernelId]);
  const restoredNurbs = await request("import", {
    data: movedNurbsStep,
    extension: "step",
  });
  assertPlaneFrame(restoredNurbs);
  for (const field of ["center", "normal", "tangent"])
    movedNurbs.planeFrame[field].forEach((value, axis) =>
      close(
        restoredNurbs.planeFrame[field][axis],
        value,
        `Tilted NURBS ${field}`,
      ),
    );
  if (process.env.SCANFORGE_QA_NURBS_STEP)
    writeFileSync(process.env.SCANFORGE_QA_NURBS_STEP, movedNurbsStep);
  const interiorCurved = await request("surface", {
    ...patch,
    countU: 3,
    countV: 3,
    degreeU: 2,
    degreeV: 2,
    knotsU: [0, 0, 0, 1, 1, 1],
    knotsV: [0, 0, 0, 1, 1, 1],
    points: [
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [5, 10, 4],
      [10, 10, 0],
      [0, 20, 0],
      [5, 20, 0],
      [10, 20, 0],
    ],
    weights: Array(9).fill(1),
  });
  assert.equal(
    interiorCurved.planeFrame,
    undefined,
    "Coplanar corners do not make a curved control net planar",
  );
  assert.deepEqual(
    bounds(patchImported.positions),
    bounds(nurbs.positions),
    "NURBS STEP face roundtrip",
  );
  await assert.rejects(
    request("surface", { ...patch, weights: [1, 0, 1, 1] }),
    /weights/,
  );
  const rationalPatch = {
    ...patch,
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [0, 20, 0],
      [10, 20, 8],
    ],
    weights: [1, 2, 3, 4],
  };
  const rational = await request("surface", rationalPatch);
  assert.equal(
    rational.planeFrame,
    undefined,
    "Curved rational face has no plane frame",
  );
  function midpoint(kernelId) {
    const shape = vm.runInContext(
      `shapes.get(${JSON.stringify(kernelId)})`,
      context,
    );
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let current, face, surface, point;
    try {
      current = explorer.Current();
      face = oc.TopoDS.Face_1(current);
      surface = oc.BRep_Tool.Surface_2(face);
      point = surface.get().Value(0.5, 0.5);
      return [point.X(), point.Y(), point.Z()];
    } finally {
      point?.delete();
      surface?.delete();
      face?.delete();
      current?.delete();
      explorer.delete();
    }
  }
  midpoint(rational.kernelId).forEach((value, i) =>
    close(value, [6, 14, 3.2][i], "Exact rational curved face midpoint"),
  );
  const rationalStep = await request("export", [rational.kernelId]);
  const rationalImported = await request("import", {
    data: rationalStep,
    extension: "step",
  });
  assert.equal(
    rationalImported.normals.length,
    rationalImported.positions.length,
  );
  midpoint(rationalImported.kernelId).forEach((value, i) =>
    close(value, [6, 14, 3.2][i], "Rational weights survive STEP roundtrip"),
  );
  const lofted = await request("loft", {
    profiles: [
      { points: square, z: 0 },
      { points: square, z: 10 },
    ],
    ruled: true,
  });
  close(exactVolume(lofted.kernelId), 160, "Ruled loft exact volume");
  const shelled = await request("shell", {
    kernelId: lofted.kernelId,
    faceIndices: [0],
    thickness: -0.5,
  });
  assert.ok(
    exactVolume(shelled.kernelId) > 0 && exactVolume(shelled.kernelId) < 160,
    "Removing a face creates hollow walls",
  );
  const swept = await request("sweep", {
    points: square,
    path: [
      [0, 0, 0],
      [0, 0, 10],
    ],
  });
  close(exactVolume(swept.kernelId), 160, "Straight sweep exact volume");
  const bentSweep = await request("sweep", {
    points: square,
    path: [
      [0, 0, 0],
      [0, 0, 10],
      [10, 0, 10],
    ],
  });
  close(
    exactVolume(bentSweep.kernelId),
    320,
    "Right-corner sweep exact volume",
  );
  const treated = [];
  for (const operation of ["fillet", "chamfer"]) {
    const shape = await request("edges", {
      kernelId: lofted.kernelId,
      edgeIndices: [0],
      amount: 0.5,
      operation,
    });
    assert.ok(
      exactVolume(shape.kernelId) > 0 && exactVolume(shape.kernelId) < 160,
      `${operation} reduces box volume`,
    );
    treated.push(shape);
  }
  const offset = await request("offset", {
    kernelId: lofted.kernelId,
    distance: 1,
  });
  assert.ok(
    exactVolume(offset.kernelId) > 160,
    "Positive offset grows solid volume",
  );
  const sewn = await request("sew", {
    kernelIds: [lofted.kernelId],
    tolerance: 1e-6,
  });
  assert.ok(sewn.positions.length > 0, "Sew retains connected CAD faces");
  for (const shape of [
    lofted,
    swept,
    bentSweep,
    ...treated,
    offset,
    sewn,
    thickened,
    shelled,
  ]) {
    const data = await request("export", [shape.kernelId]);
    const imported = await request("import", { data, extension: "step" });
    close(
      exactVolume(imported.kernelId),
      exactVolume(shape.kernelId),
      "Advanced CAD STEP roundtrip volume",
    );
  }
  await assert.rejects(
    request("edges", {
      kernelId: lofted.kernelId,
      edgeIndices: [999],
      amount: 0.5,
      operation: "fillet",
    }),
    /outside/,
  );
  await assert.rejects(
    request("loft", {
      profiles: [
        { points: square, z: 0 },
        { points: square, z: 0 },
      ],
    }),
    /increase/,
  );
  await assert.rejects(
    request("sweep", {
      points: square,
      path: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    }),
    /zero-length/,
  );
  const linearPattern = await request("pattern", {
    kernelId: first.kernelId,
    kind: "linear",
    count: 3,
    step: [30, 0, 0],
  });
  close(
    exactVolume(linearPattern.kernelId),
    3000,
    "Exact linear compound summed volume",
  );
  bounds(linearPattern.positions).forEach((value, i) =>
    close(value, [-5, -5, -5, 65, 5, 5][i], "Linear spacing bounds"),
  );
  const patternSeed = await request("primitive", {
    kind: "box",
    center: [10, 2, 3],
    size: [2, 4, 6],
  });
  const circularPattern = await request("pattern", {
    kernelId: patternSeed.kernelId,
    kind: "circular",
    count: 4,
    center: [0, 0, 0],
    axis: [0, 0, 2],
    angleDegrees: 90,
  });
  close(
    exactVolume(circularPattern.kernelId),
    192,
    "Exact circular pattern summed volume",
  );
  bounds(circularPattern.positions).forEach((value, i) =>
    close(value, [-11, -11, 0, 11, 11, 6][i], "Circular rotation bounds"),
  );
  const mirrored = await request("mirror", {
    kernelId: patternSeed.kernelId,
    planeOrigin: [5, 0, 0],
    normal: [2, 0, 0],
  });
  close(
    exactVolume(mirrored.kernelId),
    48,
    "Mirror preserves native solid volume",
  );
  bounds(mirrored.positions).forEach((value, i) =>
    close(value, [-1, 0, 0, 1, 4, 6][i], "Offset mirror plane bounds"),
  );
  const diagonalMirror = await request("mirror", {
    kernelId: patternSeed.kernelId,
    planeOrigin: [0, 0, 0],
    normal: [1, 1, 0],
  });
  bounds(diagonalMirror.positions).forEach((value, i) =>
    close(value, [-4, -11, 0, 0, -9, 6][i], "Diagonal mirror plane bounds"),
  );
  const splitParts = await request("split", {
    kernelId: first.kernelId,
    cutterId: second.kernelId,
  });
  assert.equal(splitParts.length, 2);
  for (const part of splitParts)
    close(exactVolume(part.kernelId), 500, "Split half native volume");
  close(
    splitParts.reduce((sum, part) => sum + exactVolume(part.kernelId), 0),
    exactVolume(first.kernelId),
    "Split conserves material volume",
  );
  const handleCount = vm.runInContext("shapes.size", context);
  vm.runInContext(
    "globalThis.savedRegistration=register;globalThis.registrationCount=0;register=(oc,shape)=>{if(++globalThis.registrationCount===2){shape.delete();throw new Error('Injected second-part registration failure');}return globalThis.savedRegistration(oc,shape);};",
    context,
  );
  try {
    await assert.rejects(
      request("split", { kernelId: first.kernelId, cutterId: second.kernelId }),
      /second-part/,
    );
  } finally {
    vm.runInContext(
      "register=globalThis.savedRegistration;delete globalThis.savedRegistration;delete globalThis.registrationCount;",
      context,
    );
  }
  assert.equal(
    vm.runInContext("shapes.size", context),
    handleCount,
    "Failed split rolls back earlier part handles",
  );
  await assert.rejects(
    request("split", { kernelId: first.kernelId, cutterId: first.kernelId }),
    /separate/,
  );
  await assert.rejects(
    request("pattern", {
      kernelId: first.kernelId,
      kind: "linear",
      count: 3,
      step: [0, 0, 0],
    }),
    /nonzero/,
  );
  await assert.rejects(
    request("pattern", {
      kernelId: first.kernelId,
      kind: "circular",
      count: 5,
      center: [0, 0, 0],
      axis: [0, 0, 1],
      angleDegrees: 90,
    }),
    /repeats/,
  );
  await assert.rejects(
    request("mirror", {
      kernelId: first.kernelId,
      planeOrigin: [0, 0, 0],
      normal: [0, 0, 0],
    }),
    /nonzero/,
  );
  await request("release", [patternSeed.kernelId]);
  close(
    exactVolume(circularPattern.kernelId),
    192,
    "Pattern compound survives releasing source handle",
  );
  for (const shape of [
    linearPattern,
    circularPattern,
    mirrored,
    diagonalMirror,
    ...splitParts,
  ]) {
    const data = await request("export", [shape.kernelId]),
      restored = await request("import", { data, extension: "step" });
    close(
      exactVolume(restored.kernelId),
      exactVolume(shape.kernelId),
      "Pattern/mirror/split exact STEP roundtrip",
    );
  }
  const igesWriter = new oc.IGESControl_Writer_1();
  try {
    const shape = vm.runInContext(
      `shapes.get(${JSON.stringify(box.kernelId)})`,
      context,
    );
    assert.ok(igesWriter.AddShape(shape));
    assert.ok(igesWriter.Write_2("out.iges", false));
    const iges = oc.FS.readFile("out.iges").slice();
    const igesImported = await request("import", {
      data: iges,
      extension: "iges",
    });
    assert.equal(igesImported.positions.length, box.positions.length);
  } finally {
    igesWriter.delete();
    if (oc.FS.analyzePath("out.iges").exists) oc.FS.unlink("out.iges");
  }
  await assert.rejects(request("export", ["expired-handle"]), /expired/);
  await assert.rejects(
    request("primitive", { kind: "sphere", center: [0, 0, 0], radius: -1 }),
    /positive/,
  );
  await assert.rejects(
    request("import", { data: new Uint8Array([1, 2, 3]), extension: "step" }),
    /failed/,
  );
  await request("release", [box.kernelId]);
  await assert.rejects(request("export", [box.kernelId]), /expired/);
  await request(
    "release",
    vm.runInContext("Array.from(shapes.keys())", context),
  );
  assert.equal(vm.runInContext("shapes.size", context), 0);
  assert.deepEqual(Array.from(oc.FS.readdir("/")).sort(), [
    ".",
    "..",
    "dev",
    "home",
    "proc",
    "tmp",
  ]);
  console.log(
    "CAD smoke passed: primitives, exchange, booleans, transforms, extrusion/revolution, exact NURBS faces, loft, straight/bent sweep, fillet/chamfer, offset, sewing, shell/thicken, linear/circular patterns, arbitrary plane mirrors, atomic solid split, STEP roundtrips, invalid geometry rejection, handle release and virtual-file cleanup.",
  );
} finally {
  clearTimeout(expiry);
}
