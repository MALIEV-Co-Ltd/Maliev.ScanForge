export interface RibbonVerification {
  status: "verified" | "unverified" | "planned";
  reason: string;
  evidence: string;
}

/** Deliberate allowlist: a registered handler or numerical unit test is insufficient. */
const verifiedWorkflows: Record<string, string> = {
  reducePolygons:
    "docs/SCAN_DATA_TOOLS.md: reduction targets and geometry validation",
  reduceNoise:
    "docs/SCAN_DATA_TOOLS.md: bounded smoothing and selection isolation",
  scaleMesh: "docs/SCAN_DATA_TOOLS.md: scale and undo workflow",
  flipNormals: "docs/SCAN_DATA_TOOLS.md: normal winding and undo workflow",
  repolygonize: "docs/SCAN_DATA_TOOLS.md: voxel reconstruction and limits",
  averageMesh: "docs/SCAN_DATA_TOOLS.md: nearest surface averaging workflow",
  mirrorMesh: "docs/SCAN_DATA_TOOLS.md: origin and object reference planes",
  unroll: "docs/SCAN_DATA_TOOLS.md: cylinder reference and seam handling",
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
