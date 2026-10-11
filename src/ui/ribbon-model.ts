export const RIBBON_ACTION_IDS = [
  "open",
  "save",
  "undo",
  "redo",
  "fitView",
  "iso",
  "top",
  "bottom",
  "left",
  "right",
  "front",
  "back",
  "fitPlane",
  "fitCylinder",
  "fitCone",
  "fitSphere",
  "primitive",
  "align",
  "transform",
  "section",
  "extrude",
  "revolve",
  "boolean",
  "measure",
  "deviation",
  "area",
  "volume",
  "cleanup",
  "delete",
  "exportStep",
  "exportStl",
  "settings",
  "select",
  "editScan",
  "wireframe",
  "objectColor",
] as const;
export type RibbonActionId = (typeof RIBBON_ACTION_IDS)[number];
export type RibbonActions = Partial<Record<string, () => void>>;
export type RibbonIcon =
  | "folder"
  | "save"
  | "undo"
  | "redo"
  | "select"
  | "fit"
  | "view"
  | "plane"
  | "cylinder"
  | "cone"
  | "sphere"
  | "box"
  | "align"
  | "transform"
  | "section"
  | "extrude"
  | "revolve"
  | "boolean"
  | "measure"
  | "deviation"
  | "cleanup"
  | "delete"
  | "export"
  | "settings"
  | "wireframe"
  | "color"
  | "curve"
  | "surface"
  | "pattern"
  | "help";
export interface RibbonTool {
  readonly id: string;
  readonly label: string;
  readonly icon: RibbonIcon;
  readonly action?: RibbonActionId;
  readonly requiresSelection?: boolean;
}
export interface RibbonGroup {
  readonly label: string;
  readonly tools: readonly RibbonTool[];
}
export interface RibbonTab {
  readonly id: string;
  readonly label: string;
  readonly groups: readonly RibbonGroup[];
}
const tool = (
  action: RibbonActionId,
  label: string,
  icon: RibbonIcon,
  requiresSelection = false,
): RibbonTool => ({ id: action, label, icon, action, requiresSelection });
const planned = (id: string, label: string, icon: RibbonIcon): RibbonTool => ({
  id,
  label,
  icon,
});
const group = (label: string, ...tools: RibbonTool[]): RibbonGroup => ({
  label,
  tools,
});

