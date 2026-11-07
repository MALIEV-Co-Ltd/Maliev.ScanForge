import { afterEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { connectBrowserBridge } from "../src/automation/browser-bridge";
import { AgentConnection } from "../src/ui/AgentConnection";
import type { ApplicationApi } from "../src/automation/api";
afterEach(() => vi.useRealTimers());
const token = "test-token-at-least-thirty-two-characters";
it("rejects non-loopback targets before any network access", async () => {
  const fetcher = vi.fn();
  const api = { invoke: vi.fn(), cancelActive: vi.fn() };
  for (const endpoint of [
    "https://127.0.0.1:5184",
    "http://evil.example",
    "http://127.0.0.1:5184/path",
    "http://user:pass@127.0.0.1:5184",
    "http://127.0.0.1:5184/?token=bad",
  ])
    await expect(
      connectBrowserBridge(api, endpoint, token, vi.fn(), fetcher),
    ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("pairs, forwards validated envelopes, sends result and closes without leaking token in URLs", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  let polled = false;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push([url, init]);
      const body = url.endsWith("/connect")
        ? { sessionId: "session" }
        : url.includes("/poll") && !polled
          ? ((polled = true),
            { requests: [{ id: "request", command: "project_get", args: {} }] })
          : { requests: [], ok: true };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  );
  const api = {
    invoke: vi.fn(async () => ({
      ok: true as const,
      revision: 0,
      result: { name: "Test" },
    })),
    cancelActive: vi.fn(),
  };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    token,
    vi.fn(),
    fetcher,
  );
  await new Promise((r) => setTimeout(r, 20));
  await connection.disconnect();
  expect(api.invoke).toHaveBeenCalledWith("project_get", {});
  expect(api.cancelActive).toHaveBeenCalledOnce();
  expect(calls.some(([url]) => url.endsWith("/result"))).toBe(true);
  expect(
    calls.every(
      ([url, init]) =>
        !url.includes(token) &&
        (init?.headers as Record<string, string>).Authorization ===
          `Bearer ${token}`,
    ),
  ).toBe(true);
});
it("sends large artifact replies with exact JSON and pairing headers", async () => {
  const base64 = "abcXYZ012+/=".repeat(30000);
  let resolveReply!: (value: { body: unknown; authorization: string }) => void;
  const delivered = new Promise<{ body: unknown; authorization: string }>(
    (resolve) => {
      resolveReply = resolve;
    },
  );
  let polled = false;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/connect"))
        return Response.json({ sessionId: "session" });
      if (url.includes("/poll")) {
        if (!polled) {
          polled = true;
          return Response.json({
            requests: [
              {
                id: "request",
                command: "artifact_read",
                args: { artifactId: "a" },
              },
            ],
          });
        }
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          ),
        );
      }
      if (url.endsWith("/result"))
        resolveReply({
          body: init?.body,
          authorization: (init?.headers as Record<string, string>)
            .Authorization,
        });
      return Response.json({ ok: true });
    },
  );
  const api = {
    invoke: vi.fn(async () => ({
      ok: true as const,
      revision: 0,
      result: { base64 },
    })),
    cancelActive: vi.fn(),
  };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    token,
    vi.fn(),
    fetcher,
  );
  try {
    const reply = await delivered;
    expect(reply.body).toBeInstanceOf(Blob);
    expect(reply.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(await (reply.body as Blob).text())).toEqual({
      sessionId: "session",
      id: "request",
      result: { ok: true, revision: 0, result: { base64 } },
    });
  } finally {
    await connection.disconnect();
  }
});
it("renders accessible explicit pairing controls with password field and disabled initial action", () => {
  const html = renderToStaticMarkup(
    createElement(AgentConnection, { api: {} as ApplicationApi }),
  );
  expect(html).toContain('aria-label="AI agent access"');
  expect(html).toContain('type="password"');
  expect(html).toContain('autoComplete="off"');
  expect(html).toContain("Connect agent");
});

