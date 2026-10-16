import {
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_PART_COLOR,
  DEFAULT_REFERENCE_COLOR,
} from "../appearance";
import { RIBBON_TABS } from "./ribbon-model";
import { RIBBON_RASTER_ICONS } from "./RibbonRasterIcons";
/** Independently drawn, local SVG artwork. Each command has an explicit entry. */
const path = (d: string, fill = "none", extra = "") =>
  `<path d="${d}" fill="${fill}" ${extra}/>`;
const circle = (x: number, y: number, r: number, fill = "#ffe294") =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const gold = "#edbe48",
  light = "#ffe294",
  shade = "#b98628";
const green = "#8bbb80",
  red = "#e37766",
  purple = "#bba1d1";
const plane = path("M4 10h24v14H4Z", gold);
const solid =
  path("m16 3 12 6-12 7L4 9Z", light) +
  path("m4 9 12 7v13L4 22Z", gold) +
  path("m16 16 12-7v13l-12 7Z", shade);
const mesh =
  path("m3 22 5-15 11-3 10 16-12 9Z", gold) +
  path("m8 7 9 22 2-25M3 22l16-18M8 7l21 13M3 22l26-2");
const surface =
  path("M3 23C8 5 15 21 23 5l6 9C22 30 13 13 8 29Z", gold) +
  path("M5 19c8-9 14 6 20-10M7 26c7-12 15 5 21-9M11 13l5 10M19 11l5 10");
const cylinder =
  path("M6 8v17c0 5 20 5 20 0V8", gold) +
  '<ellipse cx="16" cy="8" rx="10" ry="4" fill="#ffe294"/>' +
  path("M6 25c0 5 20 5 20 0");
const cone =
  path("M16 3 4 25c0 6 24 6 24 0Z", gold) +
  path("M4 25c0-5 24-5 24 0", "none", 'stroke-dasharray="2 2"');
const arrow = path("M21 29V18h-4l7-7 7 7h-4v11Z", green);
const plus = path(
  "M22 19v10M17 24h10",
  "none",
  'stroke="#56884c" stroke-width="3"',
);
const cross = path(
  "m21 21 9 9m0-9-9 9",
  "none",
  'stroke="#d65e50" stroke-width="3"',
);
const pencil =
  path("m12 25 3-7L26 7l5 5-11 11Z", light) + path("m15 18 5 5m4-14 5 5");
const axes =
  path(
    "M7 25V4m0 21h23M7 25l13-12",
    "none",
    'stroke="#8bbb80" stroke-width="2"',
  ) + path("m4 7 3-3 3 3m17 15 3 3-3 3m-10-12 3-3 0 5");
const dots =
  circle(7, 8, 2, red) + circle(24, 12, 2, green) + circle(14, 25, 2, purple);
const file = path("M6 2h14l7 7v21H6Z", light) + path("M20 2v7h7");
const curve = path(
  "M3 25C10 1 16 31 29 6",
  "none",
  'stroke="#edbe48" stroke-width="3"',
);
const ruler =
  path("M3 10h26v13H3Z", light) + path("M7 10v6m4-6v9m4-9v6m4-6v9m4-9v6");
const offset =
  surface +
  path("M2 13C9-2 19 17 26 2", "none", 'stroke="#8bbb80" stroke-width="2"') +
  arrow;
const thick = surface + path("m3 23 1 5 4 3v-2m0 2c6-16 15 1 21-12v-5", shade);
const mirror =
  path("M16 2v28", "none", 'stroke="#bba1d1" stroke-dasharray="3 2"') +
  path("M3 8h8v16H3Z", gold) +
  path("M21 8h8v16h-8Z", green);
const heat =
  path("M4 4h8v24H4Z", "#e37766") +
  path("M12 4h8v24h-8Z", gold) +
  path("M20 4h8v24h-8Z", green);
const gear =
  path(
    "m12 3 1 4h6l1-4 4 3-2 4 3 4 4-1v6l-4-1-3 4 2 4-4 3-1-4h-6l-1 4-4-3 2-4-3-4-4 1v-6l4 1 3-4-2-4Z",
    gold,
  ) + circle(16, 16, 5, "#ececec");
