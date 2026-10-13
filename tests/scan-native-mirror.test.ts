import { expect, it } from "vitest";
import { mirrorScanMesh } from "../src/scan-tools-transforms";
import { inverseMirrorFrame, mirrorPlaneFrame } from "../src/scan-mirror-frame";
import type { Vec3 } from "../src/types";
import capture from "./fixtures/mirror-coordinate-native.json";
import tangentCapture from "./fixtures/mirror-tangent-native.json";
import cadCapture from "./fixtures/mirror-cad-plane-native.json";
import nurbsCapture from "./fixtures/mirror-nurbs-plane-native.json";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );

it.each([
  ...capture.cases,
  ...tangentCapture.cases,
  ...cadCapture.cases,
  ...nurbsCapture.cases,
])("matches original Mirror arithmetic for $name on $plane.name", (entry) => {
  const positions = decode(entry.inputBits),
    before = positions.slice();
  const center = entry.plane.center as Vec3,
    normal = entry.plane.normal as Vec3;
  const tangent =
    "tangent" in entry.plane ? (entry.plane.tangent as Vec3) : undefined;
  const frame = mirrorPlaneFrame(center, normal, tangent);
  expect(new Uint8Array(new Float64Array(frame).buffer)).toEqual(
    Uint8Array.from(entry.frameBits.match(/../g)!, (byte) =>
      parseInt(byte, 16),
    ),
  );
  expect(
    new Uint8Array(new Float64Array(inverseMirrorFrame(frame)).buffer),
  ).toEqual(
    Uint8Array.from(entry.inverseBits.match(/../g)!, (byte) =>
      parseInt(byte, 16),
    ),
  );
  const result = mirrorScanMesh(positions, {
    center,
    normal: ("inputNormal" in entry.plane
      ? entry.plane.inputNormal
      : normal) as Vec3,
    tangent,
  });
  expect(new Uint8Array(result.positions.buffer)).toEqual(
    new Uint8Array(decode(entry.nativeBits).buffer),
  );
  expect(new Uint8Array(positions.buffer)).toEqual(
    new Uint8Array(before.buffer),
  );
});

it("retains input on cancellation after plane-frame preparation", () => {
  const entry = capture.cases[0],
    positions = decode(entry.inputBits),
    before = positions.slice();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    mirrorScanMesh(positions, {
      center: entry.plane.center as Vec3,
      normal: entry.plane.normal as Vec3,
      signal: controller.signal,
    }),
  ).toThrow(/cancelled/);
  expect(new Uint8Array(positions.buffer)).toEqual(
    new Uint8Array(before.buffer),
  );
});
