import { runApplicationJobCommand } from "./application-job-command";
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
  return runApplicationJobCommand(api, "scan_preview", args, {
    ...options,
    cancelledMessage: "Mesh preview operation cancelled.",
    leaseMessage:
      "Mesh preview reached its operation lease; retry with a smaller region.",
  });
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
