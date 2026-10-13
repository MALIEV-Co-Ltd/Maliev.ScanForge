/** Browser-local visual inspection. No screen-sharing permission or remote service. */
export interface VisualCaptureOptions {
  scope?: "application" | "viewport";
  format?: "png" | "jpeg";
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}
export interface VisualCaptureHost {
  applicationRoot: HTMLElement;
  viewportRoot: HTMLElement;
  /** Render and serialize in the same synchronous call, before WebGL clears. */
  renderViewport(): { canvas: HTMLCanvasElement; dataUrl: string };
}
export interface CapturedImage {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  scope: "application" | "viewport";
  capturedAt: string;
  sourceWidth: number;
  sourceHeight: number;
  redacted: "password-and-agent-token-inputs";
  renderer: "browser-dom-with-current-viewport";
}
export class VisualCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const CAPTURE_LIMITS = {
  maxDimension: 2048,
  maxBytes: 1048576,
  maxSourcePixels: 16777216,
  timeoutMs: 10000,
} as const;
export interface CaptureRenderOptions {
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
  skipFonts: boolean;
  cacheBust: boolean;
  fetchRequestInit: RequestInit;
  filter(node: HTMLElement): boolean;
}
export type DomRenderer = (
  root: HTMLElement,
  options: CaptureRenderOptions,
) => Promise<HTMLCanvasElement>;
const failure = (code: string, message: string): never => {
  throw new VisualCaptureError(code, message);
};

