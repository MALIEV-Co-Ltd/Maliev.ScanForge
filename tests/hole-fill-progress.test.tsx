import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { runScanEdit } from "../src/scan-edit";
import { PointerJobStatus } from "../src/ui/PointerJobStatus";
import {
  createHoleFillReporter,
  type HoleFillProgress,
} from "../src/hole-fill-progress";

it("limits visible updates to five per second and publishes phase changes immediately", () => {
  let time = 0;
  const events: {
    fraction: number;
    stage: string;
    details?: HoleFillProgress;
  }[] = [];
  const report = createHoleFillReporter(
    (fraction, stage, details) => events.push({ fraction, stage, details }),
    () => time,
  );
  report(1, "Topology ready");
  expect(events.at(-1)).toMatchObject({
    fraction: 0,
    stage: "Preparing holes…",
  });
  const details: HoleFillProgress = {
    kind: "holeFill",
    phase: "closing",
    processed: 0,
    total: 10,
    closed: 0,
    skipped: 0,
  };
  report(0, "Triangulating selected holes", details);
  for (time = 1; time < 200; time++)
    report(0.9, "Blending hole surface", details);
  expect(events).toHaveLength(2);
  report(0.9, "Constraining hole triangulation", {
    ...details,
    processed: 3,
    closed: 2,
    skipped: 1,
  });
  expect(events.at(-1)).toMatchObject({
    fraction: 0.3,
    stage: "Closing holes",
  });
  report(1, "Finalizing", {
    ...details,
    phase: "finalizing",
    processed: 10,
    closed: 9,
    skipped: 1,
  });
  expect(events.at(-1)?.stage).toBe("Finalizing mesh…");
  expect(events).toHaveLength(4);
});

// Three separate open tetrahedra; the middle hole exceeds the diameter limit.
const positions = Float32Array.from(
  [1, 3, 1].flatMap((size, index) => {
    const x = index * 10;
    const points = [
      [x, 0, 0],
      [x + size, 0, 0],
      [x, size, 0],
      [x, 0, size],
    ];
    return [
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ].flatMap((face) => face.flatMap((i) => points[i]));
  }),
);

it("counts unique processed holes including skips and keeps nested progress monotonic", () => {
  const events: {
    fraction: number;
    stage: string;
    details?: Record<string, unknown>;
  }[] = [];
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "fillHoles",
      algorithm: "flat",
      positions,
      indices: [0, 1, 1, 2],
      diameter: 2,
    },
    {
      topologyCache: {},
      onProgress: (
        fraction: number,
        stage: string,
        details?: Record<string, unknown>,
      ) => {
        if (details) events.push({ fraction, stage, details });
      },
    },
  );
  expect(result.diagnostics).toMatchObject({ filledHoles: 2, skippedHoles: 1 });
  expect(events[0]?.details).toMatchObject({
    kind: "holeFill",
    processed: 0,
    total: 3,
    closed: 0,
    skipped: 0,
  });
  expect(events.map((event) => event.details?.processed)).toContain(2);
  expect(
    events.some(
      (event) => event.details?.processed === 2 && event.details?.skipped === 1,
    ),
  ).toBe(true);
  expect(events.at(-1)?.details).toMatchObject({
    phase: "complete",
    processed: 3,
    total: 3,
    closed: 2,
    skipped: 1,
  });
  expect(events.some((event) => event.stage === "Finalizing mesh…")).toBe(true);
  expect(
    events.every(
      (event, index) => !index || event.fraction >= events[index - 1].fraction,
    ),
  ).toBe(true);
});

it("cancels a batch without publishing a successful completion", () => {
  const controller = new AbortController();
  const phases: unknown[] = [];
  expect(() =>
    runScanEdit(
      { kind: "scanEdit", action: "fillHoles", algorithm: "flat", positions },
      {
        signal: controller.signal,
        onProgress: (
          _fraction: number,
          _stage: string,
          details?: Record<string, unknown>,
        ) => {
          if (!details) return;
          phases.push(details.phase);
          if (details.processed === 1) controller.abort();
        },
      },
    ),
  ).toThrow(/cancelled/i);
  expect(phases).not.toContain("complete");
});

it("renders stable batch counts, a determinate bar and separate outcome counts", () => {
  const props = {
    message: "Constraining hole triangulation · 25%",
    progressDetails: {
      kind: "holeFill" as const,
      phase: "closing" as const,
      processed: 38,
      total: 1796,
      closed: 36,
      skipped: 2,
    },
  };
  const html = renderToStaticMarkup(<PointerJobStatus {...props} />);
  expect(html).toContain("Closing holes");
  expect(html).toContain("38 / 1,796 processed");
  expect(html).toContain("36 closed · 2 skipped");
  expect(html).toContain('aria-valuenow="38"');
  expect(html).toContain('aria-valuemax="1796"');
  expect(html).not.toContain("Constraining");
});
