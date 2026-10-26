import type { Entity, Vec3 } from "./types";
import { validateReferenceEntity } from "./reference-entity";
import {
  encodeReferenceGeometry,
  referenceLineEnd,
  type EncodedReferenceGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import { roundTripNativePickedCoordinate } from "./reference-pick-coordinates";

type EditUnits = { units: "mm"; coordinateSpace: "world" };
export type ReferenceNumericEditFields = EditUnits &
  (
    | {
        kind: "point";
        position: Vec3;
        positionEncoding: EncodedReferenceGeometry;
      }
    | {
        kind: "line";
        start: Vec3;
        end: Vec3;
        startEncoding: EncodedReferenceGeometry;
        endEncoding: EncodedReferenceGeometry;
      }
  );

function coordinate(value: number): void {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9)
    throw new Error(
      "Numeric edit coordinates require finite values within +/-1e9 mm.",
    );
}

/** Constant precision six: round the exact binary64 rational, not value*1e6. */
function fixedSix(value: number): number {
  coordinate(value);
  // Preserve the existing line zero sign; its native formatting remains a
  // separate evidence question. Point initialization prepares its sign first.
  if (value === 0) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value), false);
  const bits = view.getBigUint64(0, false);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const significand =
    (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  const power = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  const numerator = significand * 1000000n;
  const denominator = power < 0 ? 1n << BigInt(-power) : 1n;
  const scaled = power < 0 ? numerator : numerator << BigInt(power);
  let integer = scaled / denominator;
  const twiceRemainder = (scaled % denominator) * 2n;
  if (
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && integer % 2n !== 0n)
  )
    integer++;
  // The world bound makes integer <=1e15, exactly representable in binary64.
  const prepared = Number(integer) / 1e6;
  return value < 0 ? -prepared : prepared;
}

function pointPreRound(value: number): number {
  coordinate(value);
  const sign = value <= -(2 ** -23) ? -1 : 1;
  return (Math.trunc(Math.abs(value) * 1e7 + 0.5) / 1e7) * sign;
}

/** Detached startup-mm/N6 editor fields; accepted geometry/recipes stay exact. */
export function referenceNumericEditFields(
  entity: Entity,
): ReferenceNumericEditFields {
  const data = validateReferenceEntity(entity);
  if (!data)
    throw new Error("Numeric edit fields require a semantic reference.");
  const prepare = (values: ReferenceVector, point: boolean): Vec3 =>
    values.map((value) =>
      roundTripNativePickedCoordinate(
        fixedSix(point ? pointPreRound(value) : value),
      ),
    ) as Vec3;
  if (data.geometry.kind === "point") {
    const position = prepare(data.geometry.position, true);
    return {
      kind: "point",
      units: "mm",
      coordinateSpace: "world",
      position,
      positionEncoding: encodeReferenceGeometry({ kind: "point", position }),
    };
  }
  const start = prepare(data.geometry.start, false);
  const end = prepare(referenceLineEnd(data.geometry), false);
  return {
    kind: "line",
    units: "mm",
    coordinateSpace: "world",
    start,
    end,
    startEncoding: encodeReferenceGeometry({ kind: "point", position: start }),
    endEncoding: encodeReferenceGeometry({ kind: "point", position: end }),
  };
}