const profiles =
  '<ellipse cx="16" cy="6" rx="11" ry="3" fill="#ffe294"/><ellipse cx="16" cy="26" rx="7" ry="3" fill="#edbe48"/>';
const view = (face: string) =>
  path("M6 6h20v20H6Z", "#c4c4c4") + path(face, gold) + path("M6 6h20v20H6Z");

export const RIBBON_ICON_ARTWORK: Readonly<Record<string, string>> = {
  prepareScan: mesh + gear,
  constructTools: solid + plane,
  alignTools: axes + dots,
  surfacingTools: surface + pencil,
  patternTools: solid + path("M2 2h8v8H2Zm20 20h8v8h-8Z", green),
  edgeTools: solid + curve,
  plane2dSketch: plane + pencil,
  surface2dSketch: surface + pencil,
  millimetres: ruler + path("M5 4v3m4-3v3m4-3v3m4-3v3m4-3v3"),
  inches: ruler + path("M5 4v3m11-3v3m11-3v3"),
  metres: ruler + path("M5 4h22m-11-3v6"),
  language:
    circle(16, 16, 12, light) +
    path("M4 16h24M16 4c-8 7-8 17 0 24 8-7 8-17 0-24Z"),
  options: gear + pencil,
  videoTutorials:
    path("M2 4h28v21H2ZM11 29h10", light) + path("m12 9 10 6-10 6Z", red),
  helpPdf:
    file +
    path(
      "M9 22c12-24 8 5 16-2M9 22h16",
      "none",
      'stroke="#d65e50" stroke-width="2"',
    ),
  examples: file + solid,
  checkUpdates: gear + arrow,
  systemLog: file + path("M10 13h13m-13 5h13m-13 5h8"),
  resetLayout: path("M2 4h28v24H2ZM2 11h28M10 11v17", light) + arrow,
  changeLog: file + plus,
  credits:
    circle(11, 10, 5, light) +
    circle(23, 12, 4, green) +
    path("M2 28v-7c0-8 18-8 18 0v7m0-10c5-3 10 0 10 5v5", gold),
  newDocument: file + plus,
  open:
    path("M2 9h11l3 4h14l-4 15H3Z", gold) + path("M3 9V5h10l3 4h12v4", light),
  save:
    path("M4 3h21l4 4v22H4Z", green) +
    path("M9 3h13v9H9Zm0 17h15v12H9Z", "#eee"),
  editScan: mesh + pencil,
  cleanup: mesh + path("m20 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z", light),
  repairMesh:
    mesh + path("M12 11h13v10H12Z", green) + path("M12 16h13m-7-5v10"),
  segmentMesh:
    mesh + path("m19 4-2 25 12-9Z", green) + path("m3 22 14 7-6-12Z", purple),
  select: path("M7 3v24l6-7 6 10 5-3-6-10h10Z", light),
  fitPlane: plane,
  fitCylinder: cylinder,
  fitCone: cone,
  fitSphere:
    circle(16, 16, 12, gold) +
    '<ellipse cx="16" cy="16" rx="5" ry="12" fill="#ffe294"/><ellipse cx="16" cy="16" rx="12" ry="4" fill="none"/>',
  align: solid + axes,
  section: solid + path("m2 18 19-8 10 6-19 9Z", purple),
  fitSurface: mesh + path("M2 18C10 2 19 25 30 10v8C18 30 11 9 2 26Z", green),
  newFreeform: surface + plus,
  primitive: solid,
  extrude: solid + arrow,
  revolve:
    cylinder +
    path(
      "M3 17C-2 30 34 30 29 16m0 0-5 4m5-4 2 6",
      "none",
      'stroke="#8bbb80" stroke-width="2.5"',
    ),
  measure: ruler + path("M4 5h24m-24 0 4-3m-4 3 4 3m20-3-4-3m4 3-4 3"),
  deviation: heat + curve,
  exportStep: solid + arrow,
  exportStl: mesh + arrow,
  undo: path("M12 4 3 12l9 7v-5h9c8 0 8 12 1 13 13-1 13-19-1-19h-9Z", gold),
  redo: path("M20 4 9 8C-4 8-4 26 10 27c-8-1-8-13 1-13h9v5l9-7-9-8Z", green),
  rebuild: gear + arrow,
  delete:
    path("M6 9h20l-2 21H8Z", red) +
    path("M3 8h26M12 4h8m-9 10v12m5-12v12m5-12v12"),
  fitView:
    solid +
    path(
      "M2 10V2h8m12 0h8v8m0 12v8h-8m-12 0H2v-8",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ),
  iso:
    solid +
    path("m2 3 4-1m20 28 4-1", "none", 'stroke="#8bbb80" stroke-width="2"'),
  top: view("M6 6h20v6H6Z"),
  bottom: view("M6 20h20v6H6Z"),
  left: view("M6 6h6v20H6Z"),
  right: view("M20 6h6v20h-6Z"),
  front: view("M10 10h16v16H10Z"),
  back:
    view("M6 6h16v16H6Z") +
    path("m6 6 20 20", "none", 'stroke-dasharray="2 2"'),
  coordinateSystem: axes,
  referenceAxis: axes + path("M4 27 27 4", "none", 'stroke-width="3"'),
  sketchFromSection:
    plane + path("M6 20 12 12l7 8 7-8", "none", 'stroke="#bba1d1"'),
  sectionView:
    solid + path("M2 16h28", "none", 'stroke="#e37766" stroke-width="3"'),
  wireframe: path(
    "m16 3 12 6v13l-12 7-12-7V9Zm0 0v13m12-7-12 7L4 9m12 7v13M4 22l12-6 12 6",
    "none",
    'stroke="#edbe48" stroke-width="1.8"',
  ),
  linearBackground:
    path("M3 4h26v24H3Z", "#ccc") +
    path("M3 16h26v12H3Z", "#777") +
    path("M3 24h26v4H3Z", "#444"),
  studioBackground:
    path("M3 4h26v24H3Z", "#aaa") +
    path("M3 23Q16 8 29 23v5H3Z", "#ddd") +
    circle(16, 16, 6, gold),
  deselectAll: path("M4 4h20v20H4Z", gold, 'stroke-dasharray="3 2"') + cross,
  showHidden:
    path("M2 16Q16 1 30 16 16 31 2 16Z", light) + circle(16, 16, 5, green),
  invertHidden:
    path("M2 16Q16 1 30 16 16 31 2 16Z", light) +
    path("M16 6v20Q30 23 30 16 25 8 16 6Z", shade),
  reducePolygons:
    path("m4 25 12-21 12 21Z", gold) + path("M16 4v21m-12 0 12-10 12 10"),
  reduceNoise:
    path("M2 9 5 4l4 10 4-10 4 9 4-8 4 8 5-9", "none", 'stroke="#e37766"') +
    path("M2 24Q16 13 30 24", "none", 'stroke="#edbe48" stroke-width="3"'),
  transform: solid + axes,
  scaleMesh:
    mesh +
    path(
      "M2 10V2h8m12 20h8v8h-8M3 3l8 8m18 18-8-8",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ),
  flipNormals:
    plane +
    path(
      "M10 14V2m0 0-4 5m4-5 4 5M23 19v12m0 0-4-5m4 5 4-5",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ),
  shrinkwrap:
    mesh +
    path(
      "M3 4Q16 0 29 4L29 28Q16 32 3 28Z",
      "none",
      'stroke="#87d3e8" stroke-width="2"',
    ),
  repolygonize:
    mesh +
    path("M8 7 3 22h26L19 4Z", "none", 'stroke="#8bbb80" stroke-width="2"'),
  averageMesh:
    path(
      "M2 8Q16 2 30 10M2 26Q16 18 30 24",
      "none",
      'stroke="#bba1d1" stroke-width="2"',
    ) + path("M2 17Q16 10 30 17", "none", 'stroke="#edbe48" stroke-width="3"'),
  mirrorMesh: mirror + path("M3 8l8 16M21 8l8 16"),
  unroll: cylinder + path("M16 17h14v13H16Z", green),
  alignCoordinates: axes + plane,
  alignInteractive:
    solid +
    path(
      "M3 16h26m-26 0 5-4m-5 4 5 4m21-4-5-4m5 4-5 4",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ),
  alignNPoints:
    path("m7 8 17 4-10 13Z", "none", 'stroke-dasharray="2 2"') + dots,
  fineAlign:
    mesh +
    path("M16 1v30M1 16h30", "none", 'stroke="#8bbb80"') +
    circle(16, 16, 5, "none"),
  globalFineAlign: circle(16, 16, 12, "none") + axes + dots,
  autoColorize: mesh + heat + plus,
  defaultColor:
    circle(16, 16, 12, "#a6a6a6") +
    path("M10 9h12", "none", 'stroke="#eee" stroke-width="3"'),
  objectColor:
    path("M27 17C33 5 18-2 8 5S0 28 12 29c9 2-1-8 7-9Z", gold) +
    circle(10, 10, 3, red) +
    circle(20, 8, 3, green) +
    circle(7, 20, 3, purple),
  extractPrimitives: mesh + circle(23, 23, 7, green),
  middlePlane: path("M4 3h24v5H4Zm0 21h24v5H4Z", "#aaa") + plane,
  planePath: plane + curve,
  planeSketchLine:
    plane + path("M1 27 31 5", "none", 'stroke="#8bbb80" stroke-width="2.5"'),
  symmetryPlane: mirror + path("m16 2 5 4v23l-5 2Z", purple),
  referenceLine:
    path("M5 26 27 5", "none", 'stroke="#edbe48" stroke-width="2.5"') +
    circle(5, 26, 3) +
    circle(27, 5, 3),
  referencePoint:
    path("M16 3v26M3 16h26", "none", 'stroke="#aaa"') + circle(16, 16, 4, gold),
  cadPlane: plane + circle(26, 26, 4, green),
  cadCylinder: cylinder + circle(26, 26, 4, green),
  cadCone: cone + circle(26, 26, 4, green),
  autoFreeform: surface + dots,
  freeformSketch: surface + pencil,
  quadObj: path("M3 3h26v26H3Zm13 0v26M3 16h26", gold),
  wrap: circle(16, 16, 11, shade) + surface,
  freeformThicken: thick,
  freeformOffset: offset,
  freeformConvert: surface + circle(26, 26, 4, green),
  nurbsSurface: surface + dots + circle(5, 20, 2, red),
  loft: path("M5 6 9 26h14l4-20Z", gold) + profiles,
  fillSurface:
    path("M4 5 26 3 29 25 7 29Z", gold) +
    path("M6 6 27 24m-2-18L8 26", "none", 'stroke-dasharray="2 2"'),
  sweep:
    path("M4 26C5 5 13 28 28 4l3 6C18 32 11 13 10 29Z", gold) +
    circle(7, 26, 4, light),
  pipe:
    path("M5 26V13Q5 5 15 5h13v8H15q-2 0-2 3v10Z", gold) +
    '<ellipse cx="9" cy="26" rx="4" ry="3" fill="#ffe294"/>',
  sketch3d: axes + curve + pencil,
  helix: path(
    "M9 29C36 22-4 20 23 13S-5 8 23 2",
    "none",
    'stroke="#edbe48" stroke-width="3"',
  ),
  rollSketch: cylinder + curve,
  duplicateFace: path("M2 3h20v14H2Z", green) + path("M10 15h20v14H10Z", gold),
  surfaceOffset: offset,
  surfaceThicken: thick,
  extendSurface:
    surface + path("M23 5 31 2v15l-2-3Z", green, 'stroke-dasharray="2 2"'),
  sewSurfaces:
    path("M2 7h12v22H2Z", gold) +
    path("M18 3h12v22H18Z", green) +
    path(
      "M12 8h8m-8 5h8m-8 5h8m-8 5h8",
      "none",
      'stroke="#e37766" stroke-width="2"',
    ),
  projectSketch:
    plane +
    path(
      "M4 3Q16 12 28 3M8 4v14m16-14v14",
      "none",
      'stroke="#8bbb80" stroke-dasharray="2 2"',
    ) +
    curve,
  flatten:
    plane +
    path(
      "M4 5Q16-1 28 5M16 3v17m-4-4 4 4 4-4",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ),
  sketch2d: plane + pencil,
  multipleSections:
    solid + path("m1 10 18-8 12 6-18 9Zm0 10 18-8 12 6-18 9Z", purple),
  trim:
    plane +
    path("m17 7 13 13v7H17Z", red) +
    path("M17 2v29", "none", 'stroke-dasharray="2 2"'),
  boolean: circle(11, 16, 9, gold) + circle(22, 16, 9, green),
  combine:
    path("M16 7C4-1-5 23 11 26c4 1 6-2 8-1 17 3 15-25 1-19Z", gold) + plus,
  cut:
    path("M4 4h24v24H4Z", gold) +
    circle(26, 9, 9, "#d5d5d5") +
    path("M20 1v17h11", "none", 'stroke="#e37766" stroke-dasharray="2 2"'),
  intersect:
    circle(11, 16, 9, "none") +
    circle(22, 16, 9, "none") +
    path("M16.5 9q-10 7 0 14 10-7 0-14Z", gold),
  shell: solid + path("m16 7 7 3-7 4-7-4Z", "#777"),
  draft:
    path("M10 3h12l8 26H2Z", gold) +
    path("M10 3v26m12-26v26", "none", 'stroke-dasharray="2 2"'),
  deleteFaces: solid + path("m16 16 12-7v13l-12 7Z", red) + cross,
  moveFace: solid + path("m16 3 12 6-12 7L4 9Z", green) + arrow,
  separateBodies:
    path("m3 8 8-4 4 4v14l-8 4-4-4Z", gold) +
    path("m19 8 8-4 4 4v14l-8 4-4-4Z", green),
  scaleBody:
    solid +
    path(
      "M2 10V2h8m12 20h8v8h-8",
      "none",
      'stroke="#8bbb80" stroke-width="2"',
    ) +
    path("M19 19 30 30m-6 0h6v-6", "none", 'stroke="#8bbb80" stroke-width="2"'),
  splitMesh: mesh + path("M14 1v30h4V1Z", purple),
  splitSolid: solid + path("M14 1v30h4V1Z", purple),
  fillet:
    path("M3 29V3h9v9Q12 20 20 20h9v9Z", gold) +
    path("M12 12Q12 20 20 20", "none", 'stroke="#8bbb80" stroke-width="2.5"'),
  chamfer:
    path("M3 29V3h9v11l6 6h11v9Z", gold) +
    path("m12 14 6 6", "none", 'stroke="#8bbb80" stroke-width="2.5"'),
  circularPattern:
    circle(16, 16, 11, "none") +
    circle(16, 5, 4, gold) +
    circle(27, 16, 4, gold) +
    circle(16, 27, 4, gold) +
    circle(5, 16, 4, gold),
  linearPattern:
    path("M2 12h7v9H2Zm11 0h7v9h-7Zm11 0h7v9h-7Z", gold) +
    path("M3 5h26", "none", 'stroke="#8bbb80" stroke-dasharray="2 2"'),
  mirrorBody: mirror,
  area: solid + path("m16 3 12 6-12 7L4 9Z", green),
  volume: solid + path("m9 11 7 4 7-4v9l-7 5-7-5Z", green),
  zebra:
    surface +
    path(
      "M8 12l6 14m1-13 5 12m2-17 5 11",
      "none",
      'stroke="#ececec" stroke-width="3"',
    ),
  environment:
    circle(16, 16, 12, "#ddd") +
    path("M5 15Q16 8 27 15v8Q16 30 5 23Z", shade) +
    path("M10 5Q16 12 22 5", "none", 'stroke="#fff" stroke-width="3"'),
  draftAnalysis: cone + path("M16 3 28 25H16Z", green),
  snapshot:
    path("M3 9h7l3-5h7l3 5h7v19H3Z", gold) +
    circle(16, 18, 7, "#888") +
    circle(16, 18, 4, "#eee"),
  compareMeshes: mesh + heat,
  settings: gear,
  units:
    ruler + path("M5 4v3m22-3v3", "none", 'stroke="#8bbb80" stroke-width="2"'),
  tessellation:
    circle(16, 16, 13, gold) +
    path("m16 3-10 21 23-8-13-13v26L3 16l26 0-13 13"),
  helpGuide:
    path("M2 5Q9 2 16 7q7-5 14-2v23q-7-3-14 1-7-4-14-1Z", light) +
    path("M16 7v22M6 10h6m-6 5h6m-6 5h6m8-10h6m-6 5h6m-6 5h6"),
  shortcuts:
    path("M2 7h28v19H2Z", gold) +
    path(
      "M6 11h3m3 0h3m3 0h3m3 0h3M6 16h3m3 0h3m3 0h3m3 0h3M8 22h16",
      "none",
      'stroke="#705817" stroke-width="2"',
    ),
  about:
    circle(16, 16, 13, light) +
    circle(16, 8, 1.5, shade) +
    path("M16 13v11m-3 0h6", "none", 'stroke="#705817" stroke-width="3"'),
};

