/** Wait for a real draw and a following paint opportunity; own and bound both RAFs. */
export function presentFrame(
  render: () => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("Presentation cancelled", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    const cleanup = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(lease);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Presentation cancelled", "AbortError"));
    };
    const lease = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Waiting for the viewport to render. Keep this tab visible and retry.",
        ),
      );
    }, 30_000);
    signal?.addEventListener("abort", abort, { once: true });
    frame = requestAnimationFrame(() => {
      try {
        render();
        frame = requestAnimationFrame(() => {
          cleanup();
          resolve();
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });
}
