import {
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_PART_COLOR,
  DEFAULT_REFERENCE_COLOR,
} from "../appearance";
import { RIBBON_TABS } from "./ribbon-model";
import { GeneratedIcon } from "./GeneratedIcon";
import requests from "../../public/icons/generated/requests.json";
import "./RibbonCommandIcon.css";
const gold = "#edbe48",
  light = "#ffe294",
  shade = "#b98628";
/** Each command has independently generated raster artwork. */
export const RIBBON_ICON_ARTWORK: Readonly<Record<string, string>> =
  Object.fromEntries(
    requests
      .filter(({ id }) => id.startsWith("ribbon-"))
      .map(({ id }) => [id.slice(7), id]),
  );
const freeformCommands = new Set(
  RIBBON_TABS.find((tab) => tab.id === "freeform")!
    .groups.flatMap((group) => group.tools.map((tool) => tool.id))
    .concat(["wrap", "sketch3d"]),
);
const surfaceCommands = new Set(
  RIBBON_TABS.find((tab) => tab.id === "surfacing")!
    .groups.flatMap((group) => group.tools.map((tool) => tool.id))
    .concat(["surfacingTools"]),
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
  if (surfaceCommands.has(command))
    return { family: "surface", base: gold, light, shade, edge: "#705817" };
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
  const asset = RIBBON_ICON_ARTWORK[command];
  if (!asset) throw new Error(`Missing ribbon artwork: ${command}`);
  return (
    <GeneratedIcon
      asset={asset}
      size={compact ? 20 : 40}
      className="ribbon-cad-icon"
      data-artwork={command}
      data-palette={ribbonCommandPalette(command).family}
    />
  );
}
