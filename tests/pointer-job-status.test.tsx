import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PointerJobStatus,
  positionJobStatus,
  trackJobPointer,
} from "../src/ui/PointerJobStatus";

it("places working status behind the pointer and flips at window edges", () => {
  expect(
    positionJobStatus(
      { x: 100, y: 80 },
      { width: 140, height: 24 },
      { width: 800, height: 600 },
    ),
  ).toEqual({ x: 116, y: 104 });
  expect(
    positionJobStatus(
      { x: 790, y: 590 },
      { width: 140, height: 24 },
      { width: 800, height: 600 },
    ),
  ).toEqual({ x: 634, y: 554 });
  const tiny = positionJobStatus(
    { x: 0, y: 0 },
    { width: 140, height: 24 },
    { width: 100, height: 40 },
  );
  expect(tiny.x).toBe(8);
  expect(tiny.y).toBe(8);
});

it("releases shared pointer listeners when their last owner unmounts", () => {
  const addEventListener = vi.fn(),
    removeEventListener = vi.fn();
  vi.stubGlobal("window", { addEventListener, removeEventListener });
  try {
    const stopBar = trackJobPointer(),
      stopLabel = trackJobPointer();
    expect(addEventListener.mock.calls.map(([name]) => name)).toEqual([
      "pointermove",
      "pointerdown",
      "pointerout",
      "blur",
    ]);
    stopLabel();
    expect(removeEventListener).not.toHaveBeenCalled();
    stopBar();
    expect(removeEventListener.mock.calls.map(([name]) => name)).toEqual([
      "pointermove",
      "pointerdown",
      "pointerout",
      "blur",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("exposes the working text as an observable accessible status and hides idle text", () => {
  const html = renderToStaticMarkup(
    <PointerJobStatus message="Building topology · 65%" />,
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('class="pointer-job-status"');
  expect(html).toContain("Building topology");
  expect(html).not.toContain("65%</");
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="65"');
  expect(html).toContain("width:65%");
  expect(renderToStaticMarkup(<PointerJobStatus message="" />)).toBe("");
});

it("keeps unknown progress quiet and exposes a labelled indeterminate bar", () => {
  const html = renderToStaticMarkup(
    <PointerJobStatus message="Preparing mesh…" />,
  );
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-label="Preparing mesh…"');
  expect(html).not.toContain("aria-valuenow");
  expect(html).toContain('data-indeterminate="true"');
});

it("clamps progress and preserves percentages inside phase descriptions", () => {
  const html = renderToStaticMarkup(
    <PointerJobStatus message="Reducing to 50% · 120%" />,
  );
  expect(html).toContain("Reducing to 50%");
  expect(html).not.toContain("120%");
  expect(html).toContain('aria-valuenow="100"');
});

it("shows one named progress bar per active import plus queue counts", () => {
  const html = renderToStaticMarkup(
    <PointerJobStatus
      message="Importing files"
      progressDetails={{
        kind: "importBatch",
        files: [
          {
            index: 0,
            name: "first.stl",
            status: "importing",
            fraction: 0.25,
            stage: "Reading",
          },
          {
            index: 1,
            name: "second.ply",
            status: "importing",
            fraction: 0.6,
            stage: "Preparing",
          },
          {
            index: 2,
            name: "queued.obj",
            status: "queued",
            fraction: 0,
            stage: "Queued",
          },
        ],
      }}
    />,
  );
  expect(html.match(/role="progressbar"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="first.stl"');
  expect(html).toContain('aria-valuenow="25"');
  expect(html).toContain('aria-label="second.ply"');
  expect(html).toContain('aria-valuenow="60"');
  expect(html).toContain("1 queued");
});