/** Password inputs and explicitly sensitive controls never enter serialized SVG. */
export function includeCaptureNode(node: HTMLElement): boolean {
  if (node.nodeType !== 1) return true;
  return !node.matches(
    '[data-agent-private], input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[name*="token" i], input[id*="token" i], input[aria-label*="token" i]',
  );
}
function included(node: Element, root: HTMLElement): boolean {
  for (
    let current: Element | null = node;
    current;
    current = current.parentElement
  ) {
    if (!includeCaptureNode(current as HTMLElement)) return false;
    if (current === root) return true;
  }
  return false;
}
function validateAsset(source: string, base: string): void {
  if (!source || source.startsWith("#")) return;
  let url: URL;
  try {
    url = new URL(source, base);
  } catch {
    failure(
      "CAPTURE_UNSUPPORTED_ASSET",
      "The captured UI contains an invalid asset URL.",
    );
  }
  const origin = new URL(base).origin;
  if (url!.protocol === "data:") return;
  if (url!.protocol === "blob:" && url!.origin === origin) return;
  if (
    (url!.protocol === "http:" || url!.protocol === "https:") &&
    url!.origin === origin
  )
    return;
  failure(
    "CAPTURE_UNSUPPORTED_ASSET",
    "Capture only supports same-origin, data, and local blob assets; external assets are not fetched.",
  );
}
function checkLocalAssets(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (!view)
    failure("CAPTURE_UNAVAILABLE", "Capture requires a live browser document.");
  for (const node of [root, ...root.querySelectorAll("*")]) {
    if (!included(node, root)) continue;
    if (view!.getComputedStyle(node).display === "none") continue;
    if (node.matches("iframe,video,object,embed"))
      failure(
        "CAPTURE_UNSUPPORTED_ASSET",
        "Embedded documents and video cannot be captured reliably.",
      );
    for (const attribute of ["src", "poster", "href", "xlink:href"]) {
      // Navigation links are not fetched by the DOM renderer.
      if (attribute === "href" && node.tagName.toLowerCase() === "a") continue;
      const value = node.getAttribute(attribute);
      if (value) validateAsset(value, root.ownerDocument.baseURI);
    }
    if (node.matches("img") && node.getAttribute("srcset"))
      failure(
        "CAPTURE_UNSUPPORTED_ASSET",
        "Responsive image sources require a single local source for capture.",
      );
    for (const pseudo of [null, "::before", "::after"]) {
      const style = view!.getComputedStyle(node, pseudo);
      for (let i = 0; i < style.length; i++) {
        const value = style.getPropertyValue(style.item(i));
        for (const match of value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
          validateAsset(match[1].trim(), root.ownerDocument.baseURI);
      }
    }
  }
}
function decodeImage(
  dataUrl: string,
  mime: string,
  maxBytes: number = CAPTURE_LIMITS.maxBytes,
): { data: string; bytes: number } {
  const prefix = `data:${mime};base64,`;
  if (!dataUrl.startsWith(prefix))
    failure(
      "CAPTURE_FAILED",
      "The browser could not encode the requested image format.",
    );
  const data = dataUrl.slice(prefix.length);
  if (
    !data ||
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    failure(
      "CAPTURE_TOO_LARGE",
      `Capture exceeds its ${maxBytes / 1048576} MiB image limit; request smaller dimensions or JPEG.`,
    );
  let decoded: string;
  try {
    decoded = atob(data);
  } catch {
    failure(
      "CAPTURE_FAILED",
      "The browser returned an invalid image encoding.",
    );
  }
  const png = decoded!.startsWith("\x89PNG\r\n\x1a\n");
  const jpeg = decoded!.startsWith("\xff\xd8\xff");
  if ((mime === "image/png" && !png) || (mime === "image/jpeg" && !jpeg))
    failure("CAPTURE_FAILED", "The browser returned invalid image content.");
  if (decoded!.length > maxBytes)
    failure("CAPTURE_TOO_LARGE", "Capture exceeds its image memory limit.");
  return { data, bytes: decoded!.length };
}
const defaultRenderer: DomRenderer = async (root, options) => {
  const { toCanvas } = await import("html-to-image");
  return toCanvas(root, options);
};
const activeViewports = new WeakSet<HTMLElement>();

/** The returned image represents current application pixels, never a saved thumbnail. */
export async function captureApplicationImage(
  host: VisualCaptureHost,
  options: VisualCaptureOptions = {},
  signal?: AbortSignal,
  render: DomRenderer = defaultRenderer,
): Promise<CapturedImage> {
  const scope = options.scope ?? "application";
  const format = options.format ?? "png";
  if (
    !["application", "viewport"].includes(scope) ||
    !["png", "jpeg"].includes(format)
  )
    failure("INVALID_ARGUMENT", "Unsupported screenshot scope or format.");
  const maxWidth = options.maxWidth ?? 1440;
  const maxHeight = options.maxHeight ?? 1080;
  for (const value of [maxWidth, maxHeight])
    if (
      !Number.isInteger(value) ||
      value < 64 ||
      value > CAPTURE_LIMITS.maxDimension
    )
      failure(
        "INVALID_ARGUMENT",
        "Screenshot bounds must be integers from 64 to 2048.",
      );
  const quality = options.quality ?? 0.85;
  if (!Number.isFinite(quality) || quality < 0.1 || quality > 1)
    failure("INVALID_ARGUMENT", "JPEG quality must be from 0.1 to 1.");
  if (signal?.aborted) failure("CANCELLED", "Screenshot was cancelled.");
  if (activeViewports.has(host.viewportRoot))
    failure(
      "CAPTURE_BUSY",
      "Another screenshot is capturing this viewport; retry after it completes.",
    );
  const root =
    scope === "application" ? host.applicationRoot : host.viewportRoot;
  if (!root.isConnected || !includeCaptureNode(root))
    failure(
      "CAPTURE_UNAVAILABLE",
      "The requested capture surface is unavailable.",
    );
  const rect = root.getBoundingClientRect();
  const sourceWidth = Math.ceil(rect.width);
  const sourceHeight = Math.ceil(rect.height);
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    !Number.isFinite(sourceWidth * sourceHeight)
  )
    failure(
      "CAPTURE_UNAVAILABLE",
      "The requested capture surface has no visible dimensions.",
    );
  if (sourceWidth * sourceHeight > CAPTURE_LIMITS.maxSourcePixels)
    failure(
      "CAPTURE_TOO_LARGE",
      "The source application surface exceeds the 16 megapixel capture limit.",
    );
  checkLocalAssets(root);
  const ratio = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: ((reason: unknown) => void) | undefined;
  const cancel = () => {
    abort.abort();
    rejectDeadline?.(
      new VisualCaptureError("CANCELLED", "Screenshot was cancelled."),
    );
  };
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      abort.abort();
      reject(
        new VisualCaptureError(
          "CAPTURE_TIMEOUT",
          "Screenshot capture exceeded its 10 second deadline.",
        ),
      );
    }, CAPTURE_LIMITS.timeoutMs);
  });
  signal?.addEventListener("abort", cancel, { once: true });
  activeViewports.add(host.viewportRoot);
  let restore: (() => void) | undefined;
  try {
    // Freeze only this renderer's canvas serialization, preserving its real WebGL context.
    const frame = host.renderViewport();
    if (signal?.aborted) failure("CANCELLED", "Screenshot was cancelled.");
    if (
      !host.viewportRoot.contains(frame.canvas) ||
      !root.contains(frame.canvas)
    )
      failure(
        "CAPTURE_UNAVAILABLE",
        "The current viewport canvas is outside the capture surface.",
      );
    // The frozen source may exceed the final transfer size before downscaling.
    decodeImage(frame.dataUrl, "image/png", 8388608);
    const original = Object.getOwnPropertyDescriptor(frame.canvas, "toDataURL");
    Object.defineProperty(frame.canvas, "toDataURL", {
      configurable: true,
      value: () => frame.dataUrl,
    });
    restore = () => {
      if (original) Object.defineProperty(frame.canvas, "toDataURL", original);
      else
        delete (frame.canvas as unknown as { toDataURL?: unknown }).toDataURL;
    };
    const canvas = await Promise.race([
      render(root, {
        width: sourceWidth,
        height: sourceHeight,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,
        skipFonts: true,
        cacheBust: false,
        fetchRequestInit: {
          signal: abort.signal,
          credentials: "omit",
          mode: "same-origin",
          redirect: "error",
        },
        filter: includeCaptureNode,
      }),
      deadline,
    ]);
    if (signal?.aborted) failure("CANCELLED", "Screenshot was cancelled.");
    if (canvas.width !== width || canvas.height !== height)
      failure(
        "CAPTURE_FAILED",
        "The renderer returned unexpected image dimensions.",
      );
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    const encoded = decodeImage(canvas.toDataURL(mimeType, quality), mimeType);
    return {
      ...encoded,
      mimeType,
      width,
      height,
      scope,
      sourceWidth,
      sourceHeight,
      capturedAt: new Date().toISOString(),
      redacted: "password-and-agent-token-inputs",
      renderer: "browser-dom-with-current-viewport",
    };
  } catch (error) {
    if (error instanceof VisualCaptureError) throw error;
    return failure(
      "CAPTURE_FAILED",
      "The browser could not capture the current application. No thumbnail fallback was used.",
    );
  } finally {
    activeViewports.delete(host.viewportRoot);
    restore?.();
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    abort.abort();
  }
}
