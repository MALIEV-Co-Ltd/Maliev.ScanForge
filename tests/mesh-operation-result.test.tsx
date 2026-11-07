import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeshOperationResult } from "../src/ui/MeshOperationResult";
import type { FineAlignmentResult } from "../src/fine-registration";
import type { ProcessingResult } from "../src/processing-client";

const registration: FineAlignmentResult = {
  transform: { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] },
  rms: 1.2401,
  maxError: 5.550861198503609,
  pairs: 140113,
  iterations: 28,
  converged: true,
  targetRmsBasis: "overlap",
  overlapPercent: 85,
  sampleSize: 20000,
  fittingSamples: 20000,
  overlapRms: 0.925345,
  wholeCloudRms: 1.2401,
  overlapPoints: 119097,
  requiredOverlapPoints: 119097,
  overlapSatisfied: true,
  targetRms: 0.5,
  targetReached: false,
  terminationReason: "stoppedImproving",
  matching: "fullTargetPointToPoint",
  normalCompatibility: false,
  rejectedNormalPoints: 0,
  applied: true,
  evaluatedPoints: 140113,
  targetPoints: 140113,
  distanceTests: 500000,
  rejectedPoints: 0,
  overlapFraction: 1,
  inlierRms: 0.925345,
  inlierPairs: 119097,
};
const render = (patch: Partial<FineAlignmentResult> = {}) =>
  renderToStaticMarkup(
    <MeshOperationResult
      result={{
        kind: "icp",
        registration: { ...registration, ...patch },
        diagnostics: {
          iterations: 28,
          maxError: registration.maxError,
          rejectedPoints: 0,
        },
      }}
    />,
  );
it("distinguishes a converged plateau from reaching target accuracy", () => {
  const html = render();
  expect(html).toContain("Target not reached");
  expect(html).toContain("Stopped improving");
  expect(html).toContain("Alignment applied");
  expect(html).toContain('data-tone="warning"');
  expect(html).not.toContain('data-tone="success"');
  expect(html).toContain('aria-label="Alignment accuracy"');
  expect(html).toContain('title="0.925345"');
  expect(html).toContain("119,097");
  expect(html).toContain("<summary>Diagnostics</summary>");
  expect(html).not.toContain("<details open");
  expect(html).toContain('title="5.550861198503609"');
});
it("keeps successful partial overlap separate from whole-cloud error", () => {
  const html = render({
    targetReached: true,
    terminationReason: "targetReached",
    overlapRms: 0.001,
    wholeCloudRms: 70.7,
  });
  expect(html).toContain('data-tone="success"');
  expect(html).toContain("Target reached");
  expect(html).toContain("Whole-cloud RMS");
  expect(html).toContain("70.70");
});
it("shows unavailable overlap and unchanged geometry without a false zero or success", () => {
  const html = render({
    overlapRms: null,
    overlapSatisfied: false,
    applied: false,
    targetReached: false,
    terminationReason: "insufficientOverlap",
  });
  expect(html).toContain("Alignment not applied");
  expect(html).toContain("Unavailable");
  expect(html).toContain("Geometry unchanged; no history entry created.");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("Alignment applied");
});
it("retains non-registration diagnostics with semantic label/value rows", () => {
  const result: ProcessingResult = {
    kind: "smooth",
    diagnostics: {
      iterations: 3,
      sampleCount: 10000,
      accepted: true,
      reason: "Preserved original boundaries",
      pointCloudPose: "internal",
      localBuffersRetained: true,
    },
  };
  const html = renderToStaticMarkup(<MeshOperationResult result={result} />);
  expect(html).toContain("Operation result");
  expect(html).toContain("Sample Count");
  expect(html).toContain("10,000");
  expect(html).toContain("Preserved original boundaries");
  expect(html).not.toContain("internal");
  expect(html).not.toContain("Local Buffers");
});
it("retains topology, classification and repaired-sheet information", () => {
  const topology = {
    vertices: 3,
    triangles: 1,
    components: 1,
    boundaryLoops: 1,
    boundaryChains: 0,
    boundaryEdges: 3,
    nonManifoldEdges: 0,
    nonManifoldVertices: 0,
    inconsistentEdges: 0,
    degenerateTriangles: 0,
    duplicateTriangles: 0,
  };
  const html = renderToStaticMarkup(
    <MeshOperationResult
      result={{
        kind: "repair",
        diagnostics: {},
        topology,
        segmentClassifications: [
          {
            kind: "plane",
            samples: 3,
            extent: [1, 1, 0],
            tolerance: 0.05,
            rms: 0.001,
            maxError: 0.002,
            reason: "Planar fit accepted",
          },
        ],
        repairSheets: [{ ...topology, watertight: false }],
      }}
    />,
  );
  expect(html).toContain('aria-label="Topology"');
  expect(html).toContain("<dt>Boundary Edges</dt><dd>3</dd>");
  expect(html).toContain("Regions · 1");
  expect(html).toContain("Planar fit accepted");
  expect(html).toContain("Maximum residual");
  expect(html).toContain("Open boundary");
  expect(html).toContain("Nonmanifold vertices");
});
