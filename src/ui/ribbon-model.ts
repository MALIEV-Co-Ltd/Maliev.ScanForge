import { ribbonVerification } from "./ribbon-verification";

export const RIBBON_ACTION_IDS = [
  "newDocument",
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
  "fitSurface",
  "nurbsSurface",
  "newFreeform",
  "autoFreeform",
  "quadObj",
  "sketch2d",
  "reducePolygons",
  "reduceNoise",
  "scaleMesh",
  "flipNormals",
  "repolygonize",
  "averageMesh",
  "mirrorMesh",
  "unroll",
  "fineAlign",
  "alignNPoints",
  "repairMesh",
  "segmentMesh",
  "loft",
  "sweep",
  "fillet",
  "chamfer",
  "surfaceOffset",
  "sewSurfaces",
  "shell",
  "surfaceThicken",
  "splitSolid",
  "circularPattern",
  "linearPattern",
  "mirrorBody",
] as const;
export type RibbonActionId = (typeof RIBBON_ACTION_IDS)[number];
export type RibbonActions = Partial<Record<string, () => void>>;
export type RibbonIcon =
  | "newDocument"
  | "editScan"
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
  readonly options?: readonly RibbonTool[];
}
export interface RibbonGroup {
  readonly label: string;
  readonly tools: readonly RibbonTool[];
  readonly compact?: boolean;
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
const withOptions = (
  primary: RibbonTool,
  ...options: RibbonTool[]
): RibbonTool => ({
  ...primary,
  options,
});

/** Command inventory is independently authored; missing operations stay explicit. */
export const RIBBON_TABS: readonly RibbonTab[] = [
  {
    id: "main",
    label: "Main",
    groups: [
      group(
        "File",
        tool("newDocument", "New", "newDocument"),
        tool("open", "Open / Import", "folder"),
        tool("save", "Save project", "save"),
      ),
      group(
        "Scan Data",
        tool("editScan", "Edit scan", "editScan", true),
        withOptions(
          tool("repairMesh", "Repair", "cleanup", true),
          tool("cleanup", "Clean mesh", "cleanup", true),
          tool("flipNormals", "Flip normals", "surface", true),
        ),
        tool("reducePolygons", "Simplify", "cleanup"),
        withOptions(
          tool("align", "Align", "align", true),
          planned("alignCoordinates", "To origin / references", "align"),
          planned("alignInteractive", "Move / rotate scan", "transform"),
          tool("alignNPoints", "Between scans: point pairs", "select"),
          tool("fineAlign", "Between scans: fine alignment", "align"),
        ),
      ),
      {
        ...group(
          "Construct",
          withOptions(
            tool("fitPlane", "Plane", "plane", true),
            planned("middlePlane", "Middle plane", "plane"),
            planned("symmetryPlane", "Symmetry plane", "plane"),
            planned("cadPlane", "Plane from CAD", "plane"),
          ),
          planned("referenceAxis", "Axis", "align"),
          planned("referencePoint", "Point", "select"),
          planned("coordinateSystem", "Coordinate system", "align"),
        ),
        compact: true,
      },
      group(
        "Sketch",
        tool("sketch2d", "New sketch", "curve"),
        planned("sketchFromSection", "Section to sketch", "section"),
      ),
      group(
        "Inspect",
        withOptions(
          tool("measure", "Measure", "measure", true),
          tool("area", "Surface area", "surface", true),
          tool("volume", "Volume", "box", true),
        ),
        planned("sectionView", "Section view", "section"),
        tool("deviation", "Deviation", "deviation", true),
      ),
      group(
        "Export",
        withOptions(
          tool("exportStep", "Export STEP", "export"),
          tool("exportStl", "Export STL", "export"),
        ),
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
        planned("prepareScan", "Prepare scan", "cleanup"),
        tool("editScan", "Edit", "editScan", true),
        tool("select", "Select", "select"),
        planned("deselectAll", "Deselect all", "select"),
        planned("showHidden", "Show hidden", "view"),
        planned("invertHidden", "Invert hidden", "view"),
      ),
      group(
        "Tools",
        tool("cleanup", "Clean mesh", "cleanup", true),
        tool("repairMesh", "Repair topology", "cleanup", true),
        tool("segmentMesh", "Segment surfaces", "surface", true),
        tool("reducePolygons", "Reduce polygons", "cleanup"),
        tool("reduceNoise", "Reduce noise", "surface"),
        tool("scaleMesh", "Scale mesh", "transform", true),
        tool("flipNormals", "Flip normals", "surface", true),
        tool("repolygonize", "Re-polygonize", "wireframe", true),
        tool("averageMesh", "Average mesh", "surface", true),
        tool("mirrorMesh", "Mirror mesh", "pattern", true),
        tool("unroll", "Unroll", "surface", true),
      ),
      group(
        "Align",
        tool("align", "Principal axes", "align", true),
        planned("alignCoordinates", "By coordinate system", "align"),
        planned("alignInteractive", "Interactive", "transform"),
        tool("alignNPoints", "By N points", "select"),
        tool("fineAlign", "Fine align", "align"),
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
        planned("plane2dSketch", "Plane from 2D sketch", "plane"),
        tool("fitCylinder", "Cylinder", "cylinder", true),
        tool("fitCone", "Cone", "cone", true),
        tool("fitSphere", "Sphere", "sphere", true),
        planned("symmetryPlane", "Symmetry plane", "plane"),
        planned("referenceLine", "Reference line", "curve"),
        planned("referencePoint", "Reference point", "select"),
        planned("referenceAxis", "Axis", "align"),
        planned("coordinateSystem", "Coordinate system", "align"),
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
    id: "sketch",
    label: "Sketch",
    groups: [
      group(
        "Create",
        tool("sketch2d", "New sketch", "curve"),
        planned("sketch3d", "3D sketch", "curve"),
      ),
      group(
        "From scan",
        planned("sketchFromSection", "Section to sketch", "section"),
        tool("section", "Cross section", "section", true),
        planned("multipleSections", "Multiple sections", "section"),
      ),
      group("References", planned("projectSketch", "Project sketch", "curve")),
    ],
  },
  {
    id: "freeform",
    label: "Freeform",
    groups: [
      group(
        "Create New",
        tool("newFreeform", "New freeform", "surface"),
        tool("autoFreeform", "Auto freeform", "surface"),
        planned("freeformSketch", "From 3D sketch", "curve"),
        tool("quadObj", "From quad OBJ", "wireframe"),
      ),
      group(
        "Tools",
        planned("wrap", "Wrap surface", "surface"),
        {
          ...tool("surfaceThicken", "Thicken CAD surface", "extrude"),
          id: "freeformThicken",
        },
        {
          ...tool("surfaceOffset", "Offset CAD surface", "surface"),
          id: "freeformOffset",
        },
        {
          ...tool("nurbsSurface", "Convert to CAD face", "box"),
          id: "freeformConvert",
        },
      ),
    ],
  },
  {
    id: "surfacing",
    label: "Surfacing",
    groups: [
      group(
        "Create",
        tool("fitSurface", "Fit surface", "surface"),
        tool("nurbsSurface", "NURBS surface", "surface"),
        tool("loft", "Loft", "surface"),
        planned("fillSurface", "Fill surface", "surface"),
        planned("surface2dSketch", "From 2D sketch", "surface"),
        tool("sweep", "Sweep", "surface"),
        planned("pipe", "Pipe", "cylinder"),
        planned("sketch3d", "3D sketch", "curve"),
        planned("helix", "Helix", "curve"),
      ),
      group(
        "Tools",
        planned("rollSketch", "Roll sketch", "curve"),
        planned("duplicateFace", "Duplicate face", "surface"),
        tool("surfaceOffset", "Offset", "surface"),
        tool("surfaceThicken", "Thicken", "extrude"),
        planned("extendSurface", "Extend surface", "surface"),
        tool("sewSurfaces", "Sew surfaces", "boolean"),
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
        tool("sketch2d", "2D sketch", "curve"),
        planned("multipleSections", "Multiple sections", "section"),
        tool("section", "Cross section", "section", true),
        tool("primitive", "Primitive", "box"),
        tool("extrude", "Extrude", "extrude"),
        tool("revolve", "Revolve", "revolve"),
        planned("trim", "Trim", "section"),
        tool("boolean", "Boolean tools", "boolean", true),
        { ...tool("boolean", "Combine", "boolean", true), id: "combine" },
        { ...tool("boolean", "Cut", "section", true), id: "cut" },
        { ...tool("boolean", "Intersect", "boolean", true), id: "intersect" },
        tool("shell", "Shell", "box"),
        planned("draft", "Draft", "cone"),
        planned("deleteFaces", "Delete faces", "delete"),
        tool("transform", "Move body", "transform", true),
        planned("moveFace", "Move face", "transform"),
        planned("separateBodies", "Separate bodies", "box"),
        {
          ...tool("transform", "Scale body", "transform", true),
          id: "scaleBody",
        },
        tool("splitSolid", "Split solid", "section", true),
      ),
      group(
        "Edges",
        tool("fillet", "Fillet", "curve"),
        tool("chamfer", "Chamfer", "section"),
      ),
      group(
        "Patterns",
        tool("circularPattern", "Circular pattern", "pattern", true),
        tool("linearPattern", "Linear pattern", "pattern", true),
        tool("mirrorBody", "Mirror", "pattern", true),
      ),
      group("Export", tool("exportStep", "Export STEP", "export")),
    ],
  },
  {
    id: "analysis",
    label: "Inspect",
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
        tool("deviation", "Deviation", "deviation", true),
        planned("compareMeshes", "Compare to other meshes", "deviation"),
      ),
      group(
        "Sections",
        planned("sectionView", "Section view", "section"),
        tool("section", "Cross section", "section", true),
      ),
    ],
  },
  {
    id: "settings",
    label: "Settings",
    groups: [
      group(
        "Display units",
        planned("millimetres", "Millimetres", "measure"),
        planned("inches", "Inches", "measure"),
        planned("metres", "Metres", "measure"),
      ),
      group(
        "Software options",
        planned("language", "Language", "help"),
        planned("options", "Options", "settings"),
      ),
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
        planned("videoTutorials", "Video tutorials", "help"),
        planned("helpGuide", "User guide", "help"),
        planned("helpPdf", "Help (PDF)", "help"),
        planned("shortcuts", "Shortcuts", "help"),
        planned("examples", "Examples", "folder"),
        planned("checkUpdates", "Check for update", "cleanup"),
      ),
      group(
        "System",
        planned("systemLog", "System log", "help"),
        planned("resetLayout", "Reset layout", "view"),
        planned("changeLog", "Change log", "help"),
      ),
      group(
        "About",
        planned("credits", "Credits", "help"),
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
    tab.groups.flatMap((group) =>
      group.tools.flatMap((tool) => [tool, ...(tool.options ?? [])]),
    ),
  ).find((tool) => tool.id === id);
}
export function ribbonToolAvailability(
  tool: RibbonTool,
  state: RibbonState,
  actions: RibbonActions,
): { available: boolean; reason: string } {
  const verification = ribbonVerification(tool.id, !!tool.action);
  if (verification.status !== "verified")
    return { available: false, reason: verification.reason };
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
