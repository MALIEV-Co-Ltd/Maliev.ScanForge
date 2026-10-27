import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Shared by the standard CAD smoke and a bounded focused actual-worker entry.
export async function checkBooleanOwnership({ context, oc, request, root }) {
  const shapes = vm.runInContext("shapes", context);
  const initialIds = [...shapes.keys()].sort();
  const owners = [];
  const snapshots = new Map();
  const modes = [];
  const exactBrep = (id) => context.serializeBrep(oc, context.getShape(id));
  const remember = (result) => {
    owners.push(result.kernelId);
    snapshots.set(result.kernelId, result.brep);
    return result;
  };
  const create = async (operation, payload) =>
    remember(await request(operation, payload));
  const preserved = (stage) => {
    for (const [id, expected] of snapshots)
      assert.equal(
        exactBrep(id),
        expected,
        `${stage}: source/previous-result BREP ${id} changed`,
      );
  };
  const digest = (result) =>
    Object.fromEntries(
      ["positions", "normals", "edgePositions"].map((key) => {
        const bytes = Buffer.from(new Float32Array(result[key] ?? []).buffer);
        return [key, createHash("sha256").update(bytes).digest("hex")];
      }),
    );
  const inspect = async (result, volume) => {
    const report = await request("inspectBrep", {
      brep: result.brep,
      edgeOffset: 0,
      edgeLimit: 128,
    });
    assert(report.valid && report.solids === 1 && report.signedVolumeMm3 > 0);
    assert(
      Math.abs(report.signedVolumeMm3 - volume) <= 1e-6,
      `${report.signedVolumeMm3} != independently expected ${volume}`,
    );
    return report;
  };
  try {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "docs/evidence/m5-20261025/sketch-surface-real-scan.json",
          root,
        ),
        "utf8",
      ),
    );
    const sketch = fixture.authoredGuiProfile;
    const points = new Map(
      sketch.points.map((point) => [point.id, [point.x, point.y]]),
    );
    const edges = sketch.segments.map((edge) => ({
      kind: "line",
      start: points.get(edge.a),
      end: points.get(edge.b),
    }));
    const area =
      sketch.segments.reduce((sum, edge) => {
        const a = points.get(edge.a),
          b = points.get(edge.b);
        return sum + a[0] * b[1] - a[1] * b[0];
      }, 0) / 2;
    assert(area > 0);
    const height = 1.8;
    const face = await create("sketchSurface", { edges, frame: sketch.frame });
    const base = await create("thicken", {
      kernelId: face.kernelId,
      thickness: height,
    });
    preserved("thicken setup");
    const tool = await create("transform", {
      kernelId: base.kernelId,
      translation: [0, 0, height / 2],
      rotation: [0, 0, 0],
      scale: 1,
    });
    preserved("tool transform setup");
    for (const [operation, volume] of [
      ["subtract", (area * height) / 2],
      ["intersect", (area * height) / 2],
      ["union", area * height * 1.5],
    ]) {
      const first = await create("boolean", {
        operation,
        firstId: base.kernelId,
        secondId: tool.kernelId,
      });
      preserved(`${operation} first creation`);
      const firstReport = await inspect(first, volume);
      preserved(`${operation} first inspection`);
      const second = await create("boolean", {
        operation,
        firstId: base.kernelId,
        secondId: tool.kernelId,
      });
      preserved(`${operation} repeat and previously created results`);
      const secondReport = await inspect(second, volume);
      assert.deepEqual(
        digest(first),
        digest(second),
        `${operation} repeated public geometry differs`,
      );
      for (const key of ["faces", "edges", "vertices"])
        assert.equal(firstReport[key], secondReport[key]);
      preserved(`${operation} repeat inspection`);
      modes.push({
        operation,
        expectedVolumeMm3: volume,
        repeatedGeometryEqual: true,
      });
    }
    const split = await request("split", {
      kernelId: base.kernelId,
      cutterId: tool.kernelId,
    });
    split.forEach(remember);
    assert.equal(split.length, 2);
    preserved("first split and independent siblings");
    for (const part of split) await inspect(part, (area * height) / 2);
    preserved("first split inspected");
    const repeatedSplit = await request("split", {
      kernelId: base.kernelId,
      cutterId: tool.kernelId,
    });
    repeatedSplit.forEach(remember);
    assert.equal(repeatedSplit.length, 2);
    preserved(
      "repeated split preserves sources, first siblings and previous Boolean results",
    );
    for (let index = 0; index < repeatedSplit.length; index++) {
      await inspect(repeatedSplit[index], (area * height) / 2);
      assert.deepEqual(digest(repeatedSplit[index]), digest(split[index]));
    }
    const countBeforeFailure = shapes.size;
    const registration = context.register;
    const KernelError = vm.runInContext("Error", context);
    let calls = 0;
    context.register = (kernel, shape, ...args) => {
      if (++calls === 2) {
        shape.delete();
        throw new KernelError(
          "Injected ownership regression second split output failure",
        );
      }
      return registration(kernel, shape, ...args);
    };
    try {
      await assert.rejects(
        request("split", { kernelId: base.kernelId, cutterId: tool.kernelId }),
        /second split output failure/,
      );
    } finally {
      context.register = registration;
    }
    assert.equal(
      shapes.size,
      countBeforeFailure,
      "Failed split must roll back its first registered output",
    );
    preserved("failed split preserves sources and every prior output");
    const moved = await create("transform", {
      kernelId: base.kernelId,
      translation: [10, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
    });
    await inspect(moved, area * height);
    preserved("live source recovery after all Boolean/split operations");
    return {
      modes,
      repeatedSplitAndSiblingOwnership: true,
      atomicSplitRollback: true,
      retainedLiveSourceHandle: true,
      scope:
        "Actual bundled worker/WASM; exact live BREP ownership and analytic masses, not native-application parity",
    };
  } finally {
    assert.equal(await request("release", owners.reverse()), true);
    assert.deepEqual(
      [...shapes.keys()].sort(),
      initialIds,
      "Ownership regression must release every created native handle",
    );
  }
}
