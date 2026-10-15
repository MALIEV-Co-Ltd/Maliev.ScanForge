import { expect, it } from "vitest";
import captures from "../docs/evidence/landmark-joint-controller-native.json";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
import { nativeDatumIsIdentity } from "../src/scan-native-datum-apply";
import { nativeRefineAlignmentMeshes } from "../src/scan-native-alignment-surface-controller";
const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );
const bits = (array: Float32Array) =>
  Array.from(new Uint8Array(array.buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
it.each(captures.cases)(
  "matches original combined coarse application and refinement $name",
  (capture) => {
    const { search } = capture,
      { joint } = search;
    const vertices = transformDatumCoordinates(
      Float32Array.from(joint.originalPoints.flat()),
      joint.coarse,
    );
    const normals = transformDatumCoordinates(
      decode(joint.originalNormalBits),
      joint.coarse,
      true,
    );
    expect(Array.from(vertices)).toEqual(search.sourcePoints.flat());
    expect(bits(normals)).toBe(joint.beforeRefineNormalBits);
    const result = nativeRefineAlignmentMeshes(
      [
        {
          vertices,
          normals,
          triangles: Uint32Array.from(search.sourceTriangles),
          flags: new Uint32Array(vertices.length / 3).fill(4),
        },
      ],
      {
        vertices: Float32Array.from(capture.targetVertices.flat()),
        triangles: Uint32Array.from(capture.targetTriangles),
      },
      1,
      { selectionOnly: true, initialRadius: search.initialRadius },
    );
    expect(result.parameters).toEqual(search.parameters);
    expect(result.matrix).toEqual(search.matrix);
    expect(result.initialError).toBe(search.initialError);
    expect(result.best).toBe(search.best);
    expect(result.accepted).toBe(search.accepted);
    const apply = !nativeDatumIsIdentity(result.matrix, Number.EPSILON);
    expect(apply).toBe(joint.applyDelta);
    expect(
      bits(
        apply ? transformDatumCoordinates(vertices, result.matrix) : vertices,
      ),
    ).toBe(joint.finalPointBits);
    expect(
      bits(
        apply
          ? transformDatumCoordinates(normals, result.matrix, true)
          : normals,
      ),
    ).toBe(joint.finalNormalBits);
  },
);
