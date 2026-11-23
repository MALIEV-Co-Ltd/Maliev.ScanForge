import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import vm from "node:vm";

export async function checkCadCacheOwnership({ context, oc, request }) {
  const shapes = vm.runInContext("shapes", context),
    initialIds = [...shapes.keys()].sort();
  const owners = [],
    snapshots = new Map(),
    published = new Map();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const exact = (id) => context.serializeBrep(oc, context.getShape(id));
  const payloadDigest = (shape) => ({
    brep: hash(shape.brep),
    buffers: Object.fromEntries(
      ["positions", "normals", "edgePositions"].map((key) => [
        key,
        hash(Buffer.from(new Float32Array(shape[key] ?? []).buffer)),
      ]),
    ),
  });
  const own = (shape) => {
    owners.push(shape.kernelId);
    snapshots.set(shape.kernelId, shape.brep);
    published.set(shape.kernelId, { shape, digest: payloadDigest(shape) });
    return shape;
  };
  const create = async (operation, payload) =>
    own(await request(operation, payload));
  const preserved = (stage) => {
    for (const [id, brep] of snapshots) {
      const current = exact(id);
      if (current !== brep) {
        let offset = 0;
        while (
          offset < Math.min(brep.length, current.length) &&
          brep[offset] === current[offset]
        )
          offset++;
        assert.fail(
          JSON.stringify({
            stage,
            kernelId: id,
            beforeSha256: hash(brep),
            afterSha256: hash(current),
            firstDifference: offset,
            beforeBytes: Buffer.byteLength(brep),
            afterBytes: Buffer.byteLength(current),
            beforeContext: brep.slice(Math.max(0, offset - 100), offset + 140),
            afterContext: current.slice(
              Math.max(0, offset - 100),
              offset + 140,
            ),
          }),
        );
      }
    }
    for (const { shape, digest } of published.values())
      assert.deepEqual(
        payloadDigest(shape),
        digest,
        `${stage}: published worker geometry/BREP changed`,
      );
  };
  const consumers = async (shape) => {
    const mesh = await request("alignmentMesh", {
      kernelId: shape.kernelId,
      includeUVs: false,
    });
    assert.equal(mesh.uvs, undefined);
    const expanded = new Float32Array(mesh.triangles.length * 3);
    for (let index = 0; index < mesh.triangles.length; index++) {
      const vertex = mesh.triangles[index];
      assert(
        Number.isInteger(vertex) &&
          vertex >= 0 &&
          vertex * 3 + 2 < mesh.vertices.length,
      );
      for (let axis = 0; axis < 3; axis++)
        expanded[index * 3 + axis] = mesh.vertices[vertex * 3 + axis];
    }
    const references = await request("alignmentReferences", {
      kernelId: shape.kernelId,
    });
    const ranges = Array.from(references, (item) => ({
      faceIndex: item.faceIndex,
      firstTriangle: item.firstTriangle,
      triangleCount: item.triangleCount,
      kind: item.kind,
    })).sort((a, b) => a.firstTriangle - b.firstTriangle);
    assert.equal(ranges.length, 3);
    assert.equal(ranges.filter((item) => item.kind === "plane").length, 2);
    assert.equal(ranges.filter((item) => item.kind === "cylinder").length, 1);
    let cursor = 0;
    for (const range of ranges) {
      assert.equal(range.firstTriangle, cursor);
      assert(Number.isInteger(range.triangleCount) && range.triangleCount > 0);
      cursor += range.triangleCount;
    }
    assert.equal(cursor, mesh.triangles.length / 3);
    return {
      expanded: Buffer.from(expanded.buffer),
      ranges,
      triangleCount: cursor,
    };
  };
  const readersEqual = async (shape, baseline, stage) => {
    const current = await consumers(shape);
    assert(
      current.expanded.equals(baseline.expanded),
      `${stage}: alignment D1 Float32 triangles changed`,
    );
    assert.deepEqual(
      current.ranges,
      baseline.ranges,
      `${stage}: face-range identity/slots changed`,
    );
  };
  const properties = async (shape, center, count = 1, step = 0) => {
    const copier = new oc.BRepBuilderAPI_Copy_2(
      context.getShape(shape.kernelId),
      true,
      false,
    );
    const owned = copier.Shape();
    const checker = new oc.BRepCheck_Analyzer(owned, true);
    const volume = new oc.GProp_GProps_1(),
      area = new oc.GProp_GProps_1();
    const bounds = new oc.Bnd_Box_1();
    let min, max;
    try {
      assert(checker.IsValid_2());
      oc.BRepGProp.VolumeProperties_1(owned, volume, true, true, false);
      oc.BRepGProp.SurfaceProperties_1(owned, area, true, false);
      assert(Math.abs(volume.Mass() - 72 * Math.PI * count) <= 1e-7);
      assert(Math.abs(area.Mass() - 66 * Math.PI * count) <= 1e-7);
      oc.BRepBndLib.Add(owned, bounds, false);
      min = bounds.CornerMin();
      max = bounds.CornerMax();
      const expectedMin = [center[0] - 3, center[1] - 3, center[2] - 4];
      const expectedMax = [
        center[0] + 3 + step * (count - 1),
        center[1] + 3,
        center[2] + 4,
      ];
      for (const [actual, expected] of [
        [min, expectedMin],
        [max, expectedMax],
      ])
        for (const [axis, coordinate] of [
          actual.X(),
          actual.Y(),
          actual.Z(),
        ].entries())
          assert(
            Math.abs(coordinate - expected[axis]) <= 1e-6,
            "Independent exact cylinder placement differs",
          );
    } finally {
      max?.delete();
      min?.delete();
      bounds.delete();
      area.delete();
      volume.delete();
      checker.delete();
      owned.delete();
      copier.delete();
    }
  };
  try {
    const source = await create("primitive", {
      kind: "cylinder",
      center: [0, 0, 4],
      axis: [0, 0, 1],
      radius: 3,
      height: 8,
    });
    const baseline = await consumers(source);
    assert.equal(baseline.triangleCount, source.positions.length / 9);
    const displayEqualsInitialReader = baseline.expanded.equals(
      Buffer.from(new Float32Array(source.positions).buffer),
    );
    await properties(source, [0, 0, 4]);
    preserved("initial source readers");
    const first = await create("datumTransform", {
      kernelId: source.kernelId,
      origin: [3, 4, 5],
      xDirection: [0.6, 0.8, 0],
      zDirection: [0, 0, 1],
    });
    preserved("first datum native return before post-call readers");
    assert(
      context
        .getShape(first.kernelId)
        .IsPartner(context.getShape(source.kernelId)),
      "Datum must preserve the shared-topology contract",
    );
    await properties(first, [-5, 0, -1]);
    preserved("first datum result inspection");
    const firstReaders = await consumers(first);
    preserved("first datum result alignment readers");
    await readersEqual(source, baseline, "first datum source");
    preserved("first datum registration");
    const pattern = await create("pattern", {
      kernelId: source.kernelId,
      kind: "linear",
      count: 3,
      step: [200, 0, 0],
    });
    const explorer = new oc.TopExp_Explorer_2(
      context.getShape(pattern.kernelId),
      oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      assert(explorer.More());
      const firstInstance = explorer.Current();
      try {
        assert(
          !firstInstance.IsPartner(context.getShape(source.kernelId)),
          "Pattern first instance must own its topology/mesh",
        );
      } finally {
        firstInstance.delete();
      }
    } finally {
      explorer.delete();
    }
    await properties(pattern, [0, 0, 4], 3, 200);
    await readersEqual(source, baseline, "large pattern source");
    await readersEqual(first, firstReaders, "large pattern prior datum output");
    preserved("large pattern preserves source and prior output");
    const second = await create("datumTransform", {
      kernelId: source.kernelId,
      origin: [1, 2, 3],
      xDirection: [1, 0, 0],
      zDirection: [0, 0, 1],
    });
    assert(
      context
        .getShape(second.kernelId)
        .IsPartner(context.getShape(source.kernelId)),
    );
    await properties(second, [-1, -2, 1]);
    await readersEqual(source, baseline, "subsequent datum source");
    await readersEqual(first, firstReaders, "subsequent datum prior output");
    preserved("subsequent datum/source consumption");
    const restored = await create("import", {
      data: new TextEncoder().encode(source.brep),
      extension: "brep",
    });
    await properties(restored, [0, 0, 4]);
    await readersEqual(
      source,
      baseline,
      "source persisted BREP reconstruction",
    );
    preserved("published BREP/payload persistence and reconstruction");
    // A validated but deliberately unmeshed native fixture must reject partner
    // registration safely, without remeshing that shared source or dereferencing
    // a null triangulation handle.
    const copier = new oc.BRepBuilderAPI_Copy_2(
      context.getShape(source.kernelId),
      true,
      false,
    );
    let unmeshed,
      attached = false;
    const missingId = "cad-cache-ownership-missing-prepared";
    try {
      unmeshed = copier.Shape();
      const validator = new oc.BRepCheck_Analyzer(unmeshed, true);
      try {
        assert(validator.IsValid_2());
      } finally {
        validator.delete();
      }
      assert(!shapes.has(missingId));
      shapes.set(missingId, unmeshed);
      attached = true;
      owners.push(missingId);
      snapshots.set(missingId, exact(missingId));
    } finally {
      if (!attached) unmeshed?.delete();
      copier.delete();
    }
    const before = shapes.size;
    await assert.rejects(async () => {
      const unexpected = await request("datumTransform", {
        kernelId: missingId,
        origin: [1, 2, 3],
        xDirection: [1, 0, 0],
        zDirection: [0, 0, 1],
      });
      own(unexpected);
    }, /requires prepared face triangulations/);
    assert.equal(shapes.size, before);
    preserved("missing prepared triangulation failure");
    await readersEqual(source, baseline, "after missing-triangulation failure");
    return {
      sourceRawBrepAndPublishedBuffersExact: true,
      datumIsPartnerRetained: true,
      ownedPatternFirstInstance: true,
      alignmentReaderAndFaceRangesMatchInitial: true,
      displayEqualsInitialReader,
      independentExactProperties: true,
      publishedBrepReconstruction: true,
      missingPreparedTriangulationRejectedSafely: true,
    };
  } finally {
    assert.equal(await request("release", owners.reverse()), true);
    assert.deepEqual([...shapes.keys()].sort(), initialIds);
  }
}
