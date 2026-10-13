import { afterEach, expect, it, vi } from "vitest";
import {
  CAPTURE_LIMITS,
  captureApplicationImage,
  includeCaptureNode,
  type CaptureRenderOptions,
  type DomRenderer,
  type VisualCaptureHost,
} from "../src/automation/visual-capture";

const png = `data:image/png;base64,${btoa("\x89PNG\r\n\x1a\nframe")}`;
const jpeg = `data:image/jpeg;base64,${btoa("\xff\xd8\xffframe")}`;
afterEach(() => vi.useRealTimers());
function setup() {
  const canvas = {
    toDataURL: vi.fn(() => png),
  } as unknown as HTMLCanvasElement;
  const attributes: Record<string, string> = {};
  const root = {
    nodeType: 1,
    isConnected: true,
    tagName: "DIV",
    matches: vi.fn(() => false),
    getAttribute: (name: string) => attributes[name] ?? null,
    querySelectorAll: () => [],
    contains: (node: unknown) => node === canvas,
    getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
    ownerDocument: {
      baseURI: "http://127.0.0.1:5173/",
      defaultView: {
        getComputedStyle: () => ({ display: "block", length: 0 }),
      },
    },
  } as unknown as HTMLElement;
  const viewport = {
    ...root,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
  } as HTMLElement;
  const host: VisualCaptureHost = {
    applicationRoot: root,
    viewportRoot: viewport,
    renderViewport: vi.fn(() => ({ canvas, dataUrl: png })),
  };
  const render = vi.fn<DomRenderer>(
    async (_node, options) =>
      ({
        width: options.canvasWidth,
        height: options.canvasHeight,
        toDataURL: vi.fn((mime) => (mime === "image/jpeg" ? jpeg : png)),
      }) as unknown as HTMLCanvasElement,
  );
  return { host, root, viewport, canvas, render, attributes };
}

