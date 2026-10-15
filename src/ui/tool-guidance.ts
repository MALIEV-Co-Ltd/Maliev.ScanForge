import type { SketchDrawingTool } from "../sketch-drawing";
export interface ToolGuidanceContext {
  shortcutMode?: import("../keyboard-shortcuts").ShortcutMode;
  hasSelection?: boolean;
  hasCadSelection?: boolean;
  busy?: boolean;
  interactiveAlignment?: boolean;
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
/** Show one useful next action; the full controls remain in the hint's title. */
export function compactToolGuidance(context: ToolGuidanceContext): string {
  const full = activeToolGuidance(context);
  if (full.startsWith("Left-click selects ·"))
    return "Select an object · Right-click for tools";
  if (context.busy) return "Processing · Cancel to stop";
  if (context.interactiveAlignment) return "Left-drag handles · Escape cancels";
  if (context.planePicking) return "Left-click creates sketch · Escape cancels";
  if (context.mode === "section" && full.includes(" section ·"))
    return full.split(" · ").slice(0, 2).join(" · ");
  if (context.parameterTool && full.startsWith(`${context.parameterTool}:`))
    return `${context.parameterTool} · ${full.includes("Preview checks result") ? "Preview → Accept" : "Apply to finish"}`;
  return full.split(" · ")[0];
}
/** Instructions reflect the actual viewport input handlers, not just the ribbon tab. */
export function activeToolGuidance(context: ToolGuidanceContext): string {
  if (context.busy)
    return "Processing · modeling input paused · use the active Cancel button to stop";
  if (context.interactiveAlignment)
    return `Left-drag a handle to move or rotate · ${navigation} · Escape cancels`;
  if (context.planePicking)
    return `Hover highlights plane · Left-click creates sketch · Hold left-click selects through · Escape cancels`;
  if (context.reference)
    return `Left-click picks ${context.reference === "plane" ? "planar reference" : "cylinder"} · Escape cancels picking`;
  if (context.landmarkSide)
    return context.landmarkPreview
      ? `Alignment preview · Choose moving/fixed picking to edit points · Apply accepts · Cancel discards`
      : `Left-click adds ${context.landmarkSide} landmark · Pick matching points on the other object`;
  if (context.sketchTool) {
    const instructions: Record<SketchDrawingTool, string> = {
      navigate: `Left/middle-drag orbits · Ctrl+drag pans · Shift+drag zooms`,
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
      : instructions[context.sketchTool];
  }
  if (context.previewAuthoring)
    return `Adjust ${context.previewAuthoring} settings in panel · Preview checks result · Apply accepts`;
  if (context.panel)
    return `Select ${context.panel === "components" ? "mesh component" : context.panel === "holes" ? "hole" : "boundary loop"} in panel`;
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
    return `${tools[tool]} · ${context.subtract ? "Subtract mode" : "Alt subtracts"}${context.selectThrough ? " · Select through enabled" : ""}${["brush", "freehand", "line"].includes(tool) ? " · Ctrl+wheel changes brush size" : ""}`;
  }
  if (context.mode === "measure")
    return `Left-click two surface points measures distance · Next click starts new measurement`;
  if (context.mode === "section")
    return `${context.sectionAxis ?? "Z"} section · ${context.sectionOffset ?? "0"} mm · Panel offset moves cutting plane`;
  if (context.parameterTool) {
    const actions = [
      "Reduce polygons",
      "Reduce noise",
      "Scale mesh",
      "Mirror mesh",
    ].includes(context.parameterTool)
      ? "Preview checks result · Accept completes"
      : "Apply completes";
    return `${context.parameterTool}: adjust settings in panel · ${actions}`;
  }
  return `Left-click selects · Hold left-click selects through · ${menu} · ${navigation}`;
}
