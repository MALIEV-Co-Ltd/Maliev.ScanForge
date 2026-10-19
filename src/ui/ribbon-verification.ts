export interface RibbonVerification {
  status: "verified" | "unverified" | "planned";
  reason: string;
  evidence: string;
}

/** Deliberate allowlist: a registered handler or numerical unit test is insufficient. */
const verifiedWorkflows: Record<string, string> = {
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
