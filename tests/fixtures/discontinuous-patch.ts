import type { NurbsPatch } from "../../src/surfaces";

/** V-outer/U-inner controls; two unit strips on each separated axis. */
export function separatedPatch(
  splitU = true,
  splitV = false,
  degree: 1 | 2 = 1,
  knot = 0.5,
): NurbsPatch {
  const axis = (split: boolean) => {
    if (!split)
      return { count: 2, degree: 1, knots: [0, 0, 1, 1], values: [0, 1] };
    const values = degree === 1 ? [0, 1, 10, 11] : [0, 0.5, 1, 10, 10.5, 11];
    return {
      count: values.length,
      degree,
      knots: [
        ...Array(degree + 1).fill(0),
        ...Array(degree + 1).fill(knot),
        ...Array(degree + 1).fill(1),
      ],
      values,
    };
  };
  const u = axis(splitU),
    v = axis(splitV);
  return {
    format: "scanforge-nurbs",
    version: 1,
    countU: u.count,
    countV: v.count,
    degreeU: u.degree,
    degreeV: v.degree,
    knotsU: u.knots,
    knotsV: v.knots,
    points: v.values.flatMap((y) =>
      u.values.map((x): [number, number, number] => [x, y, 0]),
    ),
    weights: Array(u.count * v.count).fill(1),
  };
}
