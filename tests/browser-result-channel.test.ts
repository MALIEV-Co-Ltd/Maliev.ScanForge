import { afterEach, expect, it, vi } from "vitest";
import { connectBrowserBridge } from "../src/automation/browser-bridge";
afterEach(() => vi.unstubAllGlobals());

it("falls back to HTTP when the browser blocks WebSocket construction", async () => {
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        throw new Error("blocked");
      }
    },
  );
  let sent = false,
    polled = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/connect"))
      return Response.json({
        sessionId: "session",
        capabilities: { resultWebSocket: true },
      });
    if (url.includes("/poll")) {
      if (!polled) {
        polled = true;
        return Response.json({
          requests: [{ id: "request", command: "artifact_read", args: {} }],
        });
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        ),
      );
    }
    if (url.endsWith("/result")) sent = true;
    return Response.json({ ok: true });
  };
  const api = {
    invoke: vi.fn(async () => ({
      ok: true as const,
      revision: 0,
      result: { base64: "A".repeat(100000) },
    })),
    cancelActive: vi.fn(),
  };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    "test-token-at-least-thirty-two-characters",
    vi.fn(),
    fetcher,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent).toBe(true);
  } finally {
    await connection.disconnect();
  }
});

it("uses the existing HTTP path if the socket closes before a reply is sent", async () => {
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor(_url: string) {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(_payload: string) {
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ ready: true }),
          }),
        );
        setTimeout(() => this.close(), 0);
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  let sent = false,
    polled = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/connect"))
      return Response.json({
        sessionId: "session",
        capabilities: { resultWebSocket: true },
      });
    if (url.includes("/poll")) {
      if (!polled) {
        polled = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({
          requests: [{ id: "request", command: "artifact_read", args: {} }],
        });
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        ),
      );
    }
    if (url.endsWith("/result")) sent = true;
    return Response.json({ ok: true });
  };
  const api = {
    invoke: vi.fn(async () => ({
      ok: true as const,
      revision: 0,
      result: { base64: "A".repeat(100000) },
    })),
    cancelActive: vi.fn(),
  };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    "test-token-at-least-thirty-two-characters",
    vi.fn(),
    fetcher,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toBe(true);
    expect(api.cancelActive).not.toHaveBeenCalled();
  } finally {
    await connection.disconnect();
  }
});

it.each(["wrong acknowledgment", "socket closes", "send throws"])(
  "does not resend after %s",
  async (failure) => {
    class FakeSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      sends = 0;
      constructor(_url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      send(_payload: string) {
        if (this.sends === 1 && failure === "send throws")
          throw new Error("send failed");
        if (++this.sends > 1 && failure === "socket closes") {
          queueMicrotask(() => this.close());
          return;
        }
        const value =
          this.sends === 1 ? { ready: true } : { id: "wrong", ok: true };
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", { data: JSON.stringify(value) }),
          ),
        );
      }
      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    let polled = false,
      sentResult = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/connect"))
        return Response.json({
          sessionId: "session",
          capabilities: { resultWebSocket: true },
        });
      if (url.includes("/poll")) {
        if (!polled) {
          polled = true;
          return Response.json({
            requests: [{ id: "request", command: "artifact_read", args: {} }],
          });
        }
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(Error("aborted")),
            { once: true },
          ),
        );
      }
      if (url.endsWith("/result")) sentResult = true;
      return Response.json({ ok: true });
    };
    const api = {
      invoke: vi.fn(async () => ({
        ok: true as const,
        revision: 0,
        result: { base64: "A".repeat(100000) },
      })),
      cancelActive: vi.fn(),
    };
    const connection = await connectBrowserBridge(
      api,
      "http://127.0.0.1:5184",
      "test-token-at-least-thirty-two-characters",
      vi.fn(),
      fetcher,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(api.cancelActive).toHaveBeenCalledOnce();
      expect(sentResult).toBe(false);
    } finally {
      await connection.disconnect();
    }
  },
);
