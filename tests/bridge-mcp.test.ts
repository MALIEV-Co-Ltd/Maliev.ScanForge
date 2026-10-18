import { expect, it } from "vitest";
import {
  bridgePreviewResponse,
  validateBridgePreview,
} from "../src/automation/bridge-preview";
import type { CommandContext } from "../src/automation/api";
import { runScanEdit } from "../src/scan-edit";
import { connectBrowserBridge } from "../src/automation/browser-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// @ts-expect-error The independent Node bridge has no browser declaration.
import { createBridge, createMcpServer } from "../scripts/mcp-server.mjs";

const operation = {
  kind: "scanEdit",
  action: "fillHoles",
  mode: "bridge",
  indices: [0],
  start: 0,
  end: 2,
};

it("carries sequential official MCP calls through the negotiated browser bridge without poll sleeps", async () => {
  const token = "integration-token-with-at-least-thirty-two-characters";
  const bridge = await createBridge({ token, port: 0 });
  const server = createMcpServer(
    bridge,
    [
      {
        name: "project_get",
        description: "Read project",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
    "Agent guide",
  );
  const client = new Client({ name: "long-poll-integration", version: "1" });
  let connection: Awaited<ReturnType<typeof connectBrowserBridge>> | undefined;
  let calls = 0;
  try {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const browserFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Origin", "http://127.0.0.1:5173");
      return fetch(input, { ...init, headers });
    };
    connection = await connectBrowserBridge(
      {
        invoke: async () => ({
          ok: true,
          revision: ++calls,
          result: { name: "Project" },
        }),
        cancelActive: () => {},
      },
      `http://127.0.0.1:${bridge.port}`,
      token,
      () => {},
      browserFetch,
    );
    const started = Date.now();
    for (let revision = 1; revision <= 3; revision++)
      expect(
        await client.callTool({ name: "project_get", arguments: {} }),
      ).toMatchObject({
        isError: false,
        structuredContent: { ok: true, revision },
      });
    expect(calls).toBe(3);
    expect(Date.now() - started).toBeLessThan(1500);
  } finally {
    await connection?.disconnect();
    await client.close();
    await server.close();
    await bridge.close();
  }
});

it("accepts only explicit, single-boundary bridge previews", () => {
  expect(validateBridgePreview({ operation })).toBe(false);
  expect(validateBridgePreview({ previewOnly: false, operation })).toBe(false);
  expect(validateBridgePreview({ previewOnly: true, operation })).toBe(true);
  for (const change of [
    { kind: "repair" },
    { action: "inventory" },
    { mode: "entire" },
    { indices: [] },
    { indices: [0, 1] },
    { indices: [-1] },
    { start: undefined },
    { end: undefined },
    { start: 0.5 },
    { end: 0 },
  ])
    expect(() =>
      validateBridgePreview({
        previewOnly: true,
        operation: { ...operation, ...change },
      }),
    ).toThrow(/preview/i);
  for (const field of ["createNew", "selectionOnly", "targetId", "targetIds"])
    expect(() =>
      validateBridgePreview({ previewOnly: true, operation, [field]: true }),
    ).toThrow(/preview/i);
});

it("accepts equal local edge indices on different boundaries and rejects malformed destination boundaries", () => {
  expect(
    validateBridgePreview({
      previewOnly: true,
      operation: { ...operation, endBoundary: 1, end: 0 },
    }),
  ).toBe(true);
  for (const endBoundary of [-1, 0.5, Infinity, "1"])
    expect(() =>
      validateBridgePreview({
        previewOnly: true,
        operation: { ...operation, endBoundary },
      }),
    ).toThrow(/preview/i);
});

const vertices = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];
const source = new Float32Array(
  faces.flatMap((face) => face.flatMap((id) => vertices[id])),
);

it("returns the shared geometry result as a patch artifact without editing source or history", () => {
  const before = source.slice();
  const edit = runScanEdit({
    ...operation,
    kind: "scanEdit",
    action: "fillHoles",
    mode: "bridge",
    algorithm: "flat",
    positions: source,
  });
  let payload = "";
  const context: CommandContext = {
    signal: new AbortController().signal,
    progress() {},
    check() {},
    mutate() {
      throw new Error("Preview must not mutate history");
    },
    artifact(data, name, mime) {
      expect(typeof data).toBe("string");
      payload = data as string;
      return { artifactId: "preview", bytes: payload.length, name, mime };
    },
    artifactBlob() {
      throw new Error("No input artifact required");
    },
  };
  const preview = bridgePreviewResponse(
    source,
    { kind: "scanEdit", scanEdit: edit, diagnostics: {} },
    context,
  );
  const patch = JSON.parse(payload);
  expect(preview.preview).toBe(true);
  expect(preview.sourceTriangleCount).toBe(source.length / 9);
  expect(preview.diagnostics).toEqual(edit.diagnostics);
  expect(preview.artifact.mime).toBe("application/json");
  expect(patch.positions).toEqual(
    Array.from(edit.positions!.slice(source.length)),
  );
  expect(patch.positions.length / 9).toBe(edit.diagnostics.addedTriangles);
  expect(patch.diagnostics.method).toBe("flat");
  expect(source).toEqual(before);
  expect(() =>
    bridgePreviewResponse(
      source,
      {
        kind: "scanEdit",
        scanEdit: { diagnostics: { filledHoles: 0 } },
        diagnostics: {},
      },
      context,
    ),
  ).toThrow(/preview/i);
  const changed = edit.positions!.slice();
  changed[0] += 1;
  expect(() =>
    bridgePreviewResponse(
      source,
      {
        kind: "scanEdit",
        scanEdit: { ...edit, positions: changed },
        diagnostics: {},
      },
      context,
    ),
  ).toThrow(/source/i);
});
