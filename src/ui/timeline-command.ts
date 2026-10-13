/** Reuse the toolbar artwork and palette, including its colored operation overlays. */
export function timelineCommand(label: string): string {
  const rules: [RegExp, string][] = [
    [/\b(open|import)/i, "open"],
    [/reduce polygons/i, "reducePolygons"],
    [/reduce noise/i, "reduceNoise"],
    [/re.?polygon/i, "repolygonize"],
    [/flip normals/i, "flipNormals"],
    [/average mesh/i, "averageMesh"],
    [/mirror mesh/i, "mirrorMesh"],
    [/scale mesh/i, "scaleMesh"],
    [/unroll/i, "unroll"],
    [/triangles|defeature|smooth|fill.*hole|mesh|scan/i, "editScan"],
    [/freeform|subdivision/i, "newFreeform"],
    [/project.*boundar/i, "sketch2d"],
    [/deviation/i, "deviation"],
    [/measure|analysis|area|volume/i, "measure"],
    [/extrude/i, "extrude"],
    [/revolve/i, "revolve"],
    [/sketch/i, "sketch2d"],
    [/loft/i, "loft"],
    [/sweep/i, "sweep"],
    [/fit surface/i, "fitSurface"],
    [/surface|nurbs|sew/i, "nurbsSurface"],
    [/plane/i, "fitPlane"],
    [/cylinder/i, "fitCylinder"],
    [/cone/i, "fitCone"],
    [/sphere/i, "fitSphere"],
    [/align/i, "align"],
    [/section/i, "section"],
    [/boolean|combine|cut|solid|body|fillet|chamfer/i, "primitive"],
  ];
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? "primitive";
}
