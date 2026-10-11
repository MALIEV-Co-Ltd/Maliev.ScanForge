import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
function request(operation, payload) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    requests.set(requestId, { resolve, reject });
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
  const box = await request("primitive", {
    kind: "box",
    center: [0, 0, 0],
    size: [10, 20, 30],
  });
  assert.equal(box.positions.length, 108);
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
  assert.ok(sphere.positions.length > 108);
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
    "CAD smoke passed: primitives, STEP/IGES/BREP, boolean volumes and STEP roundtrips, exact transforms, polygon extrusion, invalid geometry rejection, handle release and virtual-file cleanup.",
  );
} finally {
  clearTimeout(expiry);
}
