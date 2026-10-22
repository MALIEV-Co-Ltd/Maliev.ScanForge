import { expect, it } from "vitest";
import {
  admitReconstructionInputs,
  isBorrowableReconstructionInput,
  RECONSTRUCTION_MAX_INPUT_COORDINATES,
  RECONSTRUCTION_MAX_PRIVATE_BYTES,
} from "../src/scan-reconstruction-input";

function unreadArray(length: number): number[] {
  return new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return length;
      throw Error("Admission must not read coordinates");
    },
  });
}

it("measures transport payload per view while counting every repeated input", () => {
  const ordinary = new Float32Array(18),
    shared = new Float32Array(new SharedArrayBuffer(144), 36, 9),
    numbers = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  expect(isBorrowableReconstructionInput(shared)).toBe(true);
  expect(isBorrowableReconstructionInput(ordinary)).toBe(false);
  expect(isBorrowableReconstructionInput(numbers)).toBe(false);
  expect(
    admitReconstructionInputs([ordinary, ordinary, shared, numbers]),
  ).toEqual({
    coordinates: 54,
    triangles: 6,
    privateBytes: 216,
  });
  expect(admitReconstructionInputs([shared, shared], false)).toEqual({
    coordinates: 18,
    triangles: 2,
    privateBytes: 72,
  });
});

it("preserves old three-million-facet numeric payload admission without visiting values", () => {
  expect(admitReconstructionInputs([unreadArray(27_000_000)])).toEqual({
    coordinates: 27_000_000,
    triangles: 3_000_000,
    privateBytes: 216_000_000,
  });
});

it("admits the private payload boundary and rejects the next complete facet before reads", () => {
  const length = Math.floor(RECONSTRUCTION_MAX_PRIVATE_BYTES / 8 / 9) * 9;
  expect(admitReconstructionInputs([unreadArray(length)]).privateBytes).toBe(
    length * 8,
  );
  expect(() => admitReconstructionInputs([unreadArray(length + 9)])).toThrow(
    /private.*payload/i,
  );
});

it("rejects coordinate work before payload or coordinate traversal", () => {
  const length = Math.floor(RECONSTRUCTION_MAX_INPUT_COORDINATES / 9) * 9;
  expect(() => admitReconstructionInputs([unreadArray(length)])).toThrow(
    /private.*payload/i,
  );
  expect(() => admitReconstructionInputs([unreadArray(length + 9)])).toThrow(
    /coordinate.*work/i,
  );
  expect(() =>
    admitReconstructionInputs([unreadArray(length), unreadArray(9)]),
  ).toThrow(/coordinate.*work/i);
});

it("admits at most 33 inputs and validates safe complete facet counts first", () => {
  const p = new Float32Array(9);
  expect(admitReconstructionInputs(Array(33).fill(p)).triangles).toBe(33);
  expect(() => admitReconstructionInputs(Array(34).fill(p))).toThrow(
    /33|32 additional/i,
  );
  for (const length of [0, 8, 9.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => admitReconstructionInputs([unreadArray(length)])).toThrow(
      /complete|safe/i,
    );
  expect(() => admitReconstructionInputs([])).toThrow(/input/i);
});
