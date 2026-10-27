export interface RibbonVerification {
  status: "verified" | "unverified" | "planned";
  reason: string;
  evidence: string;
}

/** Deliberate allowlist: a registered handler or numerical unit test is insufficient. */
const verifiedWorkflows: Record<string, string> = {
  referencePlane:
    "tests/primitive-fitting-browser.mjs; tests/datum-construction-api.test.ts: named numeric plane GUI/MCP frame equality, edit/Cancel/history/reopen and detached sketch placement; native equivalence remains open",
  coordinateSystem:
    "tests/primitive-fitting-browser.mjs; tests/reference-datum.test.tsx: named coordinate frame GUI/MCP edit/history/reopen, visible axes/picking, XY/YZ/XZ sketch placement and current alignment references; native equivalence remains open",
  referenceAxis:
    "tests/reference-construction-browser.mjs: finite directed axis uses the same referenceLine/typed line geometry, GUI Apply, public MCP preview, history and project persistence; no infinite-axis claim",
  sketch2d:
    "tests/primitive-fitting-browser.mjs; tests/sketch-plane-source-api.test.ts: shared rigid sketch placement, original PLY plane frame, constraints, history and reopen; full native sketch equivalence remains open",
  fitPlane:
    "tests/primitive-fitting-browser.mjs: shared GUI/MCP analytic and original-PLY plane fit/materialization, history and persistence; native solver equivalence remains open",
  fitSphere:
    "tests/primitive-fitting-browser.mjs: shared analytic GUI/MCP fitting, actual CAD creation and project reopen; native solver equivalence remains open",
  fitCylinder:
    "tests/primitive-fitting-browser.mjs: shared analytic GUI/MCP fitting, actual CAD creation and project reopen; native solver equivalence remains open",
  fitCone:
    "tests/primitive-fitting-browser.mjs: shared analytic GUI/MCP fitting, actual CAD creation and project reopen; native solver equivalence remains open",
  referencePoint:
    "tests/reference-construction-browser.mjs: numeric point and single stored-line midpoint GUI/MCP Preview, Apply, Cancel, dependent refresh, history and reopen; other derived modes and native equivalence remain open",
  referenceLine:
    "tests/reference-construction-browser.mjs: typed finite line GUI/MCP Preview, Apply, Cancel and project reopen only",
  sketchFromSection:
    "docs/AGENT_GUIDE.md: scan section references; tests/create-sketch-dialog.test.tsx and automation section original-slot parity; GUI/MCP section workflow",
  globalFineAlign:
    "docs/NATIVE_SEEDED_GLOBAL_ALIGNMENT.md: verified raw mesh numerical route; shared GUI/MCP Preview, cached Apply and Cancel",
  alignInteractive:
    "docs/NATIVE_INTERACTIVE_ALIGNMENT.md: public GUI/MCP pose preview, native owner-scan bounds, mirror, Apply, Cancel and Undo",
  align:
    "docs/NATIVE_DATUM_ALIGNMENT.md: reference-based coordinate alignment, native owner-scan Apply and GUI/MCP Preview/Apply parity",
  alignNPoints:
    "docs/NATIVE_ALIGNMENT.md: ordinary point-pair command admission, native registration/refinement, source-only sessions, real mesh/cloud canvas picking and shared GUI/MCP preview/reset/accept",
  fineAlign:
    "docs/NATIVE_ALIGNMENT_TARGET_GROUPS.md: indexed surface refinement; GUI/shared MCP parity and native owner-scan captures",
  reducePolygons:
    "docs/SCAN_DATA_TOOLS.md: reduction targets and geometry validation",
  reduceNoise:
    "docs/SCAN_DATA_TOOLS.md: bounded smoothing and selection isolation",
  scaleMesh: "docs/SCAN_DATA_TOOLS.md: scale and undo workflow",
  flipNormals:
    "docs/NATIVE_FLIP_NORMALS.md: original facet loop and direct execution",
  shrinkwrap:
    "docs/SHRINKWRAP.md: shared reconstruction, local seams and preview",
  repolygonize: "docs/SCAN_DATA_TOOLS.md: voxel reconstruction and limits",
  averageMesh: "docs/SCAN_DATA_TOOLS.md: nearest surface averaging workflow",
  mirrorMesh: "docs/SCAN_DATA_TOOLS.md: origin and object reference planes",
  unroll: "docs/SCAN_DATA_TOOLS.md: cylinder reference and seam handling",
  splitMesh:
    "docs/AGENT_GUIDE.md: dedicated Split mesh; tests/scan-edit.test.ts: plane and convex mesh splitting",
  editScan: "docs/SCAN_DATA_MVP.md; docs/VALIDATION.md: Scan Data edit MVP",
  newDocument: "docs/VALIDATION.md: New document and colored command icons",
  open: "docs/VALIDATION.md: browser scan import and file validation",
  save: "docs/VALIDATION.md: browser project save/reopen",
  undo: "docs/VALIDATION.md: browser edit undo/redo and geometry restoration",
  redo: "docs/VALIDATION.md: browser edit undo/redo and geometry restoration",
  fitView: "docs/VALIDATION.md: browser camera controls and auto-fit",
  iso: "docs/VALIDATION.md: browser camera controls",
  top: "docs/VALIDATION.md: browser standard views",
  bottom: "docs/VALIDATION.md: browser standard views",
  left: "docs/VALIDATION.md: browser standard views",
  right: "docs/VALIDATION.md: browser standard views",
  front: "docs/VALIDATION.md: browser standard views",
  back: "docs/VALIDATION.md: browser standard views",
  wireframe: "docs/VALIDATION.md: browser shading controls",
  objectColor: "docs/VALIDATION.md: browser appearance controls",
  autoColorize:
    "docs/AGENT_GUIDE.md: scene auto colors; tests/auto-color-api.test.ts and isolated GUI/MCP color assignment validation",
  settings: "docs/VALIDATION.md: browser light/dark appearance controls",
  delete: "docs/VALIDATION.md: browser deletion and undo with live scan counts",
  exportStep:
    "tests/kernel-smoke.mjs; docs/VALIDATION.md: browser STEP download",
  exportStl: "docs/VALIDATION.md: browser visible-mesh STL export",
};

export function ribbonVerification(
  id: string,
  implemented: boolean,
): RibbonVerification {
  if (implemented && Object.hasOwn(verifiedWorkflows, id))
    return {
      status: "verified",
      reason: "Verified workflow",
      evidence: verifiedWorkflows[id],
    };
  return implemented
    ? {
        status: "unverified",
        reason:
          "In progress — complete workflow and reference options not fully verified",
        evidence: "docs/CAPABILITIES.md; docs/FEATURE_EVIDENCE.md",
      }
    : {
        status: "planned",
        reason: "Planned — not implemented yet",
        evidence: "docs/RIBBON_STATUS.md",
      };
}
