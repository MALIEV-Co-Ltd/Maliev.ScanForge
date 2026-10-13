import { useEffect, useRef, useState } from "react";
import type { ApplicationApi } from "../automation/api";
import {
  connectBrowserBridge,
  type BridgeStatus,
} from "../automation/browser-bridge";

export function AgentConnection({ api }: { api: ApplicationApi }) {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:5184");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    message: "Agent access is off",
  });
  const connection = useRef<
    Awaited<ReturnType<typeof connectBrowserBridge>> | undefined
  >(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const leave = () => void connection.current?.disconnect();
    window.addEventListener("pagehide", leave);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);
  async function connect() {
    setConnecting(true);
    try {
      const next = await connectBrowserBridge(api, endpoint, token, (value) => {
        if (mounted.current) setStatus(value);
      });
      if (!mounted.current) await next.disconnect();
      else {
        connection.current = next;
        setToken("");
      }
    } catch (error) {
      if (mounted.current)
        setStatus({
          connected: false,
          message: error instanceof Error ? error.message : "Connection failed",
        });
    } finally {
      if (mounted.current) setConnecting(false);
    }
  }
  return (
    <section aria-label="AI agent access">
      <h3>AI agent access</h3>
      <p>
        Connect an MCP agent to this workspace. Agents can edit the model and
        create local export artifacts. Disconnect stops agent access and
        requests cancellation of active agent work.
      </p>
      <label>
        Local bridge URL
        <input
          aria-label="Local bridge URL"
          value={endpoint}
          disabled={status.connected || connecting}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </label>
      <label>
        Pairing token
        <input
          aria-label="Pairing token"
          type="password"
          autoComplete="off"
          value={token}
          disabled={status.connected || connecting}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p role="status">{status.message}</p>
      <button
        disabled={connecting || (!status.connected && token.length < 32)}
        onClick={() =>
          status.connected
            ? void connection.current?.disconnect()
            : void connect()
        }
      >
        {status.connected ? "Disconnect agent" : "Connect agent"}
      </button>
      <button disabled={!status.connected} onClick={() => api.cancelActive()}>
        Cancel agent operation
      </button>
    </section>
  );
}
