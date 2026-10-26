import assert from "node:assert/strict";

/** Read the bounded, non-rational single-surface STEP fixture captured by native QA. */
export function nativeStepPatch(text) {
  assert(
    Buffer.byteLength(text, "utf8") <= 128 * 1024,
    "Native fixture exceeds reader bound",
  );
  assert(
    text.includes("SI_UNIT(.MILLI.,.METRE.)"),
    "Native fixture must use millimetres",
  );
  assert(
    !text.includes("RATIONAL_B_SPLINE_SURFACE"),
    "Reader requires a non-rational surface",
  );
  const compact = text.replace(/\s+/g, "");
  const surfaces = [
    ...compact.matchAll(
      /#(\d+)\s*=\s*B_SPLINE_SURFACE_WITH_KNOTS\('',(\d+),(\d+),\(([\s\S]*?)\),\.UNSPECIFIED\.,\.F\.,\.F\.,\.F\.,\(([^)]*)\),\(([^)]*)\),\(([^)]*)\),\(([^)]*)\),/g,
    ),
  ];
  assert.equal(
    surfaces.length,
    1,
    "Reader requires exactly one native spline surface",
  );
  const [, surfaceId, du, dv, net, um, vm, uk, vk] = surfaces[0];
  const rows = [...net.matchAll(/\(([^()]*)\)/g)].map((m) =>
    [...m[1].matchAll(/#(\d+)/g)].map((r) => r[1]),
  );
  const countU = rows.length,
    countV = rows[0]?.length;
  assert(
    countU >= 2 &&
      countU <= 16 &&
      countV >= 2 &&
      countV <= 16 &&
      rows.every((r) => r.length === countV),
    "Native control net is not bounded rectangular data",
  );
  const vertices = new Map(
    [
      ...compact.matchAll(
        /#(\d+)\s*=\s*CARTESIAN_POINT\('',\(([^()]*)\)\s*\);/g,
      ),
    ].map((m) => [m[1], m[2].split(",").map(Number)]),
  );
  const points = [];
  for (let v = 0; v < countV; v++)
    for (let u = 0; u < countU; u++) {
      const point = vertices.get(rows[u][v]);
      assert(
        point?.length === 3 && point.every(Number.isFinite),
        "Native control point missing or invalid",
      );
      points.push(point);
    }
  const expand = (multiplicities, knots) => {
    const m = multiplicities.split(",").map(Number),
      k = knots.split(",").map(Number);
    assert(
      m.length === k.length &&
        m.every((x) => Number.isInteger(x) && x >= 1 && x <= 6) &&
        k.every(Number.isFinite),
    );
    return k.flatMap((x, i) => Array(m[i]).fill(x));
  };
  const patch = {
    format: "scanforge-nurbs",
    version: 1,
    countU,
    countV,
    degreeU: Number(du),
    degreeV: Number(dv),
    knotsU: expand(um, uk),
    knotsV: expand(vm, vk),
    points,
    weights: Array(points.length).fill(1),
  };
  assert.equal(patch.knotsU.length, countU + patch.degreeU + 1);
  assert.equal(patch.knotsV.length, countV + patch.degreeV + 1);
  return { surfaceId: Number(surfaceId), patch };
}
