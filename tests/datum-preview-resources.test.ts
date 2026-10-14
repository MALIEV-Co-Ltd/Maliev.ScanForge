import { expect, it, vi } from "vitest";
import {
  adoptDatumPreview,
  releaseDatumPreview,
} from "../src/automation/datum-preview-resources";
import type { WorkspaceHost } from "../src/automation/api";
it("shares in-flight release and retains ownership for retry after a synchronous failure", async () => {
  const release = vi.fn((_ids: string[]): Promise<void> => {
    throw new Error("worker unavailable");
  });
  const host = { cad: () => ({ release }) } as unknown as WorkspaceHost;
  await adoptDatumPreview(host, ["temporary"]);
  await expect(releaseDatumPreview(host)).rejects.toThrow("worker unavailable");
  let finish!: () => void;
  release.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = releaseDatumPreview(host),
    second = releaseDatumPreview(host);
  await Promise.resolve();
  expect(release).toHaveBeenCalledTimes(2);
  finish();
  await Promise.all([first, second]);
  await releaseDatumPreview(host);
  expect(release).toHaveBeenCalledTimes(2);
});
