import { BoxGeometry } from "three";
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
import { reconstructionTargets } from "../src/scan-reconstruction-targets";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import { bindShrinkwrap } from "../src/shrinkwrap-request";
import type { Entity } from "../src/types";
function mesh(id: string, offset = 0): Entity {
  const indexed = new BoxGeometry(2, 2, 2),
    geometry = indexed.toNonIndexed();
  const positions = Float32Array.from(geometry.getAttribute("position").array);
  for (let i = 0; i < positions.length; i += 3) positions[i] += offset;
  indexed.dispose();
  geometry.dispose();
  return {
    id,
    name: id,
    kind: "mesh",
    positions,
    color: "#aaa",
    visible: true,
    opacity: 1,
  };
}
it("preserves ShrinkWrap's early aggregate input limit without reading coordinates", () => {
  function unread(length: number) {
    return new Proxy<number[]>([], {
      get(_target, key) {
        if (key === "length") return length;
        throw Error("Must reject before reading coordinates");
      },
    });
  }
  for (const lengths of [
    [27_000_009, 9],
    [18_000_000, 18_000_000],
  ]) {
    const a = { ...mesh("a"), positions: unread(lengths[0]) };
    const b = { ...mesh("b"), positions: unread(lengths[1]) };
    expect(() =>
      bindShrinkwrap(a, { kind: "shrinkwrap", targetIds: ["b"] }, [a, b]),
    ).toThrow(/three-million-triangle/);
  }
});
it("binds additional reconstruction meshes from workspace IDs and rejects invalid references", () => {
  const a = mesh("a"),
    b = mesh("b", 1);
  const request = scanToolRequest(
    a,
    { kind: "repolygonize", resolution: 0.5, targetIds: ["b"] },
    [a, b],
  );
  expect(request.operation).toEqual({
    kind: "repolygonize",
    resolution: 0.5,
    targets: [b.positions],
  });
  for (const targetIds of [["a"], ["missing"], ["b", "b"]])
    expect(() =>
      scanToolRequest(a, { kind: "repolygonize", resolution: 0.5, targetIds }, [
        a,
        b,
      ]),
    ).toThrow(/reconstruction/i);
  expect(() =>
    scanToolRequest(
      a,
      { kind: "repolygonize", resolution: 0.5, targetIds: ["b"] },
      [a, { ...b, kernelId: "exact" }],
    ),
  ).toThrow(/reconstruction/i);
});
it("fuses multiple inputs and exposes measured closure without mutating inputs", () => {
  const a = mesh("a"),
    b = mesh("b", 1),
    before = Array.from(b.positions);
  const result = repolygonizeScanMesh(a.positions, {
    resolution: 0.5,
    targets: [b.positions],
  });
  expect(result.diagnostics.watertight).toBe(true);
  expect(result.diagnostics.inputMeshes).toBe(2);
  expect(result.topology.components).toBe(1);
  expect(result.topology.boundaryEdges).toBe(0);
  expect(result.topology.nonManifoldVertices).toBe(0);
  expect(Array.from(b.positions)).toEqual(before);
});
it("reports separated closed components truthfully", () => {
  const result = repolygonizeScanMesh(mesh("a").positions, {
    resolution: 0.5,
    targets: [mesh("b", 8).positions],
  });
  expect(result.diagnostics.watertight).toBe(true);
  expect(result.topology.components).toBe(2);
  expect(result.summary).toContain("2 closed components");
  expect(result.diagnostics.selfIntersectionsChecked).toBe(false);
});
it("validates every reconstruction input before sampling and respects cancellation during verification", () => {
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, {
      targets: [[NaN, 0, 0, 1, 0, 0, 0, 1, 0]],
    }),
  ).toThrow(/finite/);
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, { targets: [[1, 2, 3]] }),
  ).toThrow(/triangles/);
  const controller = new AbortController();
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, {
      signal: controller.signal,
      onProgress: (_f, stage) => {
        if (stage === "Verifying reconstructed topology") controller.abort();
      },
    }),
  ).toThrow(/cancelled/);
});

it("rejects an oversized private payload before reading coordinates or copying targets", () => {
  const positions = new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return 18_000_000;
      throw Error("Must reject before reading coordinates");
    },
  });
  const source = { ...mesh("a"), positions };
  const target = { ...mesh("b"), positions };
  expect(() => reconstructionTargets(source, [target])).toThrow(
    /private.*payload/i,
  );
});

it("preserves the accepted open-cube output bytes and ordered topology", () => {
  const a = mesh("a"),
    b = mesh("b", 1);
  a.positions = a.positions.slice(9);
  b.positions = b.positions.slice(9);
  const fractions: number[] = [];
  const result = repolygonizeScanMesh(a.positions, {
    resolution: 0.5,
    targets: [b.positions],
    onProgress: (fraction) => fractions.push(fraction),
  });
  expect(
    createHash("sha256")
      .update(new Uint8Array(result.positions.buffer))
      .digest("hex"),
  ).toBe("748a70be7020f6476fb8165850b29007d0c8cf38de7fc7cb8b8a1052597aa34c");
  expect(result.topology.triangles).toBe(504);
  expect(result.topology.components).toBe(1);
  expect(
    fractions.every((value, index) => !index || value >= fractions[index - 1]),
  ).toBe(true);
});

it("allocates one output-sized Float32 buffer with bounded fixed scratch", () => {
  const positions = mesh("a").positions,
    Original = Float32Array;
  let allocated = 0;
  vi.stubGlobal(
    "Float32Array",
    new Proxy(Original, {
      construct(target, args) {
        const result = Reflect.construct(target, args, target) as Float32Array;
        allocated += result.byteLength;
        return result;
      },
    }),
  );
  try {
    const result = repolygonizeScanMesh(positions, { resolution: 0.5 });
    expect(allocated).toBeLessThanOrEqual(result.positions.byteLength + 65536);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("allows cancellation during output counting before allocating output and keeps progress monotonic", () => {
  const positions = mesh("a").positions,
    controller = new AbortController(),
    fractions: number[] = [];
  const Original = Float32Array;
  let allocated = 0;
  vi.stubGlobal(
    "Float32Array",
    new Proxy(Original, {
      construct(target, args) {
        const result = Reflect.construct(target, args, target) as Float32Array;
        allocated += result.byteLength;
        return result;
      },
    }),
  );
  try {
    expect(() =>
      repolygonizeScanMesh(positions, {
        signal: controller.signal,
        onProgress(fraction, stage) {
          fractions.push(fraction);
          if (stage === "Counting reconstructed triangles") controller.abort();
        },
      }),
    ).toThrow(/cancelled/i);
    expect(allocated).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(
    fractions.every((value, index) => !index || value >= fractions[index - 1]),
  ).toBe(true);
});