const freeformCommands = new Set(
  RIBBON_TABS.find((tab) => tab.id === "freeform")!
    .groups.flatMap((group) => group.tools.map((tool) => tool.id))
    .concat(["fitSurface", "wrap", "sketch3d"]),
);
const primitiveCommands = new Set([
  "fitPlane",
  "fitCylinder",
  "fitCone",
  "fitSphere",
  "extractPrimitives",
  "middlePlane",
  "planePath",
  "planeSketchLine",
  "symmetryPlane",
  "referenceLine",
  "referencePoint",
  "referenceAxis",
  "coordinateSystem",
  "cadPlane",
  "cadCylinder",
  "cadCone",
]);
const cadCommands = new Set(
  RIBBON_TABS.find((tab) => tab.id === "cad")!
    .groups.flatMap((group) => group.tools.map((tool) => tool.id))
    .concat([
      "nurbsSurface",
      "loft",
      "fillSurface",
      "sweep",
      "pipe",
      "surfaceOffset",
      "surfaceThicken",
      "extendSurface",
      "sewSurfaces",
      "duplicateFace",
      "flatten",
    ]),
);
export function ribbonCommandPalette(command: string) {
  if (freeformCommands.has(command))
    return {
      family: "freeform",
      base: DEFAULT_FREEFORM_COLOR,
      light: "#dbc5ef",
      shade: "#775493",
      edge: "#4c365f",
    };
  if (primitiveCommands.has(command))
    return {
      family: "reference",
      base: DEFAULT_REFERENCE_COLOR,
      light: "#bce4df",
      shade: "#3e8f86",
      edge: "#285c57",
    };
  if (cadCommands.has(command))
    return {
      family: "cad",
      base: DEFAULT_PART_COLOR,
      light: "#dedede",
      shade: "#777777",
      edge: "#494949",
    };
  return { family: "scan", base: gold, light, shade, edge: "#705817" };
}
export function RibbonCommandIcon({
  command,
  compact = false,
}: {
  command: string;
  compact?: boolean;
}) {
  const artwork = RIBBON_ICON_ARTWORK[command];
  if (!artwork) throw new Error(`Missing ribbon artwork: ${command}`);
  const palette = ribbonCommandPalette(command);
  const image = compact ? undefined : RIBBON_RASTER_ICONS[command];
  if (image)
    return (
      <img
        className="ribbon-cad-icon ribbon-command-image"
        data-artwork={command}
        data-palette={palette.family}
        src={image}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={40}
        height={40}
      />
    );
  const colors: Record<string, string> = {
    [gold]: palette.base,
    [light]: palette.light,
    [shade]: palette.shade,
    "#705817": palette.edge,
  };
  const coloredArtwork = artwork.replace(
    /#(?:edbe48|ffe294|b98628|705817)/g,
    (color) => colors[color],
  );
  return (
    <svg
      className="ribbon-cad-icon"
      data-artwork={command}
      data-palette={palette.family}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      stroke={palette.edge}
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
      dangerouslySetInnerHTML={{ __html: coloredArtwork }}
    />
  );
}