it("negotiates long polling and forwards sequential commands without a one-second pause", async () => {
  vi.useFakeTimers();
  const pollUrls: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/connect"))
        return Response.json({
          sessionId: "session",
          capabilities: { pollWaitMs: 8000 },
        });
      if (url.includes("/poll")) {
        pollUrls.push(url);
        if (pollUrls.length <= 2)
          return Response.json({
            requests: [
              { id: String(pollUrls.length), command: "project_get", args: {} },
            ],
          });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
      }
      return Response.json({ ok: true });
    },
  );
  const api = {
    invoke: vi.fn(async () => ({ ok: true as const, revision: 0, result: {} })),
    cancelActive: vi.fn(),
  };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    token,
    vi.fn(),
    fetcher,
  );
  try {
    await vi.advanceTimersByTimeAsync(20);
    expect(api.invoke).toHaveBeenCalledTimes(2);
    expect(pollUrls).toHaveLength(3);
    expect(
      pollUrls.every(
        (url) => new URL(url).searchParams.get("waitMs") === "8000",
      ),
    ).toBe(true);
  } finally {
    await connection.disconnect();
  }
});

it("bounds unexpectedly fast empty negotiated replies without an idle busy loop", async () => {
  vi.useFakeTimers();
  let polls = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/connect"))
      return Response.json({
        sessionId: "session",
        capabilities: { pollWaitMs: 8000 },
      });
    if (url.includes("/poll")) polls++;
    return Response.json({ requests: [], ok: true });
  });
  const connection = await connectBrowserBridge(
    { invoke: vi.fn(), cancelActive: vi.fn() },
    "http://127.0.0.1:5184",
    token,
    vi.fn(),
    fetcher,
  );
  try {
    await vi.advanceTimersByTimeAsync(99);
    expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls).toBe(2);
  } finally {
    await connection.disconnect();
  }
});

it("keeps immediate legacy polls and the one-second cadence when capability is absent or invalid", async () => {
  vi.useFakeTimers();
  for (const capabilities of [
    undefined,
    { pollWaitMs: 8001 },
    { pollWaitMs: "8000" },
  ]) {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/connect"))
        return Response.json({ sessionId: "session", capabilities });
      if (url.includes("/poll")) urls.push(url);
      return Response.json({ requests: [], ok: true });
    });
    const connection = await connectBrowserBridge(
      { invoke: vi.fn(), cancelActive: vi.fn() },
      "http://127.0.0.1:5184",
      token,
      vi.fn(),
      fetcher,
    );
    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(urls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(urls).toHaveLength(2);
      expect(
        urls.every((url) => !new URL(url).searchParams.has("waitMs")),
      ).toBe(true);
    } finally {
      await connection.disconnect();
    }
  }
});

it("reports only Disconnected when intentional disconnect aborts a held poll", async () => {
  vi.useFakeTimers();
  const onStatus = vi.fn();
  let polls = 0;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/connect"))
        return Response.json({
          sessionId: "session",
          capabilities: { pollWaitMs: 8000 },
        });
      if (url.includes("/poll")) {
        polls++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("intentional poll abort")),
            { once: true },
          );
        });
      }
      return Response.json({ ok: true });
    },
  );
  const api = { invoke: vi.fn(), cancelActive: vi.fn() };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    token,
    onStatus,
    fetcher,
  );
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(2000);
    expect(polls).toBe(1);
    expect(api.invoke).not.toHaveBeenCalled();
    expect(api.cancelActive).toHaveBeenCalledOnce();
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      { connected: true, message: "Connected · agents control this workspace" },
      { connected: false, message: "Disconnected" },
    ]);
  } finally {
    await connection.disconnect();
  }
});

it("still disconnects and reports unexpected poll failures", async () => {
  vi.useFakeTimers();
  const onStatus = vi.fn();
  let polls = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/connect"))
      return Response.json({
        sessionId: "session",
        capabilities: { pollWaitMs: 8000 },
      });
    if (url.includes("/poll")) {
      polls++;
      throw new Error("Unexpected network failure");
    }
    return Response.json({ ok: true });
  });
  const api = { invoke: vi.fn(), cancelActive: vi.fn() };
  const connection = await connectBrowserBridge(
    api,
    "http://127.0.0.1:5184",
    token,
    onStatus,
    fetcher,
  );
  try {
    await vi.advanceTimersByTimeAsync(2000);
    expect(polls).toBe(1);
    expect(api.cancelActive).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith({
      connected: false,
      message: "Unexpected network failure",
    });
  } finally {
    await connection.disconnect();
  }
});