it("captures application at bounded aspect ratio and freezes the current WebGL frame before DOM serialization", async () => {
  const { host, root, canvas, render } = setup();
  const original = canvas.toDataURL;
  render.mockImplementation(async (node, options) => {
    expect(host.renderViewport).toHaveBeenCalledOnce();
    expect(canvas.toDataURL).not.toBe(original);
    expect(canvas.toDataURL()).toBe(png);
    expect(node).toBe(root);
    expect(options).toMatchObject({
      pixelRatio: 1,
      skipFonts: true,
      cacheBust: false,
    });
    expect(options.fetchRequestInit).toMatchObject({
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
    });
    return {
      width: options.canvasWidth,
      height: options.canvasHeight,
      toDataURL: () => png,
    } as HTMLCanvasElement;
  });
  const result = await captureApplicationImage(host, {}, undefined, render);
  expect(result).toMatchObject({
    width: 1440,
    height: 810,
    sourceWidth: 1920,
    scope: "application",
    mimeType: "image/png",
    data: png.split(",")[1],
    redacted: "password-and-agent-token-inputs",
  });
  expect(canvas.toDataURL).toBe(original);
  expect(Number.isNaN(Date.parse(result.capturedAt))).toBe(false);
});
it("supports viewport-only JPEG without upscaling", async () => {
  const { host, viewport, render } = setup();
  const result = await captureApplicationImage(
    host,
    { scope: "viewport", format: "jpeg", maxWidth: 2048, maxHeight: 2048 },
    undefined,
    render,
  );
  expect(render.mock.calls[0][0]).toBe(viewport);
  expect(result).toMatchObject({
    width: 1280,
    height: 720,
    mimeType: "image/jpeg",
    data: jpeg.split(",")[1],
  });
});
it("rejects invalid parameters before rendering", async () => {
  const { host, render } = setup();
  for (const options of [
    { maxWidth: 2049 },
    { maxHeight: 1 },
    { maxWidth: 64.5 },
    { quality: NaN },
    { quality: 0 },
    { scope: "screen" },
  ]) {
    await expect(
      captureApplicationImage(host, options as never, undefined, render),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  }
  expect(host.renderViewport).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});
it("omits secret input nodes and marked private subtrees from serialized output", () => {
  for (const selector of [
    'input[type="password"]',
    'input[name*="token" i]',
    "[data-agent-private]",
  ]) {
    const node = {
      nodeType: 1,
      matches: (query: string) => query.includes(selector),
    } as HTMLElement;
    expect(includeCaptureNode(node)).toBe(false);
  }
  expect(includeCaptureNode({ nodeType: 3 } as HTMLElement)).toBe(true);
});
it("refuses remote assets without starting renderer or viewport readback", async () => {
  const { host, attributes, render } = setup();
  attributes.src = "https://remote.example/secret.png";
  await expect(
    captureApplicationImage(host, {}, undefined, render),
  ).rejects.toMatchObject({ code: "CAPTURE_UNSUPPORTED_ASSET" });
  expect(render).not.toHaveBeenCalled();
  expect(host.renderViewport).not.toHaveBeenCalled();
});
it("rejects invisible, detached and excessive source surfaces", async () => {
  for (const dimensions of [
    { width: 0, height: 2 },
    { width: 5000, height: 5000 },
  ]) {
    const { host, root, render } = setup();
    root.getBoundingClientRect = () => dimensions as DOMRect;
    await expect(
      captureApplicationImage(host, {}, undefined, render),
    ).rejects.toBeDefined();
    expect(render).not.toHaveBeenCalled();
  }
  const { host, root, render } = setup();
  Object.assign(root, { isConnected: false });
  await expect(
    captureApplicationImage(host, {}, undefined, render),
  ).rejects.toMatchObject({ code: "CAPTURE_UNAVAILABLE" });
});
it("restores canvas serialization after renderer failure and never substitutes a thumbnail", async () => {
  const { host, canvas, render } = setup();
  const original = Object.getOwnPropertyDescriptor(canvas, "toDataURL");
  render.mockRejectedValue(new Error("tainted canvas"));
  await expect(
    captureApplicationImage(host, {}, undefined, render),
  ).rejects.toMatchObject({
    code: "CAPTURE_FAILED",
    message: expect.stringContaining("No thumbnail fallback"),
  });
  expect(Object.getOwnPropertyDescriptor(canvas, "toDataURL")).toEqual(
    original,
  );
});
it("checks final image dimensions, encoding and transfer bytes", async () => {
  for (const encoded of [
    "data:,",
    `data:image/png;base64,${btoa("not an image")}`,
    `data:image/png;base64,${"A".repeat(1400000)}`,
  ]) {
    const { host, render } = setup();
    render.mockImplementation(
      async (_root, options) =>
        ({
          width: options.canvasWidth,
          height: options.canvasHeight,
          toDataURL: () => encoded,
        }) as HTMLCanvasElement,
    );
    await expect(
      captureApplicationImage(host, {}, undefined, render),
    ).rejects.toBeDefined();
  }
  const { host, render } = setup();
  render.mockResolvedValue({ width: 5, height: 5 } as HTMLCanvasElement);
  await expect(
    captureApplicationImage(host, {}, undefined, render),
  ).rejects.toMatchObject({ code: "CAPTURE_FAILED" });
});
it("cancels a pending capture, aborts local asset requests and releases the canvas override", async () => {
  const { host, canvas, render } = setup();
  const original = canvas.toDataURL;
  const controller = new AbortController();
  let options: CaptureRenderOptions | undefined;
  render.mockImplementation((_root, supplied) => {
    options = supplied;
    return new Promise(() => {});
  });
  const pending = captureApplicationImage(host, {}, controller.signal, render);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  expect(options?.fetchRequestInit.signal?.aborted).toBe(true);
  expect(canvas.toDataURL).toBe(original);
});
it("enforces a finite capture lifetime and releases override on timeout", async () => {
  vi.useFakeTimers();
  const { host, canvas, render } = setup();
  const original = canvas.toDataURL;
  render.mockImplementation(() => new Promise(() => {}));
  const pending = captureApplicationImage(host, {}, undefined, render);
  const rejection = expect(pending).rejects.toMatchObject({
    code: "CAPTURE_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(CAPTURE_LIMITS.timeoutMs);
  await rejection;
  expect(canvas.toDataURL).toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});
