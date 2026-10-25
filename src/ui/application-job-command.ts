import type { ApplicationApi } from "../automation/api";

export interface ApplicationJobOptions {
  signal?: AbortSignal;
  readOnly?: boolean;
  expectedRevision?: number;
  onProgress?: (fraction: number, stage: string) => void;
}

/** GUI adapters submit once and observe the shared application job. */
export async function runApplicationJobCommand(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  command: string,
  args: Record<string, unknown>,
  options: ApplicationJobOptions & {
    cancelledMessage: string;
    leaseMessage: string;
  },
) {
  options.signal?.throwIfAborted();
  const receipt = await api.invoke(command, {
    ...args,
    ...(!options.readOnly
      ? {
          expectedRevision: options.expectedRevision ?? api.currentRevision(),
          requestId: crypto.randomUUID(),
        }
      : {}),
  });
  if (!receipt.ok) throw Error(receipt.error.message);
  const { jobId } = receipt.result as { jobId: string };
  let cancelled = false;
  let completed = false;
  const cancel = () => {
    if (cancelled || completed) return;
    cancelled = true;
    // Cancellation is best effort; retain the original abort/lease error.
    void Promise.resolve()
      .then(() => api.invoke("job_cancel", { jobId }))
      .catch(() => {});
  };
  let rejectStop!: (error: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const abort = () => {
    cancel();
    rejectStop(
      options.signal?.reason ?? new DOMException("Aborted", "AbortError"),
    );
  };
  const lease = setTimeout(() => {
    cancel();
    rejectStop(Error(options.leaseMessage));
  }, 15 * 60_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const response = await Promise.race([
        api.invoke("job_get", { jobId }),
        stopped,
      ]);
      if (!response.ok) throw Error(response.error.message);
      const job = response.result as {
        status: string;
        result?: Record<string, unknown>;
        progress: number;
        stage: string;
        error?: { message: string };
      };
      completed = job.status !== "running";
      options.onProgress?.(job.progress, job.stage);
      if (job.status === "succeeded") return job.result ?? {};
      if (job.status !== "running")
        throw Error(job.error?.message ?? options.cancelledMessage);
      options.signal?.throwIfAborted();
      await Promise.race([
        new Promise<void>((resolve) => {
          pollTimer = setTimeout(resolve, 100);
        }),
        stopped,
      ]);
    }
  } finally {
    clearTimeout(lease);
    clearTimeout(pollTimer);
    if (!completed) cancel();
    options.signal?.removeEventListener("abort", abort);
  }
}
