import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, PerspectiveCamera } from "three";
import type { ReferenceCoordinateView } from "../src/automation/api";
import {
  copyReferenceCoordinateView,
  resolveReferenceScreenCoordinate,
} from "../src/reference-coordinate-screen";

function capture(
  projection: "perspective" | "orthographic" = "orthographic",
): ReferenceCoordinateView {
  const camera =
    projection === "perspective"
      ? new PerspectiveCamera(90, 1, 0.1, 100)
      : new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld(true);
  return {
    projection,
    cameraMatrixFormat: "column-major-4x4",
    projectionMatrix: camera.projectionMatrix.toArray(),
    cameraWorldMatrix: camera.matrixWorld.toArray(),
    viewport: { width: 400, height: 400 },
    clippingPlanes: [],
  };
}

// Two independent original triangle slots: farther first, nearer second.
const mesh = {
  vertices: [-2, -2, 0, 2, -2, 0, 0, 2, 0, -2, -2, 2, 2, -2, 2, 0, 2, 2],
  triangles: [0, 1, 2, 3, 4, 5],
};

describe("canonical reference screen coordinates", () => {
  it.each(["orthographic", "perspective"] as const)(
    "uses the closest original triangle in a %s capture",
    (projection) => {
      expect(
        resolveReferenceScreenCoordinate(mesh, capture(projection), {
          x: 0.5,
          y: 0.5,
        }),
      ).toEqual({ position: [0, 0, 2], triangleIndex: 1 });
    },
  );

  it("excludes hidden original slots without reindexing", () => {
    expect(
      resolveReferenceScreenCoordinate(
        mesh,
        capture(),
        { x: 0.5, y: 0.5 },
        { hiddenTriangles: [1] },
      ),
    ).toEqual({ position: [0, 0, 0], triangleIndex: 0 });
    expect(
      resolveReferenceScreenCoordinate(
        mesh,
        capture(),
        { x: 0.5, y: 0.5 },
        { firstTriangle: 1, triangleCount: 1 },
      ),
    ).toEqual({ position: [0, 0, 2], triangleIndex: 1 });
  });

  it("retains the first original triangle for an exact depth tie", () => {
    expect(
      resolveReferenceScreenCoordinate(
        { vertices: mesh.vertices, triangles: [0, 1, 2, 0, 1, 2] },
        capture(),
        { x: 0.5, y: 0.5 },
      ).triangleIndex,
    ).toBe(0);
  });

  it("uses front/back/double material side", () => {
    const reversed = { vertices: mesh.vertices, triangles: [2, 1, 0] };
    expect(() =>
      resolveReferenceScreenCoordinate(
        reversed,
        { ...capture(), materialSide: "front" },
        { x: 0.5, y: 0.5 },
      ),
    ).toThrow(/No visible/);
    expect(
      resolveReferenceScreenCoordinate(
        reversed,
        { ...capture(), materialSide: 1 },
        { x: 0.5, y: 0.5 },
      ).triangleIndex,
    ).toBe(0);
    expect(
      resolveReferenceScreenCoordinate(
        reversed,
        { ...capture(), materialSide: "double" },
        { x: 0.5, y: 0.5 },
      ).triangleIndex,
    ).toBe(0);
  });

  it("clips negative plane distances before closest-hit selection", () => {
    const view = {
      ...capture(),
      clippingPlanes: [{ normal: [0, 0, -1] as const, constant: 1 }],
    };
    expect(
      resolveReferenceScreenCoordinate(mesh, view, { x: 0.5, y: 0.5 }),
    ).toEqual({ position: [0, 0, 0], triangleIndex: 0 });
  });

  it("uses the captured clipping intersection policy", () => {
    const view = {
      ...capture(),
      clippingPlanes: [
        { normal: [0, 0, -1] as const, constant: 1 },
        { normal: [0, 0, 1] as const, constant: 1 },
      ],
    };
    expect(
      resolveReferenceScreenCoordinate(mesh, view, { x: 0.5, y: 0.5 })
        .triangleIndex,
    ).toBe(0);
    expect(
      resolveReferenceScreenCoordinate(
        mesh,
        { ...view, clipIntersection: true },
        { x: 0.5, y: 0.5 },
      ).triangleIndex,
    ).toBe(1);
  });

  it("uses top-left normalized coordinates and rounds the final point to Float32", () => {
    const result = resolveReferenceScreenCoordinate(mesh, capture(), {
      x: 0.6,
      y: 0.4,
    });
    expect(result.position).toEqual([Math.fround(0.4), Math.fround(0.4), 2]);
  });

  it("rounds canonical nodes to Float32 before triangle arithmetic", () => {
    const z = 1.00000005;
    const result = resolveReferenceScreenCoordinate(
      { vertices: [-2, -2, z, 2, -2, z, 0, 2, z], triangles: [0, 1, 2] },
      capture(),
      { x: 0.5, y: 0.5 },
    );
    expect(result.position[2]).toBe(Math.fround(z));
  });

  it("excludes intersections beyond captured camera depth", () => {
    const source = {
      vertices: [-2, -2, -200, 2, -2, -200, 0, 2, -200],
      triangles: [0, 1, 2],
    };
    expect(() =>
      resolveReferenceScreenCoordinate(source, capture(), { x: 0.5, y: 0.5 }),
    ).toThrow(/No visible/);
  });

  it("copies the small capture without aliasing or mutating caller state", () => {
    const source = capture();
    source.clippingPlanes = [{ normal: [1, 0, 0], constant: 2 }];
    const snapshot = JSON.stringify(source),
      copied = copyReferenceCoordinateView(source);
    expect(copied.projectionMatrix).not.toBe(source.projectionMatrix);
    expect(copied.cameraWorldMatrix).not.toBe(source.cameraWorldMatrix);
    expect(copied.clippingPlanes[0].normal).not.toBe(
      source.clippingPlanes[0].normal,
    );
    expect(copied.viewport).not.toBe(source.viewport);
    resolveReferenceScreenCoordinate(mesh, source, { x: 0.5, y: 0.5 });
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it.each<readonly [string, () => ReferenceCoordinateView]>([
    [
      "singular matrix",
      () => ({ ...capture(), projectionMatrix: Array(16).fill(0) }),
    ],
    [
      "nonfinite matrix",
      () => ({
        ...capture(),
        cameraWorldMatrix: [Infinity, ...Array(15).fill(0)],
      }),
    ],
    [
      "invalid viewport",
      () => ({ ...capture(), viewport: { width: 0, height: 400 } }),
    ],
    [
      "zero clip normal",
      () => ({
        ...capture(),
        clippingPlanes: [{ normal: [0, 0, 0] as const, constant: 0 }],
      }),
    ],
    [
      "too many clipping planes",
      () => ({
        ...capture(),
        clippingPlanes: Array.from({ length: 33 }, () => ({
          normal: [1, 0, 0] as const,
          constant: 0,
        })),
      }),
    ],
  ])("rejects %s", (_name, view) => {
    expect(() => copyReferenceCoordinateView(view())).toThrow();
  });

  it("rejects invalid coordinates, topology, ranges and hidden slots", () => {
    expect(() =>
      resolveReferenceScreenCoordinate(mesh, capture(), { x: NaN, y: 0.5 }),
    ).toThrow(/normalized/);
    expect(() =>
      resolveReferenceScreenCoordinate(mesh, capture(), { x: 1.1, y: 0.5 }),
    ).toThrow(/normalized/);
    expect(() =>
      resolveReferenceScreenCoordinate(
        { vertices: mesh.vertices, triangles: [0, 1, 99] },
        capture(),
        { x: 0.5, y: 0.5 },
      ),
    ).toThrow(/missing canonical vertex/);
    expect(() =>
      resolveReferenceScreenCoordinate(
        mesh,
        capture(),
        { x: 0.5, y: 0.5 },
        { firstTriangle: 2, triangleCount: 1 },
      ),
    ).toThrow(/range/);
    expect(() =>
      resolveReferenceScreenCoordinate(
        mesh,
        capture(),
        { x: 0.5, y: 0.5 },
        { hiddenTriangles: [2] },
      ),
    ).toThrow(/hidden triangle/);
  });

  it("honors cancellation without publishing a point", () => {
    const check = vi.fn(() => {
      throw new Error("cancelled");
    });
    expect(() =>
      resolveReferenceScreenCoordinate(
        mesh,
        capture(),
        { x: 0.5, y: 0.5 },
        { check },
      ),
    ).toThrow("cancelled");
    expect(check).toHaveBeenCalledOnce();
  });
});
