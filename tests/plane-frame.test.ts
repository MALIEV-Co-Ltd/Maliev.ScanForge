import { expect, it } from "vitest";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import { validatePlaneFrame, transformPlaneFrame } from "../src/plane-frame";
import { mirrorReference } from "../src/scan-tools-reference";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import { runScanTool } from "../src/scan-tools";
import { transformPositions } from "../src/geometry";
import type { Entity, Vec3 } from "../src/types";
import capture from "./fixtures/mirror-tangent-native.json";
import cadCapture from "./fixtures/mirror-cad-plane-native.json";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16)).buffer,
  );
const bits = (p: Float32Array) =>
  Array.from(new Uint8Array(p.buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
function reference(entry: (typeof capture.cases)[number]): Entity {
  const m = entry.plane.frame;
  const corner = (u: number, v: number) => [
    u * m[0] + v * m[1] + m[3],
    u * m[4] + v * m[5] + m[7],
    u * m[8] + v * m[9] + m[11],
  ];
  return {
    id: "plane",
    name: "Rotated reference",
    kind: "plane",
    positions: [...corner(-1, -1), ...corner(1, -1), ...corner(1, 1)],
    planeFrame: {
      center: entry.plane.center as Vec3,
      normal: entry.plane.normal as Vec3,
      tangent: entry.plane.tangent as Vec3,
    },
    color: "#778899",
    visible: true,
    opacity: 0.5,
  };
}

it.each([...capture.cases, ...cadCapture.cases])(
  "preserves native $name mirror against $plane.name through both project serializers and reference binding",
  async (entry) => {
    const plane = reference(entry);
    const mesh: Entity = {
      ...plane,
      id: "scan",
      name: "Scan",
      kind: "mesh",
      positions: decode(entry.inputBits),
      planeFrame: undefined,
    };
    const versions = [
      serializeProject("Native reference", [mesh, plane]),
      await (
        await serializeProjectBlob("Native reference", [mesh, plane])
      ).text(),
    ];
    for (const text of versions) {
      const project = parseProject(text);
      const [source, restored] = project.entities;
      const before = source.positions.slice();
      expect(restored.planeFrame).toEqual(plane.planeFrame);
      expect(restored.planeFrame).not.toBe(plane.planeFrame);
      const request = scanToolRequest(
        source,
        { kind: "mirrorMesh", plane: "object", referenceId: restored.id },
        project.entities,
      );
      expect(request.operation).toEqual({
        kind: "mirrorMesh",
        ...plane.planeFrame,
      });
      expect(bits(runScanTool(request).positions)).toBe(entry.nativeBits);
      expect(source.positions).toEqual(before);
    }
  },
);

it("transforms stored plane axes with geometry and preserves them across save/load", () => {
  const plane = reference(capture.cases[0]),
    translation: Vec3 = [3, -2, 1],
    rotation: Vec3 = [20, 35, 70];
  const moved = {
    ...plane,
    positions: transformPositions(plane.positions, translation, rotation, 2),
    planeFrame: transformPlaneFrame(
      plane.planeFrame!,
      translation,
      rotation,
      2,
    ),
  };
  expect(() =>
    validatePlaneFrame(moved.planeFrame, moved.positions, moved.kind),
  ).not.toThrow();
  const restored = parseProject(serializeProject("Moved plane", [moved]))
    .entities[0];
  expect(mirrorReference(restored)).toEqual(moved.planeFrame);
  expect(plane.planeFrame).toEqual(reference(capture.cases[0]).planeFrame);
  expect(
    mirrorReference({ ...moved, planeFrame: plane.planeFrame }),
  ).toBeNull();
});

it("rejects malformed, nonplanar or non-reference frames at the file boundary", async () => {
  const plane = reference(capture.cases[0]);
  for (const patch of [
    { planeFrame: { ...plane.planeFrame!, normal: [0, 0, 0] } },
    { planeFrame: { ...plane.planeFrame!, tangent: [0, 0, 0] } },
    { planeFrame: { ...plane.planeFrame!, center: [0, 0, Infinity] } },
    { positions: [0, 0, 0, 1, 0, 0, 0, 0, 5] },
    { kind: "mesh" },
  ]) {
    const invalid = { ...plane, ...patch } as Entity;
    expect(() => serializeProject("Invalid", [invalid])).toThrow(/plane frame/);
    await expect(serializeProjectBlob("Invalid", [invalid])).rejects.toThrow(
      /plane frame/,
    );
    const raw = JSON.parse(serializeProject("Valid", [plane]));
    raw.entities[0] = invalid;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(/plane frame/);
  }
  const legacy = { ...plane, planeFrame: undefined };
  expect(
    mirrorReference(
      parseProject(serializeProject("Legacy", [legacy])).entities[0],
    ),
  ).not.toBeNull();
});
