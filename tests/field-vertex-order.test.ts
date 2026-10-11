import { describe, expect, it } from "vitest";
import { orderAxisVertices } from "../src/field-vertex-order";
import fixtures from "./fixtures/field-native-order.json";

describe("recovered companion axis ordering", () => {
  for (const axis of [0, 1, 2] as const)
    it.each(fixtures.cases.map((sample, index) => ({ ...sample, index })))(
      `matches native unit fixture $index on axis ${axis}`,
      ({ coordinates, order }) => {
        const positions = new Float32Array(coordinates.length * 3);
        coordinates.forEach((value, index) => {
          positions[index * 3 + axis] = value;
        });
        const original = positions.slice();
        const actual = orderAxisVertices(positions, axis);
        expect(Array.from(actual)).toEqual(order);
        expect(positions).toEqual(original);
      },
    );
  it("owns empty output and rejects invalid dimensions, axes and nonfinite coordinates", () => {
    const source = new Float32Array();
    expect(orderAxisVertices(source, 0)).toEqual(new Uint32Array());
    expect(() => orderAxisVertices(new Float32Array([1]), 0)).toThrow(
      /dimensions/,
    );
    expect(() => orderAxisVertices(source, 3 as 0)).toThrow(/axis/);
    expect(() =>
      orderAxisVertices(new Float32Array([Infinity, 0, 0]), 0),
    ).toThrow(/finite/);
  });
});
