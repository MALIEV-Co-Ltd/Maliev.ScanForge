import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// The Node executable is intentionally JavaScript, independent of the browser bundle.
// @ts-expect-error Node script has no browser TypeScript declaration.
import { createBridge, createMcpServer } from "../scripts/mcp-server.mjs";

const token = "test-token-with-at-least-thirty-two-characters";
const origin = "http://127.0.0.1:5173";
type Bridge = {
  port: number;
  dispatch: (command: string, args?: object) => Promise<unknown>;
  close: () => Promise<void>;
};
const resources: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) await resource.close();
});
async function setup(options = {}): Promise<Bridge> {
  const bridge = await createBridge({ token, port: 0, ...options });
  resources.push(bridge);
  return bridge;
}
async function request(
  bridge: Bridge,
  path: string,
  data?: object,
  headers: Record<string, string> = {},
) {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function connect(bridge: Bridge) {
  return (await (await request(bridge, "/connect", {})).json())
    .sessionId as string;
}

describe("authenticated browser bridge", () => {
  it("requires a sufficiently strong token", async () => {
    await expect(createBridge({ token: "short", port: 0 })).rejects.toThrow(
      "32 characters",
    );
  });
  it("rejects unauthorized origins, hosts and tokens; allows browser preflight only", async () => {
    const bridge = await setup();
    expect(
      (
        await request(
          bridge,
          "/connect",
          {},
          { Origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: bridge.port,
          path: "/connect",
          method: "POST",
          headers: {
            Host: `localhost:${bridge.port}`,
            Origin: origin,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(hostStatus).toBe(403);
    expect(
      (await request(bridge, "/connect", {}, { Authorization: "Bearer wrong" }))
        .status,
    ).toBe(401);
    const preflight = await fetch(`http://127.0.0.1:${bridge.port}/connect`, {
      method: "OPTIONS",
      headers: { Origin: origin },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "No ScanForge",
    );
  });
  it("enforces one owner, forwards commands and rejects forged or repeated results", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    expect((await request(bridge, "/connect", {})).status).toBe(409);
    expect((await request(bridge, "/poll?sessionId=wrong")).status).toBe(409);
    const call = bridge.dispatch("project_get", { sample: true });
    const poll = await (
      await request(bridge, `/poll?sessionId=${sessionId}`)
    ).json();
    expect(poll.requests).toHaveLength(1);
    expect(poll.requests[0]).toMatchObject({
      command: "project_get",
      args: { sample: true },
    });
    const id = poll.requests[0].id;
    expect(
      (
        await request(bridge, "/result", {
          sessionId: "wrong",
          id,
          result: { ok: true },
        })
      ).status,
    ).toBe(409);
    expect(
      (await request(bridge, "/result", { sessionId, id, result: {} })).status,
    ).toBe(400);
    expect(
      (
        await request(bridge, "/result", {
          sessionId,
          id,
          result: { ok: true, revision: 3 },
        })
      ).status,
    ).toBe(200);
    await expect(call).resolves.toEqual({ ok: true, revision: 3 });
    expect(
      (
        await request(bridge, "/result", {
          sessionId,
          id,
          result: { ok: true },
        })
      ).status,
    ).toBe(404);
  });
  it("limits outstanding work and delivers at most sixteen commands per poll", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    const calls = Array.from({ length: 64 }, () =>
      bridge.dispatch("project_get").catch((error: Error) => error.message),
    );
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "queue is full",
    );
    expect(
      (await (await request(bridge, `/poll?sessionId=${sessionId}`)).json())
        .requests,
    ).toHaveLength(16);
    await request(bridge, "/disconnect", { sessionId });
    expect(await Promise.all(calls)).toEqual(
      Array(64).fill("Browser disconnected"),
    );
  });
  it("rejects oversized and malformed bodies", async () => {
    const bridge = await setup();
    expect(
      (
        await request(bridge, "/connect", {
          padding: "x".repeat(2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413);
    const invalid = await fetch(`http://127.0.0.1:${bridge.port}/connect`, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
      body: "{",
    });
    expect(invalid.status).toBe(400);
  });
  it("times out commands, expires owners, and closes the listening port", async () => {
    const bridge = await setup({ timeoutMs: 25, leaseMs: 80 });
    await connect(bridge);
    await expect(bridge.dispatch("project_get")).rejects.toThrow("timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "No ScanForge",
    );
    await connect(bridge);
    const outstanding = bridge
      .dispatch("project_get")
      .catch((error: Error) => error.message);
    await bridge.close();
    expect(await outstanding).toBe("Bridge closed");
    await expect(request(bridge, "/connect", {})).rejects.toThrow();
  });
  it("enforces the bridge finite lifetime", async () => {
    const bridge = await setup({ lifetimeMs: 30 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "Bridge closed",
    );
    await expect(request(bridge, "/connect", {})).rejects.toThrow();
  });
});

it("speaks official MCP tool and resource protocols through the SDK", async () => {
  const bridge = await setup();
  const sessionId = await connect(bridge);
  const catalog = [
    {
      name: "project_get",
      description: "Inspect project",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
  const server = createMcpServer(bridge, catalog, "# Agent guide");
  resources.push(server);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  resources.push(client);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  expect((await client.listTools()).tools[0]).toMatchObject({
    name: "project_get",
    annotations: { readOnlyHint: true },
  });
  expect(
    (await client.listResources()).resources.map((resource) => resource.uri),
  ).toEqual(["scanforge://agent-guide", "scanforge://project"]);
  expect(
    (await client.readResource({ uri: "scanforge://agent-guide" })).contents[0],
  ).toMatchObject({ text: "# Agent guide" });
  const call = client.callTool({ name: "project_get", arguments: {} });
  let requests: Array<{ id: string }> = [];
  for (let attempt = 0; attempt < 20 && !requests.length; attempt++) {
    requests = (
      await (await request(bridge, `/poll?sessionId=${sessionId}`)).json()
    ).requests;
    if (!requests.length)
      await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(requests).toHaveLength(1);
  await request(bridge, "/result", {
    sessionId,
    id: requests[0].id,
    result: { ok: true, project: { revision: 1 } },
  });
  expect(await call).toMatchObject({
    structuredContent: { ok: true, project: { revision: 1 } },
    isError: false,
  });
  expect(await client.callTool({ name: "unknown" })).toMatchObject({
    isError: true,
  });
  const resourceCall = client.readResource({ uri: "scanforge://project" });
  requests = [];
  for (let attempt = 0; attempt < 20 && !requests.length; attempt++) {
    requests = (
      await (await request(bridge, `/poll?sessionId=${sessionId}`)).json()
    ).requests;
    if (!requests.length)
      await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(requests).toHaveLength(1);
  await request(bridge, "/result", {
    sessionId,
    id: requests[0].id,
    result: { ok: true, revision: 2 },
  });
  expect((await resourceCall).contents[0]).toMatchObject({
    text: JSON.stringify({ ok: true, revision: 2 }),
  });
  await bridge.close();
  expect(await client.callTool({ name: "project_get" })).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { code: "BRIDGE_UNAVAILABLE" } },
  });
});
