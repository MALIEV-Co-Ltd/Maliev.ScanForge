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
it("renders accessible explicit pairing controls with password field and disabled initial action", () => {
  const html = renderToStaticMarkup(
    createElement(AgentConnection, { api: {} as ApplicationApi }),
  );
  expect(html).toContain('aria-label="AI agent access"');
  expect(html).toContain('type="password"');
  expect(html).toContain('autoComplete="off"');
  expect(html).toContain("Connect agent");
});
