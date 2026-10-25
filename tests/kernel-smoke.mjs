import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply.ts";
import { noiseNormals } from "../src/scan-native-noise.ts";

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
  const nativeFaces = JSON.parse(
    readFileSync(
      new URL(
        "docs/evidence/landmark-original-face-conversion-native.json",
        root,
      ),
      "utf8",
    ),
  ).cases;
  const floatBytes = (values) =>
    Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString(
      "hex",
    );
  let verifiedCadAlignmentFaces = 0;
  for (const sample of nativeFaces.filter((row) => row.seeded)) {
    const handles = [];
    const own = (value) => (handles.push(value), value);
    let kernelId;
    try {
      const point = own(new oc.gp_Pnt_3(2, -3, 7)),
        normal = own(new oc.gp_Dir_4(0, 0, 1));
      let maker;
      if (sample.kind === "plane") {
        const plane = own(new oc.gp_Pln_3(point, normal));
        maker = own(new oc.BRepBuilderAPI_MakeFace_9(plane, -2, 5, -4, 6));
      } else {
        const tangent = own(new oc.gp_Dir_4(1, 0, 0));
        const axes = own(new oc.gp_Ax3_3(point, normal, tangent));
        const cylinder = own(new oc.gp_Cylinder_2(axes, 3));
        maker = own(new oc.BRepBuilderAPI_MakeFace_10(cylinder, 0.1, 2, -1, 4));
      }
      const face = own(maker.Face());
      const mesher = own(
        new oc.BRepMesh_IncrementalMesh_2(
          face,
          0.05,
          false,
          0.4886921905584123,
          false,
        ),
      );
      void mesher;
      let shape = face;
      if (sample.placed) {
        const placement = own(new oc.gp_Trsf_1());
        placement.SetValues(0, -1, 0, 4, 1, 0, 0, 5, 0, 0, 1, -2);
        const mover = own(
          new oc.BRepBuilderAPI_Transform_2(face, placement, false),
        );
        shape = own(mover.Shape());
      }
      if (sample.reversed) shape.Reverse();
      kernelId = `native-alignment-plane-${verifiedCadAlignmentFaces}`;
      vm.runInContext("shapes", context).set(kernelId, shape);
      const before = context.serializeBrep(oc, shape);
      const result = await request("alignmentMesh", { kernelId });
      const again = await request("alignmentMesh", { kernelId });
      const compact = await request("alignmentMesh", {
        kernelId,
        includeUVs: false,
      });
      assert.equal("uvs" in compact, false);
      assert.equal(floatBytes(compact.vertices), floatBytes(result.vertices));
      assert.equal(floatBytes(compact.normals), floatBytes(result.normals));
      assert.equal(
        result,
        again,
        "Immutable CAD kernel ID reuses prepared target records",
      );
      assert.equal(
        context.serializeBrep(oc, shape),
        before,
        "Alignment preparation must preserve exact BRep",
      );
      assert.equal(result.vertices.length, sample.vertices * 3);
      assert.equal(result.triangles.length, sample.triangles * 3);
      const expectedPositions = Buffer.from(sample.positionBits, "hex"),
        expectedNormals = Buffer.from(sample.normalBits, "hex");
      const expectedUVs = Buffer.from(sample.uvBits, "hex"),
        nativeNodeIds = [];
      for (let i = 0; i < sample.vertices; i++) {
        const actualPosition = floatBytes(
          result.vertices.subarray(i * 3, i * 3 + 3),
        );
        let match = -1;
        for (let j = 0; j < sample.vertices; j++)
          if (
            expectedPositions.subarray(j * 12, j * 12 + 12).toString("hex") ===
            actualPosition
          )
            match = j;
        assert.ok(
          match >= 0,
          "Kernel face coordinates must match original native Float32 records",
        );
        nativeNodeIds.push(match);
        assert.equal(
          floatBytes(result.normals.subarray(i * 3, i * 3 + 3)),
          expectedNormals.subarray(match * 12, match * 12 + 12).toString("hex"),
        );
        assert.equal(
          floatBytes(result.uvs.subarray(i * 3, i * 3 + 3)),
          expectedUVs.subarray(match * 24, match * 24 + 24).toString("hex"),
        );
      }
      assert.deepEqual(
        nativeNodeIds,
        Array.from({ length: sample.vertices }, (_, index) => index),
      );
      assert.deepEqual(
        Array.from(result.triangles, (id) => nativeNodeIds[id]),
        sample.triangleIds,
      );
      for (let i = 0; i < result.triangles.length; i += 3) {
        const ids = Array.from(result.triangles.subarray(i, i + 3));
        const p = ids.map((id) =>
          Array.from(result.vertices.subarray(id * 3, id * 3 + 3)),
        );
        const u = p[1].map((v, j) => v - p[0][j]),
          v = p[2].map((v, j) => v - p[0][j]);
        const n = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        const expectedNormal = Array.from(
          result.normals.subarray(ids[0] * 3, ids[0] * 3 + 3),
        );
        assert.ok(
          n.reduce(
            (sum, value, axis) => sum + value * expectedNormal[axis],
            0,
          ) > 0,
          "Triangle winding agrees with native orientation",
        );
      }
      verifiedCadAlignmentFaces++;
      handles.splice(handles.indexOf(shape), 1);
      await request("release", [kernelId]);
      assert.equal(
        vm.runInContext("alignmentMeshes", context).has(kernelId),
        false,
      );
      await assert.rejects(request("alignmentMesh", { kernelId }), /expired/);
      kernelId = undefined;
    } finally {
      if (kernelId) {
        vm.runInContext("shapes", context).delete(kernelId);
        context.dropAlignmentMesh(kernelId);
      }
      context.cleanup(handles);
    }
  }
  assert.equal(verifiedCadAlignmentFaces, 24);
  const solidProvider = JSON.parse(
    readFileSync(
      new URL(
        "docs/evidence/landmark-original-solid-provider-native.json",
        root,
      ),
      "utf8",
    ),
  );
  let verifiedCadBoxes = 0;
  for (const sample of solidProvider.cases.filter(
    (row) => row.logicalLanes === 1 && row.kind === "box",
  )) {
    const handles = [];
    const own = (value) => (handles.push(value), value);
    let kernelId;
    try {
      const origin = own(new oc.gp_Pnt_3(0, 0, 0));
      const maker = own(new oc.BRepPrimAPI_MakeBox_2(origin, 7, 10, 4));
      const shape = own(maker.Shape());
      own(
        new oc.BRepMesh_IncrementalMesh_2(
          shape,
          sample.tolerance,
          false,
          0.4886921905584123,
          false,
        ),
      );
      kernelId = "native-alignment-box-" + verifiedCadBoxes;
      vm.runInContext("shapes", context).set(kernelId, shape);
      const before = context.serializeBrep(oc, shape);
      const mesh = await request("alignmentMesh", { kernelId });
      const expected = sample.repeats[0].merged;
      assert.equal(floatBytes(mesh.vertices), expected.positionBits);
      assert.deepEqual(Array.from(mesh.triangles), expected.triangleIds);
      const normals = noiseNormals({
        vertices: Float64Array.from(mesh.vertices),
        triangles: mesh.triangles,
      });
      assert.equal(floatBytes(normals), expected.normalBits);
      assert.equal(context.serializeBrep(oc, shape), before);
      verifiedCadBoxes++;
      handles.splice(handles.indexOf(shape), 1);
      await request("release", [kernelId]);
      kernelId = undefined;
    } finally {
      if (kernelId) {
        vm.runInContext("shapes", context).delete(kernelId);
        context.dropAlignmentMesh(kernelId);
      }
      context.cleanup(handles);
    }
  }
  assert.equal(verifiedCadBoxes, 3);
  const nativeCacheUV = JSON.parse(
    readFileSync(
      new URL("docs/evidence/native-cached-cylinder-uv.json", root),
      "utf8",
    ),
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "docs/evidence/landmark-original-solid-provider-native.json",
            root,
          ),
        ),
      )
      .digest("hex"),
    nativeCacheUV.provenance.originalProviderCaptureSha256,
  );
  let verifiedNativeCachedCylinders = 0;
  for (const sample of solidProvider.cases.filter(
    (row) => row.logicalLanes === 1 && row.kind === "cylinder",
  )) {
    const handles = [];
    const own = (value) => (handles.push(value), value);
    const path = "r.brep";
    const kernelId = `native-cached-cylinder-${sample.tolerance}`;
    const shape = own(new oc.TopoDS_Shape());
    try {
      const cache = nativeCacheUV.cases.find(
        (row) => row.tolerance === sample.tolerance,
      );
      const input = gunzipSync(
        readFileSync(new URL(`docs/evidence/${cache.compressedBrep}`, root)),
      );
      assert.equal(
        createHash("sha256").update(input).digest("hex"),
        cache.brepSha256,
      );
      const text = input.toString("utf8").split(/\r?\n/);
      const triangulations = text.findIndex((line) =>
        line.startsWith("Triangulations "),
      );
      assert.equal(
        Number(text[triangulations].split(/\s+/)[1]),
        cache.parts.length,
      );
      // Native BRep serialization rounds UVs. Restore captured original doubles,
      // leaving all surfaces, nodes, triangles and topology untouched.
      cache.parts.forEach((part, index) => {
        const header = text[triangulations + 1 + index * 2]
          .trim()
          .split(/\s+/)
          .map(Number);
        assert.deepEqual(header.slice(0, 3), [
          part.vertices,
          part.triangles,
          1,
        ]);
        const line = triangulations + 2 + index * 2;
        const tokens = text[line].trim().split(/\s+/);
        assert.equal(tokens.length, part.vertices * 5 + part.triangles * 3);
        const uv = Buffer.from(part.uvBits, "hex");
        assert.equal(uv.length, part.vertices * 24);
        for (let node = 0; node < part.vertices; node++)
          for (let axis = 0; axis < 2; axis++) {
            const value = uv.readDoubleLE(node * 24 + axis * 8);
            tokens[part.vertices * 3 + node * 2 + axis] = Object.is(value, -0)
              ? "-0"
              : value.toString();
          }
        text[line] = tokens.join(" ");
      });
      oc.FS.writeFile(path, new TextEncoder().encode(text.join("\n")));
      const builder = own(new oc.BRep_Builder());
      const progress = own(new oc.Handle_Message_ProgressIndicator_1());
      assert.equal(oc.BRepTools.Read_2(shape, path, builder, progress), true);
      vm.runInContext("shapes", context).set(kernelId, shape);
      const before = context.serializeBrep(oc, shape);
      const mesh = await request("alignmentMesh", { kernelId });
      const expected = sample.repeats[0].merged;
      assert.equal(
        floatBytes(mesh.vertices),
        expected.positionBits,
        "Native conversion uses analytic surface positions from D1 at the cached UV nodes",
      );
      assert.deepEqual(Array.from(mesh.triangles), expected.triangleIds);
      const normals = noiseNormals({
        vertices: Float64Array.from(mesh.vertices),
        triangles: mesh.triangles,
      });
      assert.equal(floatBytes(normals), expected.normalBits);
      assert.equal(context.serializeBrep(oc, shape), before);
      verifiedNativeCachedCylinders++;
    } finally {
      vm.runInContext("shapes", context).delete(kernelId);
      context.dropAlignmentMesh(kernelId);
      context.cleanup(handles);
      if (oc.FS.analyzePath(path).exists) oc.FS.unlink(path);
    }
  }
  assert.equal(verifiedNativeCachedCylinders, 3);
  const cacheSource = await request("primitive", {
    kind: "box",
    center: [0, 0, 0],
    size: [2, 2, 2],
  });
  await request("alignmentMesh", { kernelId: cacheSource.kernelId });
  assert.equal(
    vm.runInContext("alignmentMeshes", context).has(cacheSource.kernelId),
    true,
  );
  const cacheCompanion = await request("primitive", {
    kind: "box",
    center: [4, 0, 0],
    size: [2, 2, 2],
  });
  assert.equal(
    vm.runInContext("alignmentMeshes", context).has(cacheSource.kernelId),
    false,
    "Kernel retessellation invalidates potentially shared face records",
  );
  await request("alignmentMesh", { kernelId: cacheSource.kernelId });
  await request("release", [cacheSource.kernelId, cacheCompanion.kernelId]);
  assert.equal(vm.runInContext("alignmentMeshBytes", context), 0);
  console.log(
    JSON.stringify({
      nativeCadAlignmentFaces: verifiedCadAlignmentFaces,
      nativeCadAlignmentBoxes: verifiedCadBoxes,
      nativeCachedCylinders: verifiedNativeCachedCylinders,
      exactFloat32Normals: true,
      brepPreserved: true,
      cacheReused: true,
    }),
  );
  const cadDatumCases = JSON.parse(
    readFileSync(
      new URL("tests/fixtures/alignment-datum-cad-transform-native.json", root),
      "utf8",
    ),
  ).cases;
  let datumSource;
  const datumHandles = [];
  try {
    const point = new oc.gp_Pnt_3(2, 3, 4);
    datumHandles.push(point);
    const normal = new oc.gp_Dir_4(0, 0, 1);
    datumHandles.push(normal);
    const plane = new oc.gp_Pln_3(point, normal);
    datumHandles.push(plane);
    const maker = new oc.BRepBuilderAPI_MakeFace_9(plane, -1, 3, -2, 4);
    datumHandles.push(maker);
    datumSource = context.register(oc, maker.Face());
  } finally {
    context.cleanup(datumHandles);
  }
  const sourceBrep = context.serializeBrep(
    oc,
    context.getShape(datumSource.kernelId),
  );
  for (const sample of cadDatumCases) {
    const inputBytes = Buffer.from(sample.matrixBits, "hex");
    const inverse = nativeDatumInverseFrame(
      Array.from({ length: 12 }, (_, i) => inputBytes.readDoubleLE(i * 8)),
    );
    const output = await request("datumTransform", {
      kernelId: datumSource.kernelId,
      origin: [inverse[3], inverse[7], inverse[11]],
      xDirection: [inverse[0], inverse[4], inverse[8]],
      zDirection: [inverse[2], inverse[6], inverse[10]],
    });
    const bytes = Buffer.alloc(96);
    output.placementMatrix.forEach((value, i) =>
      bytes.writeDoubleLE(value, i * 8),
    );
    assert.equal(bytes.toString("hex"), sample.nativeMatrixBits, sample.name);
    assert.ok(
      context
        .getShape(output.kernelId)
        .IsPartner(context.getShape(datumSource.kernelId)),
      "Rigid placement shares exact source topology",
    );
    const handles = [];
    try {
      const face = oc.TopoDS.Face_1(context.getShape(output.kernelId));
      handles.push(face);
      const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
      handles.push(adaptor);
      const p = new oc.gp_Pnt_1(),
        du = new oc.gp_Vec_1(),
        dv = new oc.gp_Vec_1();
      handles.push(p, du, dv);
      adaptor.D1(1, 1, p, du, dv);
      for (const [actual, key] of [
        [p, "nativePointBits"],
        [du, "nativeDuBits"],
        [dv, "nativeDvBits"],
      ]) {
        const bytes = Buffer.alloc(24);
        [actual.X(), actual.Y(), actual.Z()].forEach((value, i) =>
          bytes.writeDoubleLE(value, i * 8),
        );
        assert.equal(
          bytes.toString("hex"),
          sample[key],
          `Original face D1 ${key}: ${sample.name}`,
        );
      }
    } finally {
      context.cleanup(handles);
    }
    const expected = [];
    for (let i = 0; i < datumSource.positions.length; i += 3)
      for (let axis = 0; axis < 3; axis++)
        expected.push(
          output.placementMatrix[axis * 4] * datumSource.positions[i] +
            output.placementMatrix[axis * 4 + 1] *
              datumSource.positions[i + 1] +
            output.placementMatrix[axis * 4 + 2] *
              datumSource.positions[i + 2] +
            output.placementMatrix[axis * 4 + 3],
        );
    bounds(output.positions).forEach((value, i) =>
      close(value, bounds(expected)[i], "Exact placement display bounds"),
    );
    await request("release", [output.kernelId]);
    await assert.rejects(
      request("alignmentReferences", { kernelId: output.kernelId }),
    );
  }
  assert.equal(
    context.serializeBrep(oc, context.getShape(datumSource.kernelId)),
    sourceBrep,
    "Source exact BRep unchanged by 338 placements",
  );
  await request("release", [datumSource.kernelId]);
  console.log(
    `CAD datum parity: ${cadDatumCases.length} native matrices, shared exact topology, display bounds and handle releases passed.`,
  );
  for (const specification of [
    { kind: "box", center: [2, -3, 7], size: [4, 6, 8] },
    { kind: "sphere", center: [2, -3, 7], radius: 3 },
    {
      kind: "cylinder",
      center: [2, -3, 7],
      axis: [0, 0, 1],
      radius: 3,
      height: 8,
    },
    {
      kind: "cone",
      center: [2, -3, 7],
      axis: [0, 0, 1],
      radius: 3,
      topRadius: 1,
      height: 8,
    },
  ]) {
    const body = await request("primitive", specification);
    const before = context.serializeBrep(oc, context.getShape(body.kernelId));
    const references = await request("alignmentReferences", {
      kernelId: body.kernelId,
    });
    if (specification.kind === "sphere")
      assert.ok(
        references.every(
          (face) => face.kind === "unsupported" && face.surfaceType === 3,
        ),
      );
    else if (specification.kind === "box")
      assert.equal(
        references.filter((face) => face.kind === "plane").length,
        6,
      );
    else assert.ok(references.some((face) => face.kind === specification.kind));
    assert.equal(
      references.reduce((sum, face) => sum + face.triangleCount, 0),
      body.positions.length / 9,
    );
    let next = 0;
    references.forEach((face, index) => {
      assert.equal(face.faceIndex, index);
      assert.equal(face.firstTriangle, next);
      next += face.triangleCount;
      assert.ok(face.triangleCount > 0);
      if (face.kind === "plane") {
        assert.ok(
          [
            ...face.evaluatedPoint,
            ...face.derivativeU,
            ...face.derivativeV,
          ].every(Number.isFinite),
        );
        const normal = [
          face.derivativeU[1] * face.derivativeV[2] -
            face.derivativeU[2] * face.derivativeV[1],
          face.derivativeU[2] * face.derivativeV[0] -
            face.derivativeU[0] * face.derivativeV[2],
          face.derivativeU[0] * face.derivativeV[1] -
            face.derivativeU[1] * face.derivativeV[0],
        ];
        for (let t = face.firstTriangle; t < next; t++) {
          for (let vertex = 0; vertex < 3; vertex++) {
            const offset = t * 9 + vertex * 3;
            close(
              normal.reduce(
                (sum, value, i) =>
                  sum +
                  value * (body.positions[offset + i] - face.evaluatedPoint[i]),
                0,
              ),
              0,
              "Reference face triangle lies on evaluated plane",
            );
          }
        }
      } else if (face.kind !== "unsupported") {
        assert.equal(face.kind, specification.kind);
        if (face.kind === "cylinder")
          close(
            face.radius,
            specification.radius,
            "Exact kernel cylinder radius",
          );
        face.location.forEach((value, i) =>
          close(
            value,
            specification.center[i] -
              specification.axis[i] * specification.height * 0.5,
            "Axis location",
          ),
        );
        face.axis.forEach((value, i) =>
          close(value, specification.axis[i], "Axis direction"),
        );
        assert.ok(face.lastV > face.firstV);
      }
    });
    assert.deepEqual(
      await request("alignmentReferences", { kernelId: body.kernelId }),
      references,
    );
    assert.equal(
      context.serializeBrep(oc, context.getShape(body.kernelId)),
      before,
    );
    await request("release", [body.kernelId]);
    await assert.rejects(
      request("alignmentReferences", { kernelId: body.kernelId }),
      /expired/,
    );
  }
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
  const shapesBeforeInspection = vm.runInContext("shapes.size", context);
  const boxInspection = await request("inspectBrep", { brep: box.brep });
  assert.equal(boxInspection.valid, true);
  assert.equal(boxInspection.solids, 1);
  assert.equal(boxInspection.shells, 1);
  assert.equal(boxInspection.faces, 6);
  assert.equal(boxInspection.edges, 12);
  assert.equal(boxInspection.vertices, 8);
  close(boxInspection.areaMm2, 2200, "Exact inspection box area");
  close(boxInspection.volumeMm3, 6000, "Exact inspection box volume");
  await assert.rejects(request("inspectBrep", { brep: "not BREP" }), /BREP/);
  assert.equal(vm.runInContext("shapes.size", context), shapesBeforeInspection);
  assert.equal(oc.FS.analyzePath("check.brp").exists, false);
  const reversedBox = vm.runInContext(
    `shapes.get(${JSON.stringify(box.kernelId)}).Reversed()`,
    context,
  );
  try {
    const reversed = await request("inspectBrep", {
      brep: context.serializeBrep(oc, reversedBox),
    });
    close(
      reversed.signedVolumeMm3,
      -6000,
      "Inspection retains reversed solid orientation",
    );
    close(
      reversed.volumeMm3,
      6000,
      "Inspection reports absolute volume separately",
    );
  } finally {
    reversedBox.delete();
  }
  const invalidHandles = [];
  try {
    const wire = context.polygonWire(
      oc,
      [
        [0, 0, 0],
        [2, 2, 0],
        [0, 2, 0],
        [2, 0, 0],
      ],
      invalidHandles,
    );
    const maker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    invalidHandles.push(maker);
    const face = maker.Face();
    invalidHandles.push(face);
    const invalid = await request("inspectBrep", {
      brep: context.serializeBrep(oc, face),
    });
    assert.equal(
      invalid.valid,
      false,
      "Self-crossing exact face must be reported invalid",
    );
    assert.equal(
      vm.runInContext("shapes.size", context),
      shapesBeforeInspection,
    );
  } finally {
    context.cleanup(invalidHandles);
  }
  const reversedFaceHandles = [];
  try {
    const builder = new oc.BRep_Builder(),
      shell = new oc.TopoDS_Shell();
    reversedFaceHandles.push(builder, shell);
    builder.MakeShell(shell);
    const boxShape = vm.runInContext(
      `shapes.get(${JSON.stringify(box.kernelId)})`,
      context,
    );
    const explorer = new oc.TopExp_Explorer_2(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    reversedFaceHandles.push(explorer);
    let firstFace = true;
    for (; explorer.More(); explorer.Next()) {
      const face = explorer.Current();
      reversedFaceHandles.push(face);
      const placed = firstFace ? face.Reversed() : face;
      if (firstFace) reversedFaceHandles.push(placed);
      builder.Add(shell, placed);
      firstFace = false;
    }
    const maker = new oc.BRepBuilderAPI_MakeSolid_1();
    reversedFaceHandles.push(maker);
    maker.Add(shell);
    const invalidSolid = maker.Solid();
    reversedFaceHandles.push(invalidSolid);
    const brep = context.serializeBrep(oc, invalidSolid);
    if (process.env.SCANFORGE_CAD_INVALID_FIXTURE === "1")
      writeFileSync(new URL(".resources/m5/invalid-one-face.brep", root), brep);
    assert.equal((await request("inspectBrep", { brep })).valid, false);
    await assert.rejects(
      request("import", {
        data: new TextEncoder().encode(brep),
        extension: "brep",
      }),
      /invalid/i,
    );
    assert.equal(
      vm.runInContext("shapes.size", context),
      shapesBeforeInspection,
    );
  } finally {
    context.cleanup(reversedFaceHandles);
  }
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
  const trimSource = await request(
    "surface",
    planarPatch([-5, -5, 0], [10, 0, 0], [0, 10, 0]),
  );
  const trimCutter = await request(
    "surface",
    planarPatch([0, -10, -10], [0, 20, 0], [0, 0, 20]),
  );
  const exactBrep = (kernelId) =>
    context.serializeBrep(
      oc,
      vm.runInContext(`shapes.get(${JSON.stringify(kernelId)})`, context),
    );
  const sourceBeforeTrim = exactBrep(trimSource.kernelId),
    cutterBeforeTrim = exactBrep(trimCutter.kernelId);
  const leftTrim = await request("trimSurfaces", {
    kernelId: trimSource.kernelId,
    cutterIds: [trimCutter.kernelId],
    keepPoints: [[-2, 0, 0]],
    toleranceMm: 0.001,
  });
  const leftReport = await request("inspectBrep", { brep: leftTrim.brep });
  assert(leftReport.valid && leftReport.solids === 0 && leftReport.faces === 1);
  close(leftReport.areaMm2, 50, "Retained exact plane region area");
  assert.deepEqual(bounds(leftTrim.positions), [-5, -5, 0, 0, 5, 0]);
  assert.equal(exactBrep(trimSource.kernelId), sourceBeforeTrim);
  assert.equal(exactBrep(trimCutter.kernelId), cutterBeforeTrim);
  const bothTrim = await request("trimSurfaces", {
    kernelId: trimSource.kernelId,
    cutterIds: [trimCutter.kernelId],
    keepPoints: [
      [-2, 0, 0],
      [2, 0, 0],
    ],
    toleranceMm: 0.001,
  });
  close(
    (await request("inspectBrep", { brep: bothTrim.brep })).areaMm2,
    100,
    "Multiple retained regions preserve exact area",
  );
  const beforeBadTrim = vm.runInContext("shapes.size", context);
  await assert.rejects(
    request("trimSurfaces", {
      kernelId: trimSource.kernelId,
      cutterIds: [trimCutter.kernelId],
      keepPoints: [[0, 0, 0]],
      toleranceMm: 0.001,
    }),
    /ambiguous/i,
  );
  await assert.rejects(
    request("trimSurfaces", {
      kernelId: trimSource.kernelId,
      cutterIds: [trimCutter.kernelId],
      keepPoints: [[100, 0, 0]],
      toleranceMm: 0.001,
    }),
    /surface|tolerance/i,
  );
  assert.equal(vm.runInContext("shapes.size", context), beforeBadTrim);
  assert.equal(exactBrep(trimSource.kernelId), sourceBeforeTrim);
  assert.equal(exactBrep(trimCutter.kernelId), cutterBeforeTrim);
  const disjointCutter = await request(
    "surface",
    planarPatch([20, -10, -10], [0, 20, 0], [0, 0, 20]),
  );
  await assert.rejects(
    request("trimSurfaces", {
      kernelId: trimSource.kernelId,
      cutterIds: [disjointCutter.kernelId],
      keepPoints: [[-2, 0, 0]],
      toleranceMm: 0.001,
    }),
    /intersect/i,
  );
  await assert.rejects(
    request("trimSurfaces", {
      kernelId: trimSource.kernelId,
      cutterIds: [trimCutter.kernelId],
      keepPoints: Array.from({ length: 129 }, () => [-2, 0, 0]),
      toleranceMm: 0.001,
    }),
    /128/,
  );
  const quadrant = await request("surface", {
    format: "scanforge-nurbs",
    version: 1,
    countU: 3,
    countV: 2,
    degreeU: 2,
    degreeV: 1,
    knotsU: [0, 0, 0, 1, 1, 1],
    knotsV: [0, 0, 1, 1],
    weights: [1, Math.SQRT1_2, 1, 1, Math.SQRT1_2, 1],
    points: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [1, 0, 2],
      [1, 1, 2],
      [0, 1, 2],
    ],
  });
  const crossPlane = await request(
    "surface",
    planarPatch([-2, -2, 1], [4, 0, 0], [0, 4, 0]),
  );
  const curvedTrim = await request("trimSurfaces", {
    kernelId: quadrant.kernelId,
    cutterIds: [crossPlane.kernelId],
    keepPoints: [[Math.SQRT1_2, Math.SQRT1_2, 0.5]],
    toleranceMm: 0.001,
  });
  const curvedReport = await request("inspectBrep", { brep: curvedTrim.brep });
  assert(
    curvedReport.valid && curvedReport.faces === 1 && curvedReport.solids === 0,
  );
  close(
    curvedReport.areaMm2,
    Math.PI / 2,
    "Trim retains exact rational curved surface area",
  );
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
  const faceInspection = await request("inspectBrep", { brep: nurbs.brep });
  assert.equal(faceInspection.valid, true);
  assert.equal(faceInspection.solids, 0);
  assert.equal(faceInspection.faces, 1);
  assert.equal(faceInspection.volumeMm3, 0);
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
    "CAD smoke passed: read-only alignment face references and matching triangle ranges, primitives, exchange, booleans, transforms, extrusion/revolution, exact NURBS faces, loft, straight/bent sweep, fillet/chamfer, offset, sewing, shell/thicken, linear/circular patterns, arbitrary plane mirrors, atomic solid split, STEP roundtrips, invalid geometry rejection, handle release and virtual-file cleanup.",
  );
} finally {
  clearTimeout(expiry);
}
