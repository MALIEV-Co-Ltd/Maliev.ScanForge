import type { ApplicationApi } from "../automation/api";
/** GUI calls the same guarded, cancellable API job as an MCP client. */
export async function runShrinkwrapPreviewCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  args: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number, stage: string) => void;
  } = {},
) {
  options.signal?.throwIfAborted();
  const receipt = await api.invoke("scan_preview", {
    ...args,
    expectedRevision: api.currentRevision(),
    requestId: crypto.randomUUID(),
  });
  if (!receipt.ok) throw Error(receipt.error.message);
  const { jobId } = receipt.result as { jobId: string };
  const cancel = () => {
    void api.invoke("job_cancel", { jobId });
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      const response = await api.invoke("job_get", { jobId });
      if (!response.ok) throw Error(response.error.message);
      const job = response.result as {
        status: string;
        result?: Record<string, unknown>;
        progress: number;
        stage: string;
        error?: { message: string };
      };
      options.onProgress?.(job.progress, job.stage);
      if (job.status === "succeeded") return job.result ?? {};
      if (job.status !== "running")
        throw Error(job.error?.message ?? "ShrinkWrap operation cancelled.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    cancel();
    throw Error(
      "ShrinkWrap reached its operation lease; retry with a smaller region.",
    );
  } finally {
    if (options.signal?.aborted) cancel();
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Accept commits intentionally replace source positions. Other source changes cancel work. */
export function cancelScanToolOnSourceChange(
  controller: AbortController | null,
  accepting: boolean,
) {
  if (!accepting) controller?.abort();
}

/** Cancel the single shared application job even when an MCP client owns its controller. */
export function cancelShrinkwrapOperation(
  api: Pick<ApplicationApi, "cancelActive" | "discardScanPreview">,
  controller: AbortController | null,
) {
  controller?.abort();
  api.cancelActive();
  api.discardScanPreview();
}
