import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
const WebSocket = createRequire(
  new URL("../scripts/mcp-server.mjs", import.meta.url),
)("ws");
import { createBridge } from "../scripts/mcp-server.mjs";

const token = "test-token-with-at-least-thirty-two-characters",
  origin = "http://127.0.0.1:5173";
const resources = [];
afterEach(async () => {
  for (const r of resources.splice(0).reverse()) await r.close();
});
async function setup() {
  const bridge = await createBridge({ token, port: 0, leaseMs: 5000 });
  resources.push(bridge);
  const request = (path, body) =>
    fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const sessionId = (await (await request("/connect", {})).json()).sessionId;
  return { bridge, request, sessionId };
}
async function open(bridge, o = origin) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/result-ws`, {
    origin: o,
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
function receive(ws) {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.once("error", reject);
  });
}
function closed(ws) {
  return new Promise((resolve) => ws.once("close", resolve));
}
async function authenticate(ws, sessionId, secret = token) {
  const wait = receive(ws);
  ws.send(JSON.stringify({ token: secret, sessionId }));
  return wait;
}

it("rejects binary authentication frames", async () => {
  const { bridge, sessionId } = await setup();
  const ws = await open(bridge);
  const done = closed(ws);
  ws.send(Buffer.from(JSON.stringify({ token, sessionId })));
  await expect(
    Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("binary frame accepted")), 1000),
      ),
    ]),
  ).resolves.toBeDefined();
});

it("expires an unauthenticated socket", async () => {
  const { bridge } = await setup();
  const ws = await open(bridge);
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      closed(ws),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("authentication lease did not expire")),
          8000,
        );
      }),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
  } finally {
    clearTimeout(timer);
    ws.terminate();
  }
}, 9500);

it("bounds unauthenticated channel handshakes", async () => {
  const { bridge } = await setup();
  const sockets = [];
  try {
    for (let i = 0; i < 4; i++) sockets.push(await open(bridge));
    await expect(open(bridge)).rejects.toThrow();
  } finally {
    for (const ws of sockets) ws.terminate();
  }
});

it("rejects an unapproved origin and an incorrect token without disturbing the owner", async () => {
  const { bridge, request, sessionId } = await setup();
  await expect(open(bridge, "http://attacker.example")).rejects.toThrow();
  const bad = await open(bridge);
  const done = closed(bad);
  bad.send(
    JSON.stringify({
      token: "incorrect-token-long-enough-for-a-failed-check",
      sessionId,
    }),
  );
  await done;
  expect((await request(`/poll?sessionId=${sessionId}`)).status).toBe(200);
  const good = await open(bridge);
  expect(await authenticate(good, sessionId)).toEqual({ ready: true });
  good.terminate();
});

it("accepts a delivered result once and rejects duplicate replies", async () => {
  const { bridge, request, sessionId } = await setup();
  const ws = await open(bridge);
  expect(await authenticate(ws, sessionId)).toEqual({ ready: true });
  const call = bridge.dispatch("project_get");
  const batch = await (await request(`/poll?sessionId=${sessionId}`)).json();
  const id = batch.requests[0].id,
    body = JSON.stringify({
      sessionId,
      id,
      result: { ok: true, result: { value: 42 } },
    });
  const ack = receive(ws);
  ws.send(body);
  expect(await ack).toEqual({ id, ok: true });
  await expect(call).resolves.toMatchObject({ result: { value: 42 } });
  const done = closed(ws);
  ws.send(body);
  await done;
});

it("rejects an oversized result without publishing the pending command", async () => {
  const { bridge, request, sessionId } = await setup();
  const ws = await open(bridge);
  expect(await authenticate(ws, sessionId)).toEqual({ ready: true });
  const call = bridge.dispatch("project_get");
  const batch = await (await request(`/poll?sessionId=${sessionId}`)).json();
  const id = batch.requests[0].id,
    done = closed(ws);
  ws.send(
    JSON.stringify({
      sessionId,
      id,
      result: { ok: true, result: { payload: "x".repeat(2 * 1024 * 1024) } },
    }),
  );
  await done;
  expect(
    (
      await request("/result", {
        sessionId,
        id,
        result: { ok: true, result: { legitimate: true } },
      })
    ).status,
  ).toBe(200);
  await expect(call).resolves.toMatchObject({ result: { legitimate: true } });
});

it("rejects a second authenticated channel for one browser session", async () => {
  const { bridge, sessionId } = await setup();
  const first = await open(bridge);
  expect(await authenticate(first, sessionId)).toEqual({ ready: true });
  const second = await open(bridge);
  const done = closed(second);
  second.send(JSON.stringify({ token, sessionId }));
  await expect(
    Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("duplicate channel stayed open")), 1000),
      ),
    ]),
  ).resolves.toBeDefined();
  first.terminate();
});

it("rejects a result from a socket belonging to an earlier session", async () => {
  const { bridge, request, sessionId } = await setup();
  const ws = await open(bridge);
  expect(await authenticate(ws, sessionId)).toEqual({ ready: true });
  const done = closed(ws);
  await request("/disconnect", { sessionId });
  await expect(
    Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("stale channel stayed open")), 1000),
      ),
    ]),
  ).resolves.toBeDefined();
  const next = (await (await request("/connect", {})).json()).sessionId;
  const call = bridge.dispatch("project_get");
  const batch = await (await request(`/poll?sessionId=${next}`)).json();
  await request("/result", {
    sessionId: next,
    id: batch.requests[0].id,
    result: { ok: true, result: { legitimate: true } },
  });
  await expect(call).resolves.toMatchObject({ result: { legitimate: true } });
});
