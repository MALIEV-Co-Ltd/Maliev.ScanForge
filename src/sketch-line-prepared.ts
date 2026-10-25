import type { ReferenceVector } from "./reference-construction-values";
import {
  evaluateNativeSketchLinePoint,
  type NativeSketchLineConversion,
} from "./sketch-line-conversion";

export type NativeSketchLinePreparedEndpoints = {
  conversion: NativeSketchLineConversion;
  start: ReferenceVector;
  end: ReferenceVector;
};

function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid line wire candidate record.");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some((key) => !keys.includes(key)))
    throw new Error("Invalid line wire candidate field.");
  return r;
}
function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Line wire candidate requires finite XYZ points.");
  return [value[0], value[1], value[2]];
}
export function requireNativeSketchLinePreparedEndpoints(
  value: unknown,
): NativeSketchLinePreparedEndpoints {
  const r = record(value, ["conversion", "start", "end"]);
  const c = record(r.conversion, ["origin", "direction", "interval"]);
  if (
    !Array.isArray(c.interval) ||
    c.interval.length !== 2 ||
    !Array.from(c.interval).every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  )
    throw new Error(
      "Line wire candidate requires a finite parameter interval.",
    );
  const conversion: NativeSketchLineConversion = {
    origin: point(c.origin),
    direction: point(c.direction),
    interval: [c.interval[0], c.interval[1]],
  };
  const start = point(r.start),
    end = point(r.end);
  for (const [actual, parameter] of [
    [start, conversion.interval[0]],
    [end, conversion.interval[1]],
  ] as const) {
    const expected = evaluateNativeSketchLinePoint(
      conversion.origin,
      conversion.direction,
      parameter,
    );
    if (actual.some((n, axis) => !Object.is(n, expected[axis])))
      throw new Error(
        "Line wire candidate endpoints do not match prepared evaluation.",
      );
  }
  return { conversion, start, end };
}
