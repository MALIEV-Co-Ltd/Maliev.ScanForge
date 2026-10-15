import type { ApplicationApi } from "./api";
/** Dialog controls and canvas handles use the same versioned API that MCP invokes. */
export function createInteractiveEditor(
  api: Pick<ApplicationApi, "invoke" | "currentRevision">,
  read: () => { sessionId: string; version: number } | null,
) {
  const reference = () => {
    const state = read();
    if (!state) throw new Error("Begin Interactive alignment first.");
    return {
      sessionId: state.sessionId,
      expectedSessionVersion: state.version,
    };
  };
  const invoke = async (command: string, args: Record<string, unknown>) => {
    const response = await api.invoke(command, {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
    if (!response.ok) throw new Error(response.error.message);
    return response.result as Record<string, unknown>;
  };
  return {
    edit: async (edit: Record<string, unknown>) =>
      invoke("interactive_alignment_edit", {
        ...edit,
        ...(edit.action === "begin" ? {} : reference()),
      }),
    cancel: () => invoke("preview_discard", { target: "interactive" }),
    apply: async () => {
      const receipt = await invoke("interactive_alignment_apply", {
        ...reference(),
        parallel: true,
      });
      if (typeof receipt.jobId !== "string")
        throw new Error("Interactive Apply did not return a job receipt.");
      const expires = Date.now() + 910000;
      while (Date.now() < expires) {
        const response = await api.invoke("job_get", { jobId: receipt.jobId });
        if (!response.ok) throw new Error(response.error.message);
        const job = response.result as {
          status: string;
          result?: Record<string, unknown>;
          error?: { message: string };
        };
        if (job.status === "succeeded") return job.result ?? {};
        if (job.status === "cancelled") return { cancelled: true };
        if (job.status !== "running")
          throw new Error(job.error?.message ?? "Interactive Apply failed.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await api.invoke("job_cancel", { jobId: receipt.jobId });
      throw new Error("Interactive Apply exceeded its time limit.");
    },
  };
}