/** Command inventory is independently authored; missing operations stay explicit. */
export const RIBBON_TABS: readonly RibbonTab[] = [
  {
    id: "main",
    label: "Main",
    groups: [
      group(
        "File",
        tool("open", "Import", "folder"),
        tool("save", "Save project", "save"),
      ),
      group(
        "Scan Data",
        tool("editScan", "Edit scan", "cleanup", true),
        tool("cleanup", "Clean mesh", "cleanup", true),
        tool("select", "Select", "select"),
      ),
      group(
        "Primitives",
        tool("fitPlane", "Plane", "plane", true),
        tool("fitCylinder", "Cylinder", "cylinder", true),
        tool("fitCone", "Cone", "cone", true),
        tool("fitSphere", "Sphere", "sphere", true),
      ),
      group("Align", tool("align", "Principal axes", "align", true)),
      group(
        "Cross sections",
        tool("section", "Cross section", "section", true),
      ),
      group("Surfacing", planned("fitSurface", "Fit surface", "surface")),
      group("Freeform", planned("newFreeform", "New freeform", "surface")),
      group(
        "Part Design",
        tool("primitive", "Primitive", "box"),
        tool("extrude", "Extrude", "extrude"),
        tool("revolve", "Revolve", "revolve"),
      ),
      group(
        "Analysis",
        tool("measure", "Measure", "measure", true),
        tool("deviation", "Compare", "deviation", true),
      ),
      group(
        "Export Model",
        tool("exportStep", "Export STEP", "export"),
        tool("exportStl", "Export STL", "export"),
      ),
    ],
  },
  {
    id: "view",
    label: "Edit / View",
    groups: [
      group(
        "Edit",
        tool("undo", "Undo", "undo"),
        tool("redo", "Redo", "redo"),
        planned("rebuild", "Rebuild", "cleanup"),
        tool("delete", "Delete", "delete", true),
      ),
      group(
        "View",
        tool("fitView", "Zoom to fit", "fit"),
        tool("iso", "Isometric", "view"),
        tool("top", "Top", "view"),
        tool("bottom", "Bottom", "view"),
        tool("left", "Left", "view"),
        tool("right", "Right", "view"),
        tool("front", "Front", "view"),
        tool("back", "Back", "view"),
        planned("coordinateSystem", "Coordinate system", "align"),
        tool("wireframe", "Wireframe", "wireframe"),
      ),
      group(
        "Background style",
        planned("linearBackground", "Linear", "color"),
        planned("studioBackground", "Studio", "color"),
      ),
    ],
  },
  {
    id: "scan",
    label: "Scan Data",
    groups: [
      group(
        "Edit scan data",
        tool("editScan", "Edit", "cleanup", true),
        tool("select", "Select", "select"),
        planned("deselectAll", "Deselect all", "select"),
        planned("showHidden", "Show hidden", "view"),
        planned("invertHidden", "Invert hidden", "view"),
      ),
      group(
        "Tools",
        tool("cleanup", "Clean mesh", "cleanup", true),
        planned("reducePolygons", "Reduce polygons", "cleanup"),
        planned("reduceNoise", "Reduce noise", "surface"),
        tool("transform", "Scale", "transform", true),
        planned("flipNormals", "Flip normals", "surface"),
        planned("repolygonize", "Re-polygonize", "wireframe"),
        planned("averageMesh", "Average mesh", "surface"),
        planned("mirrorMesh", "Mirror", "pattern"),
        planned("unroll", "Unroll", "surface"),
      ),
      group(
        "Align",
        tool("align", "Principal axes", "align", true),
        planned("alignCoordinates", "By coordinate system", "align"),
        planned("alignInteractive", "Interactive", "transform"),
        planned("alignNPoints", "By N points", "select"),
        planned("fineAlign", "Fine align", "align"),
        planned("globalFineAlign", "Global fine align", "align"),
      ),
      group(
        "Colors",
        planned("autoColorize", "Auto colorize", "color"),
        planned("defaultColor", "Set default color", "color"),
        tool("objectColor", "Object color", "color", true),
      ),
      group("Export", tool("exportStl", "Export visible", "export")),
    ],
  },
  {
    id: "construct",
    label: "Construct",
    groups: [
      group(
        "From Scan Data",
        planned("extractPrimitives", "Extract primitives", "surface"),
      ),
      group(
        "Primitives",
        tool("fitPlane", "Plane", "plane", true),
        planned("middlePlane", "Middle plane", "plane"),
        planned("planePath", "Plane along path", "plane"),
        planned("planeSketchLine", "Plane through sketch line", "plane"),
        tool("fitCylinder", "Cylinder", "cylinder", true),
        tool("fitCone", "Cone", "cone", true),
        tool("fitSphere", "Sphere", "sphere", true),
        planned("symmetryPlane", "Symmetry plane", "plane"),
        planned("referenceLine", "Reference line", "curve"),
        planned("referencePoint", "Reference point", "select"),
      ),
      group(
        "From CAD",
        planned("cadPlane", "Plane", "plane"),
        planned("cadCylinder", "Cylinder", "cylinder"),
        planned("cadCone", "Cone", "cone"),
      ),
    ],
  },
  {
    id: "freeform",
    label: "Freeform",
    groups: [
      group(
        "Create New",
        planned("newFreeform", "New freeform", "surface"),
        planned("autoFreeform", "Auto freeform", "surface"),
        planned("freeformSketch", "From 3D sketch", "curve"),
        planned("quadObj", "From quad OBJ", "wireframe"),
      ),
      group(
        "Tools",
        planned("wrap", "Wrap surface", "surface"),
        planned("freeformThicken", "Thicken", "extrude"),
        planned("freeformOffset", "Offset", "surface"),
        planned("freeformConvert", "Convert to CAD body", "box"),
      ),
    ],
  },
  {
    id: "surfacing",
    label: "Surfacing",
    groups: [
      group(
        "Create",
        planned("fitSurface", "Fit surface", "surface"),
        planned("nurbsSurface", "NURBS surface", "surface"),
        planned("loft", "Loft", "surface"),
        planned("fillSurface", "Fill surface", "surface"),
        planned("sweep", "Sweep", "surface"),
        planned("pipe", "Pipe", "cylinder"),
        planned("sketch3d", "3D sketch", "curve"),
        planned("helix", "Helix", "curve"),
      ),
      group(
        "Tools",
        planned("rollSketch", "Roll sketch", "curve"),
        planned("duplicateFace", "Duplicate face", "surface"),
        planned("surfaceOffset", "Offset", "surface"),
        planned("surfaceThicken", "Thicken", "extrude"),
        planned("extendSurface", "Extend surface", "surface"),
        planned("sewSurfaces", "Sew surfaces", "boolean"),
        planned("projectSketch", "Project sketch", "curve"),
        planned("flatten", "Flatten", "plane"),
      ),
    ],
  },
  {
    id: "cad",
    label: "CAD",
    groups: [
      group(
        "Create",
        planned("sketch2d", "2D sketch", "curve"),
        planned("multipleSections", "Multiple sections", "section"),
        tool("primitive", "Primitive", "box"),
        tool("extrude", "Extrude", "extrude"),
        tool("revolve", "Revolve", "revolve"),
        planned("trim", "Trim", "section"),
        tool("boolean", "Boolean tools", "boolean", true),
        planned("combine", "Combine", "boolean"),
        planned("cut", "Cut", "section"),
        planned("intersect", "Intersect", "boolean"),
        planned("shell", "Shell", "box"),
        planned("draft", "Draft", "cone"),
        planned("deleteFaces", "Delete faces", "delete"),
        tool("transform", "Move body", "transform", true),
        planned("moveFace", "Move face", "transform"),
        planned("separateBodies", "Separate bodies", "box"),
        planned("scaleBody", "Scale body", "transform"),
        planned("splitSolid", "Split solid", "section"),
      ),
      group(
        "Edges",
        planned("fillet", "Fillet", "curve"),
        planned("chamfer", "Chamfer", "section"),
      ),
      group(
        "Patterns",
        planned("circularPattern", "Circular pattern", "pattern"),
        planned("linearPattern", "Linear pattern", "pattern"),
        planned("mirrorBody", "Mirror", "pattern"),
      ),
      group("Export", tool("exportStep", "Export STEP", "export")),
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    groups: [
      group(
        "Tools",
        tool("measure", "Measure", "measure", true),
        tool("area", "Surface area", "surface", true),
        tool("volume", "Volume", "box", true),
        planned("zebra", "Zebra stripes", "surface"),
        planned("environment", "Environment map", "view"),
        planned("draftAnalysis", "Draft", "cone"),
        planned("snapshot", "Snapshot", "view"),
      ),
      group(
        "Control",
        tool("deviation", "Compare", "deviation", true),
        planned("compareMeshes", "Compare to other meshes", "deviation"),
      ),
    ],
  },
  {
    id: "settings",
    label: "Settings",
    groups: [
      group(
        "Preferences",
        tool("settings", "Appearance", "settings"),
        planned("units", "Units", "measure"),
        planned("tessellation", "Tessellation", "wireframe"),
      ),
    ],
  },
  {
    id: "help",
    label: "Help",
    groups: [
      group(
        "Documentation",
        planned("helpGuide", "User guide", "help"),
        planned("shortcuts", "Shortcuts", "help"),
        planned("about", "About", "help"),
      ),
    ],
  },
];

export interface RibbonState {
  disabled: boolean;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
export function getRibbonToolMetadata(id: string): RibbonTool | undefined {
  return RIBBON_TABS.flatMap((tab) =>
    tab.groups.flatMap((group) => group.tools),
  ).find((tool) => tool.id === id);
}
export function ribbonToolAvailability(
  tool: RibbonTool,
  state: RibbonState,
  actions: RibbonActions,
): { available: boolean; reason: string } {
  if (
    !tool.action ||
    !(RIBBON_ACTION_IDS as readonly string[]).includes(tool.action) ||
    typeof actions[tool.action] !== "function"
  )
    return { available: false, reason: "Not implemented yet" };
  if (state.disabled)
    return {
      available: false,
      reason: "Wait for the current operation to finish",
    };
  if (tool.requiresSelection && !state.hasSelection)
    return { available: false, reason: "Select an object first" };
  if (tool.action === "undo" && !state.canUndo)
    return { available: false, reason: "Nothing to undo" };
  if (tool.action === "redo" && !state.canRedo)
    return { available: false, reason: "Nothing to redo" };
  return { available: true, reason: tool.label };
}
