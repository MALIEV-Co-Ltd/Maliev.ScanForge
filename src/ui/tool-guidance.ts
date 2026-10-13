import type { SketchDrawingTool } from "../sketch-drawing";
export interface ToolGuidanceContext {
  shortcutMode?: import("../keyboard-shortcuts").ShortcutMode;
  hasSelection?: boolean;
  hasCadSelection?: boolean;
  busy?: boolean;
  planePicking?: boolean;
  mode: "inspect" | "measure" | "section" | "brush";
  brushActive?: boolean;
  selectionTool?:
    "brush" | "freehand" | "line" | "rectangle" | "circle" | "wand";
  selectThrough?: boolean;
  subtract?: boolean;
  sketchTool?: SketchDrawingTool;
  landmarkSide?: "moving" | "fixed";
  landmarkPreview?: boolean;
  reference?: "plane" | "cylinder";
  panel?: "components" | "holes" | "boundaries";
  parameterTool?: string;
  sectionAxis?: string;
  sectionOffset?: string;
  previewAuthoring?: "surface" | "sketch section";
}
const navigation = "Middle-drag orbits · Ctrl+drag pans · Shift+drag zooms";
const menu = "Right-click opens tools menu";
/** Instructions reflect the actual viewport input handlers, not just the ribbon tab. */
export function activeToolGuidance(context: ToolGuidanceContext): string {
  if (context.busy)
    return "Processing · modeling input paused · use the active Cancel button to stop";
  if (context.planePicking)
    return `Hover highlights plane · Left-click creates sketch · Hold left-click selects through · Escape cancels · ${menu}`;
  if (context.reference)
    return `Left-click picks ${context.reference === "plane" ? "planar reference" : "cylinder"} · Escape cancels picking · ${menu} · ${navigation}`;
  if (context.landmarkSide)
    return context.landmarkPreview
      ? `Alignment preview · Choose moving/fixed picking to edit points · Apply accepts · Cancel discards · ${menu}`
      : `Left-click adds ${context.landmarkSide} landmark · Pick matching points on the other object · ${menu} · ${navigation}`;
  if (context.sketchTool) {
    const instructions: Record<SketchDrawingTool, string> = {
      navigate: `Left/middle-drag orbits · Ctrl+drag pans · Shift+drag zooms · ${menu}`,
      line: "Left-drag draws line · Release sets endpoint · Right-click or Escape cancels unfinished drawing",
      move: "Left-drag moves an endpoint · Release applies · Right-click or Escape cancels unfinished move",
      circle:
        "Left-drag from center sets radius · Release creates circle · Right-click or Escape cancels drawing",
      circle3:
        "Left-click three points creates circle · Right-click or Escape clears unfinished points",
      arc3: "Left-click start, through point, then end creates arc · Right-click or Escape clears unfinished points",
    };
    return context.sketchTool === "navigate"
      ? instructions.navigate
      : `${instructions[context.sketchTool]} · ${navigation}`;
  }
  if (context.previewAuthoring)
    return `Adjust ${context.previewAuthoring} settings in panel · Preview checks result · Apply accepts · ${menu} · ${navigation}`;
  if (context.panel)
    return `Select ${context.panel === "components" ? "mesh component" : context.panel === "holes" ? "hole" : "boundary loop"} in panel · Left-click selects object · ${menu} · ${navigation}`;
  if (context.mode === "brush" && context.brushActive) {
    const tools = {
      brush: "Left-drag draws filled selection",
      freehand: "Left-drag paints selection along stroke",
      line: "Left-drag draws straight selection stroke",
      rectangle: "Left-drag draws selection rectangle",
      circle: "Left-drag draws selection circle",
      wand: "Left-click selects connected curvature region · Degrees slider changes tolerance",
    };
    const tool = context.selectionTool ?? "brush";
    return `${tools[tool]} · ${context.subtract ? "Subtract mode" : "Alt subtracts"}${context.selectThrough ? " · Select through enabled" : ""}${["brush", "freehand", "line"].includes(tool) ? " · Ctrl+wheel changes brush size" : ""} · ${menu} · ${navigation}`;
  }
  if (context.mode === "measure")
    return `Left-click two surface points measures distance · Next click starts new measurement · ${menu} · ${navigation}`;
  if (context.mode === "section")
    return `${context.sectionAxis ?? "Z"} section · ${context.sectionOffset ?? "0"} mm · Panel offset moves cutting plane · Left-click selects object · ${menu} · ${navigation}`;
  if (context.parameterTool) {
    const actions = [
      "Reduce polygons",
      "Reduce noise",
      "Scale mesh",
      "Mirror mesh",
    ].includes(context.parameterTool)
      ? "Preview checks result · Accept completes"
      : "Apply completes";
    return `${context.parameterTool}: adjust settings in panel · ${actions} · Left-click selects object · ${menu} · ${navigation}`;
  }
  return `Left-click selects · Hold left-click selects through · ${menu} · Left/middle-drag orbits · Ctrl+drag pans · Shift+drag zooms`;
}
