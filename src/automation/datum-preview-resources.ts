import type { WorkspaceHost } from "./api";
const previews = new WeakMap<
  WorkspaceHost,
  { handles: string[]; releasing?: Promise<void> }
>();
export async function releaseDatumPreview(host: WorkspaceHost) {
  const lease = previews.get(host);
  if (!lease) return;
  if (!lease.releasing)
    lease.releasing = Promise.resolve().then(async () => {
      try {
        await host.cad().release(lease.handles);
        if (previews.get(host) === lease) previews.delete(host);
      } catch (error) {
        lease.releasing = undefined;
        throw error;
      }
    });
  await lease.releasing;
}
export async function adoptDatumPreview(
  host: WorkspaceHost,
  handles: string[],
) {
  await releaseDatumPreview(host);
  if (handles.length) previews.set(host, { handles: [...handles] });
}
