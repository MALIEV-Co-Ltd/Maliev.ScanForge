import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const root = new URL("../", import.meta.url);
const failure = (message) => new Error(message);

/** A single-owner, authenticated browser bridge. close() rejects all outstanding work. */
export async function createBridge({
  token,
  port = 5184,
  origins = ["http://127.0.0.1:5173", "http://localhost:5173"],
  leaseMs = 60_000,
  timeoutMs = 30_000,
  lifetimeMs = 8 * 60 * 60 * 1000,
} = {}) {
  if (typeof token !== "string" || token.length < 32)
    throw failure("SCANFORGE_MCP_TOKEN must contain at least 32 characters");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw failure("Invalid bridge port");
  const allowed = new Set(origins);
  const secret = Buffer.from(`Bearer ${token}`);
  let session;
  let queue = [];
  const pending = new Map();
  let closed = false;
  let closing;
  function rejectAll(message) {
    queue = [];
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failure(message));
    }
    pending.clear();
  }
  function expire() {
    if (session && session.expires <= Date.now()) {
      session = undefined;
      rejectAll("Browser session expired");
    }
  }
  function authenticate(req) {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    return (
      supplied.length === secret.length && timingSafeEqual(supplied, secret)
    );
  }
  async function body(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let exceeded = false;
      req.on("data", (chunk) => {
        if (exceeded) return;
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          exceeded = true;
          chunks.length = 0;
          reject(
            Object.assign(failure("Request exceeds 2 MiB"), { status: 413 }),
          );
          return;
        }
        chunks.push(chunk);
      });
      req.once("end", () => {
        if (exceeded) return;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(Object.assign(failure("Invalid JSON body"), { status: 400 }));
        }
      });
      req.once("error", reject);
      req.once("aborted", () => reject(failure("Request aborted")));
    });
  }
  const server = http.createServer(async (req, res) => {
    const respond = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const actualPort = server.address()?.port;
      if (req.headers.host !== `127.0.0.1:${actualPort}`)
        return respond(403, { error: "Forbidden host" });
      const origin = req.headers.origin;
      if (!origin || !allowed.has(origin))
        return respond(403, { error: "Forbidden origin" });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      // Browser preflight never carries Authorization; it grants no session access.
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        return respond(204, null);
      }
      if (!authenticate(req)) return respond(401, { error: "Unauthorized" });
      expire();
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (req.method === "POST" && url.pathname === "/connect") {
        const data = await body(req);
        if (session && data.sessionId !== session.id)
          return respond(409, { error: "Another browser owns the session" });
        if (!session)
          session = { id: randomUUID(), expires: Date.now() + leaseMs };
        session.expires = Date.now() + leaseMs;
        return respond(200, { sessionId: session.id });
      }
      const data =
        req.method === "GET"
          ? { sessionId: url.searchParams.get("sessionId") }
          : await body(req);
      if (!session || data.sessionId !== session.id)
        return respond(409, {
          error: "Browser session does not own this bridge",
        });
      session.expires = Date.now() + leaseMs;
      if (req.method === "GET" && url.pathname === "/poll") {
        const requests = queue.splice(0, 16);
        for (const request of requests) {
          const entry = pending.get(request.id);
          if (entry) entry.delivered = true;
        }
        return respond(200, { requests });
      }
      if (req.method === "POST" && url.pathname === "/result") {
        const entry = pending.get(data.id);
        if (!entry || !entry.delivered)
          return respond(404, { error: "Unknown request" });
        if (
          !data.result ||
          typeof data.result !== "object" ||
          Array.isArray(data.result) ||
          typeof data.result.ok !== "boolean"
        )
          return respond(400, {
            error: "Result must be an object containing boolean ok",
          });
        clearTimeout(entry.timer);
        pending.delete(data.id);
        entry.resolve(data.result);
        return respond(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/disconnect") {
        session = undefined;
        rejectAll("Browser disconnected");
        return respond(200, { ok: true });
      }
      return respond(404, { error: "Unknown route" });
    } catch (error) {
      if (!res.headersSent)
        respond(error.status ?? 400, { error: error.message });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const reaper = setInterval(expire, Math.min(1000, leaseMs));
  reaper.unref();
  const lifetime = setTimeout(() => {
    void close();
  }, lifetimeMs);
  lifetime.unref();
  function dispatch(command, args = {}) {
    expire();
    if (closed) return Promise.reject(failure("Bridge closed"));
    if (!session)
      return Promise.reject(failure("No ScanForge browser connected"));
    if (pending.size >= 64)
      return Promise.reject(failure("Bridge queue is full"));
    if (
      Buffer.byteLength(JSON.stringify({ command, args }), "utf8") >
      2 * 1024 * 1024
    )
      return Promise.reject(failure("Command exceeds 2 MiB"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        queue = queue.filter((request) => request.id !== id);
        reject(failure("Browser command timed out"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, delivered: false });
      queue.push({ id, command, args });
    });
  }
  async function close() {
    if (closed) return closing;
    closed = true;
    clearInterval(reaper);
    clearTimeout(lifetime);
    session = undefined;
    rejectAll("Bridge closed");
    closing = new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await closing;
  }
  return { port: server.address().port, dispatch, close };
}

/** Official SDK protocol adapter; geometry and project commands execute in ScanForge. */
export function createMcpServer(bridge, catalog, guide) {
  const server = new Server(
    { name: "scanforge", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Read scanforge://agent-guide before modeling. Inspect project_get for object IDs and revision. Use tools/list schemas; mutations require unique requestId and expectedRevision. Geometry jobs return immediately; inspect and cancel jobs through the corresponding tools.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.map(({ name, description, inputSchema, readOnly }) => ({
      name,
      description,
      inputSchema,
      annotations: {
        readOnlyHint:
          readOnly &&
          ![
            "artifact_put",
            "artifact_delete",
            "job_cancel",
            "project_export",
            "screenshot_capture",
          ].includes(name),
        destructiveHint: !readOnly || name === "artifact_delete",
        openWorldHint: false,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!catalog.some((tool) => tool.name === params.name))
      return {
        content: [{ type: "text", text: "Unknown ScanForge tool" }],
        isError: true,
      };
    try {
      const result = await bridge.dispatch(params.name, params.arguments ?? {});
      if (params.name === "screenshot_capture" && result.ok) {
        const { image, ...metadata } = result.result;
        if (
          !image ||
          !["image/png", "image/jpeg"].includes(image.mimeType) ||
          typeof image.data !== "string" ||
          image.data.length > 1398104 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            image.data,
          )
        )
          throw failure("Invalid screenshot response from browser");
        const { data, ...imageInfo } = image;
        const structured = {
          ...result,
          result: { ...metadata, image: imageInfo },
        };
        return {
          content: [
            { type: "image", data, mimeType: image.mimeType },
            { type: "text", text: JSON.stringify(structured) },
          ],
          structuredContent: structured,
          isError: false,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: !result.ok,
      };
    } catch (error) {
      const result = {
        ok: false,
        error: { code: "BRIDGE_UNAVAILABLE", message: error.message },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "scanforge://agent-guide",
        name: "ScanForge agent guide",
        mimeType: "text/markdown",
      },
      {
        uri: "scanforge://project",
        name: "Current ScanForge project",
        mimeType: "application/json",
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri === "scanforge://agent-guide")
      return {
        contents: [{ uri: params.uri, mimeType: "text/markdown", text: guide }],
      };
    if (params.uri === "scanforge://project")
      return {
        contents: [
          {
            uri: params.uri,
            mimeType: "application/json",
            text: JSON.stringify(await bridge.dispatch("project_get", {})),
          },
        ],
      };
    throw failure("Unknown resource");
  });
  server.onclose = () => {
    void bridge.close();
  };
  return server;
}

async function main() {
  const catalog = JSON.parse(
    await readFile(new URL("src/automation/catalog.json", root), "utf8"),
  );
  const guide = await readFile(new URL("docs/AGENT_GUIDE.md", root), "utf8");
  const bridge = await createBridge({
    token: process.env.SCANFORGE_MCP_TOKEN,
    port: Number(process.env.SCANFORGE_BRIDGE_PORT ?? 5184),
    origins: (
      process.env.SCANFORGE_ORIGINS ??
      "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((origin) => origin.trim()),
  });
  const server = createMcpServer(bridge, catalog, guide);
  const shutdown = () => {
    void server.close().finally(() => bridge.close());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await bridge.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`ScanForge MCP startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
