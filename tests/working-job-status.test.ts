import { expect, it, vi } from "vitest";
import {
  beginWorkingJob,
  getWorkingJobStatus,
  watchWorkingJobStatus,
} from "../src/working-job-status";

it("keeps the current job's progress until it finishes without stale concurrent cleanup", () => {
  const changed = vi.fn(),
    unwatch = watchWorkingJobStatus(changed);
  const first = beginWorkingJob("Inspect mesh"),
    second = beginWorkingJob("Defeature");
  try {
    expect(getWorkingJobStatus()).toBe("Defeature…");
    second.progress(0.65, "Reconstructing surface");
    expect(getWorkingJobStatus()).toBe("Reconstructing surface · 65%");
    first.finish();
    expect(getWorkingJobStatus()).toBe("Reconstructing surface · 65%");
    second.finish();
    second.progress(0.9, "Late event");
    expect(getWorkingJobStatus()).toBe("");
    expect(changed).toHaveBeenCalled();
  } finally {
    first.finish();
    second.finish();
    unwatch();
  }
});
