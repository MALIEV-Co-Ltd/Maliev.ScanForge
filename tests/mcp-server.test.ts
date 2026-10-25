import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import applicationCatalog from "../src/automation/catalog.json";
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
it("advertises every application tool through the official MCP SDK", async () => {
  const server = createMcpServer(
    { dispatch: async () => ({ ok: true }), close: async () => {} },
    applicationCatalog,
    "# Agent guide",
  );
  const client = new Client({ name: "catalog-contract-test", version: "1" });
  resources.push(server, client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(
    applicationCatalog.map((tool) => tool.name),
  );
  expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  expect(
    tools.find((tool) => tool.name === "selection_set")?.inputSchema,
  ).toEqual(
    applicationCatalog.find((tool) => tool.name === "selection_set")
      ?.inputSchema,
  );
});
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

describe("opt-in bounded long polling", () => {
  it("advertises the bound while legacy clients still receive an immediate empty batch", async () => {
    const bridge = await setup();
    const paired = await (await request(bridge, "/connect", {})).json();
    expect(paired.capabilities).toEqual({ pollWaitMs: 8000 });
    expect(
      await (
        await request(bridge, `/poll?sessionId=${paired.sessionId}`)
      ).json(),
    ).toEqual({ requests: [] });
    for (const wait of ["8001", "-1", "1.5", "NaN", "", "00000"])
      expect(
        (
          await request(
            bridge,
            `/poll?sessionId=${paired.sessionId}&waitMs=${wait}`,
          )
        ).status,
      ).toBe(400);
    expect(
      (await request(bridge, `/poll?sessionId=${paired.sessionId}&waitMs=0`))
        .status,
    ).toBe(200);
  });

  it("holds one idle poll, rejects a duplicate, and wakes immediately on dispatch", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    let settled = false;
    const poll = request(
      bridge,
      `/poll?sessionId=${sessionId}&waitMs=8000`,
    ).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect((await request(bridge, `/poll?sessionId=${sessionId}`)).status).toBe(
      409,
    );
    const call = bridge.dispatch("project_get");
    const response = await poll;
    expect(response.status).toBe(200);
    const batch = await response.json();
    expect(batch.requests).toHaveLength(1);
    await request(bridge, "/result", {
      sessionId,
      id: batch.requests[0].id,
      result: { ok: true },
    });
    await expect(call).resolves.toEqual({ ok: true });
    // A completed waiter must not retain ownership of the next poll.
    expect((await request(bridge, `/poll?sessionId=${sessionId}`)).status).toBe(
      200,
    );
  });

  it("ends an empty idle wait at its finite bound without retaining the waiter", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    const started = Date.now();
    expect(
      await (
        await request(bridge, `/poll?sessionId=${sessionId}&waitMs=40`)
      ).json(),
    ).toEqual({ requests: [] });
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect((await request(bridge, `/poll?sessionId=${sessionId}`)).status).toBe(
      200,
    );
  });

  it("releases an aborted poll without consuming the next command", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    const controller = new AbortController();
    const aborted = fetch(
      `http://127.0.0.1:${bridge.port}/poll?sessionId=${sessionId}&waitMs=8000`,
      {
        headers: { Origin: origin, Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    ).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await aborted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = bridge.dispatch("project_get");
    const response = await request(bridge, `/poll?sessionId=${sessionId}`);
    expect(response.status).toBe(200);
    const batch = await response.json();
    expect(batch.requests).toHaveLength(1);
    await request(bridge, "/result", {
      sessionId,
      id: batch.requests[0].id,
      result: { ok: true },
    });
    await expect(call).resolves.toEqual({ ok: true });
  });

  it("releases a pending waiter on expiry and allows a new owner", async () => {
    const bridge = await setup({ leaseMs: 40 });
    const sessionId = await connect(bridge);
    const response = await request(
      bridge,
      `/poll?sessionId=${sessionId}&waitMs=8000`,
    );
    expect(response.status).toBe(409);
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "No ScanForge",
    );
    const next = await connect(bridge);
    expect(next).not.toBe(sessionId);
    expect((await request(bridge, `/poll?sessionId=${next}`)).status).toBe(200);
  });

  it("keeps an early timer wake pending until the lease actually expires", async () => {
    const bridge = await setup({ leaseMs: 120 });
    const sessionId = await connect(bridge);
    const schedule = globalThis.setTimeout;
    let earlyWake = false;
    const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      ...[callback, delay, ...args]: Parameters<typeof setTimeout>
    ) => {
      const early = !earlyWake && Number(delay) > 1 && Number(delay) <= 120;
      if (early) earlyWake = true;
      return schedule(callback, early ? 1 : delay, ...args);
    }) as typeof setTimeout);
    try {
      const response = await request(
        bridge,
        `/poll?sessionId=${sessionId}&waitMs=8000`,
      );
      expect(earlyWake).toBe(true);
      expect(response.status).toBe(409);
      await expect(bridge.dispatch("project_get")).rejects.toThrow(
        "No ScanForge",
      );
      const next = await connect(bridge);
      expect(next).not.toBe(sessionId);
      expect((await request(bridge, `/poll?sessionId=${next}`)).status).toBe(
        200,
      );
    } finally {
      timers.mockRestore();
    }
  });

  it("releases a pending waiter on disconnect and on server close", async () => {
    const bridge = await setup();
    let sessionId = await connect(bridge);
    const first = request(bridge, `/poll?sessionId=${sessionId}&waitMs=8000`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await request(bridge, "/disconnect", { sessionId });
    expect((await first).status).toBe(409);
    sessionId = await connect(bridge);
    const second = request(
      bridge,
      `/poll?sessionId=${sessionId}&waitMs=8000`,
    ).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await bridge.close();
    // Closing may end the HTTP response or close its socket; neither retains a lease.
    const ended = await second;
    if (ended instanceof Response) expect(ended.status).toBe(409);
    else expect(ended).toBeInstanceOf(Error);
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "Bridge closed",
    );
  });

  it("does not weaken origin, token, owner or command timeout checks for waiting polls", async () => {
    const bridge = await setup({ timeoutMs: 30 });
    const sessionId = await connect(bridge);
    const path = `/poll?sessionId=${sessionId}&waitMs=8000`;
    expect(
      (
        await request(bridge, path, undefined, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(bridge, path, undefined, {
          Authorization: "Bearer wrong",
        })
      ).status,
    ).toBe(401);
    expect(
      (await request(bridge, "/poll?sessionId=wrong&waitMs=8000")).status,
    ).toBe(409);
    await expect(bridge.dispatch("project_get")).rejects.toThrow("timed out");
    expect(
      await (await request(bridge, `/poll?sessionId=${sessionId}`)).json(),
    ).toEqual({ requests: [] });
  });

  it("retains sixteen-command batches and sixty-four pending commands for opt-in clients", async () => {
    const bridge = await setup();
    const sessionId = await connect(bridge);
    const calls = Array.from({ length: 64 }, () =>
      bridge.dispatch("project_get").catch((error: Error) => error.message),
    );
    await expect(bridge.dispatch("project_get")).rejects.toThrow(
      "queue is full",
    );
    for (let batch = 0; batch < 4; batch++)
      expect(
        (
          await (
            await request(bridge, `/poll?sessionId=${sessionId}&waitMs=8000`)
          ).json()
        ).requests,
      ).toHaveLength(16);
    await request(bridge, "/disconnect", { sessionId });
    expect(await Promise.all(calls)).toEqual(
      Array(64).fill("Browser disconnected"),
    );
  });

  it("clears the actual waiter timer on abort, disconnect, expiry and close", async () => {
    for (const reason of ["abort", "disconnect", "expiry", "close"]) {
      const bridge = await setup({ leaseMs: reason === "expiry" ? 80 : 60000 });
      const sessionId = await connect(bridge);
      const timers = vi.spyOn(globalThis, "setTimeout");
      const clears = vi.spyOn(globalThis, "clearTimeout");
      const controller = new AbortController();
      try {
        const poll = fetch(
          `http://127.0.0.1:${bridge.port}/poll?sessionId=${sessionId}&waitMs=8000`,
          {
            headers: { Origin: origin, Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        ).catch((error: unknown) => error);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const index = timers.mock.calls.findIndex(([, delay]) =>
          reason === "expiry"
            ? typeof delay === "number" && delay > 20 && delay <= 80
            : delay === 8000,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const actualWaiterTimer = timers.mock.results[index].value;
        if (reason === "abort") controller.abort();
        if (reason === "disconnect")
          await request(bridge, "/disconnect", { sessionId });
        if (reason === "close") await bridge.close();
        await poll;
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(clears).toHaveBeenCalledWith(actualWaiterTimer);
      } finally {
        controller.abort();
        timers.mockRestore();
        clears.mockRestore();
        await bridge.close();
      }
    }
  });
});

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

it("delivers screenshots as native MCP images without duplicating binary data in text", async () => {
  const data = Buffer.from("\x89PNG\r\n\x1a\n", "binary").toString("base64");
  const bridge = {
    close: async () => {},
    dispatch: async () => ({
      ok: true,
      revision: 4,
      result: {
        image: {
          data,
          mimeType: "image/png",
          width: 800,
          height: 600,
          scope: "application",
        },
        artifact: { artifactId: "image-1" },
      },
    }),
  };
  const server = createMcpServer(
    bridge,
    [
      {
        name: "screenshot_capture",
        description: "Capture current screen",
        readOnly: true,
        inputSchema: { type: "object", properties: {} },
      },
    ],
    "Guide",
  );
  const client = new Client({ name: "visual-agent", version: "1" });
  resources.push(server, client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const result = (await client.callTool({
    name: "screenshot_capture",
    arguments: {},
  })) as CallToolResult;
  expect(result.content[0]).toEqual({
    type: "image",
    data,
    mimeType: "image/png",
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    revision: 4,
    result: {
      image: { width: 800, height: 600 },
      artifact: { artifactId: "image-1" },
    },
  });
  expect(JSON.stringify(result.structuredContent)).not.toContain(data);
  expect((result.content[1] as { text: string }).text).not.toContain(data);
  expect((await client.listTools()).tools[0].annotations?.readOnlyHint).toBe(
    false,
  );
});

it("rejects oversized or unsupported browser image responses", async () => {
  for (const image of [
    { data: "AAAA", mimeType: "image/svg+xml" },
    { data: "A".repeat(1398108), mimeType: "image/png" },
  ]) {
    const server = createMcpServer(
      {
        dispatch: async () => ({ ok: true, result: { image } }),
        close: async () => {},
      },
      [
        {
          name: "screenshot_capture",
          readOnly: true,
          inputSchema: { type: "object" },
        },
      ],
      "Guide",
    );
    const client = new Client({ name: "bad-image-test", version: "1" });
    resources.push(server, client);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    expect(
      await client.callTool({ name: "screenshot_capture", arguments: {} }),
    ).toMatchObject({ isError: true });
  }
});
