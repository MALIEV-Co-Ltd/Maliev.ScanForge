import type { ApplicationApi, ApiResult } from "./api";

export interface BridgeStatus {
  connected: boolean;
  message: string;
}
/** Explicit user pairing only. Credentials stay in memory; closing the tab revokes ownership. */
export async function connectBrowserBridge(
  api: Pick<ApplicationApi, "invoke" | "cancelActive">,
  endpoint: string,
  token: string,
  onStatus: (status: BridgeStatus) => void,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Use a loopback bridge URL such as http://127.0.0.1:5184.");
  if (token.length < 32)
    throw new Error("Pairing token must contain at least 32 characters.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sessionId = "";
  let closed = false;
  async function request(path: string, body?: unknown) {
    const response = await fetcher(new URL(path, url), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error(
        `Local bridge returned HTTP ${response.status}; check pairing token, allowed origin and workspace ownership.`,
      );
    return response.json();
  }
  const disconnect = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    api.cancelActive();
    try {
      if (sessionId)
        await fetcher(new URL("/disconnect", url), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId }),
          keepalive: true,
          credentials: "omit",
          signal: AbortSignal.timeout(2000),
        });
    } catch {
      /* Server also revokes ownership after its finite lease. */
    } finally {
      controller.abort();
      onStatus({ connected: false, message: "Disconnected" });
    }
  };
  try {
    const connected = await request("/connect", {});
    if (typeof connected.sessionId !== "string" || !connected.sessionId)
      throw new Error("Bridge returned an invalid workspace session.");
    sessionId = connected.sessionId;
    onStatus({
      connected: true,
      message: "Connected · agents control this workspace",
    });
    async function poll() {
      if (closed) return;
      try {
        const result = await request(
          `/poll?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!Array.isArray(result.requests) || result.requests.length > 16)
          throw new Error("Invalid bridge request batch.");
        for (const item of result.requests) {
          if (closed) break;
          let reply: ApiResult;
          if (
            !item ||
            typeof item.id !== "string" ||
            typeof item.command !== "string" ||
            !item.args ||
            typeof item.args !== "object" ||
            Array.isArray(item.args)
          )
            throw new Error("Invalid application command envelope.");
          reply = await api.invoke(item.command, item.args);
          if (!closed)
            await request("/result", { sessionId, id: item.id, result: reply });
        }
        if (!closed) timer = setTimeout(() => void poll(), 1000);
      } catch (error) {
        await disconnect();
        onStatus({
          connected: false,
          message: error instanceof Error ? error.message : "Connection failed",
        });
      }
    }
    void poll();
    return { disconnect };
  } catch (error) {
    controller.abort();
    throw error;
  }
}
