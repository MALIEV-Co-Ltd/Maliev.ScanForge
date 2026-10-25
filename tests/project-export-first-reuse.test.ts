import { afterEach, expect, it, vi } from "vitest";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
  type ProjectSharedChunk,
} from "../src/project-file-codec";
import { projectValueHash } from "../src/project-value-stream";

function session(positions: Float32Array): ProjectSession {
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      name: "First restore",
      units: "mm",
      entities: [
        {
          id: "cloud",
          name: "Original cloud",
          kind: "pointcloud",
          positions,
          color: "#aaaaaa",
          visible: true,
          opacity: 1,
        },
      ],
    },
    history: [],
    future: [],
  };
}
function shared() {
  const result = new Float32Array(new SharedArrayBuffer(24));
  result.set([1, 2, 3, -0, 5, 6]);
  return result;
}
const encode = encodeProjectFileLocally as (
  value: ProjectSession,
  options: { onSharedChunk: (chunk: ProjectSharedChunk) => void },
) => Promise<Blob>;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../src/transient-blob-storage");
  vi.resetModules();
});

it("keeps the live session's original SAB wrapper reusable after real worker structured clones", async () => {
  vi.resetModules();
  const positions = shared(),
    original = positions.buffer;
  class ReachableWeakRef {
    constructor(private value: object) {}
    deref() {
      return this.value instanceof SharedArrayBuffer && this.value !== original
        ? undefined
        : this.value;
    }
  }
  vi.stubGlobal("WeakRef", ReachableWeakRef);
  const requests: { reusableChunks?: ProjectSharedChunk[] }[] = [];
  let encoder: CloneWorker;
  const scope = {
    onmessage: undefined as unknown as (event: { data: any }) => Promise<void>,
    postMessage: (reply: unknown) =>
      queueMicrotask(() =>
        encoder.onmessage?.({ data: structuredClone(reply) }),
      ),
  };
  vi.stubGlobal("self", scope);
  await import("../src/project-encoding-worker");
  class CloneWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(private url: URL) {}
    postMessage(request: any) {
      if (!String(this.url).includes("project-encoding-worker")) {
        requests.push(request);
        queueMicrotask(() =>
          this.onmessage?.({ data: { error: "decoder observed" } }),
        );
        return;
      }
      const workerRequest = structuredClone(request);
      const workerPositions =
        workerRequest.session.project.entities[0].positions;
      expect(workerPositions.buffer).not.toBe(original);
      const sources: SharedArrayBuffer[] | undefined =
        workerRequest.sharedChunkSources;
      if (sources) expect(sources[0]).toBe(workerPositions.buffer);
      encoder = this;
      void scope.onmessage({ data: workerRequest });
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", CloneWorker);
  const { encodeProjectInBackground } =
    await import("../src/project-encoding-client");
  const { decodeProjectInBackground } =
    await import("../src/project-decoding-client");
  await encodeProjectInBackground(session(positions));
  await expect(decodeProjectInBackground(new Blob())).rejects.toThrow(
    "decoder observed",
  );
  expect(requests[0].reusableChunks).toHaveLength(1);
  expect(requests[0].reusableChunks![0].buffer).toBe(original);
});

it("never publishes a file or source token for a nonfinite shared payload", async () => {
  vi.resetModules();
  const replies: any[] = [];
  const scope = {
    onmessage: undefined as unknown as (event: { data: any }) => Promise<void>,
    postMessage: (reply: unknown) => replies.push(reply),
  };
  vi.stubGlobal("self", scope);
  await import("../src/project-encoding-worker");
  const { projectEncodingSnapshot } =
    await import("../src/project-encoding-snapshot");
  const { projectEncodingChunkSources } =
    await import("../src/project-encoding-chunks");
  const positions = shared();
  positions[0] = NaN;
  const snapshot = projectEncodingSnapshot(session(positions));
  const sharedChunkSources = projectEncodingChunkSources(snapshot);
  expect(sharedChunkSources).toEqual([positions.buffer]);
  await scope.onmessage({
    data: structuredClone({ ...snapshot, sharedChunkSources }),
  });
  expect(replies).toHaveLength(1);
  expect(replies[0].error).toMatch(/finite/);
  expect(replies[0].file).toBeUndefined();
  expect(replies[0].sharedChunkTokens).toBeUndefined();
});

it("borrows still-live original geometry on the first decode after encoding without a preceding decode", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = shared(),
    chunks: ProjectSharedChunk[] = [];
  const before = positions.slice();
  const file = await encode(session(positions), {
    onSharedChunk: (chunk) => chunks.push(chunk),
  });
  expect(chunks).toHaveLength(1);
  expect(chunks[0].buffer).toBe(positions.buffer);
  const reopened = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    reusableChunks: chunks,
  });
  expect((reopened.project.entities[0].positions as Float32Array).buffer).toBe(
    positions.buffer,
  );
  expect(positions).toEqual(before);
});

it.each(["ordinary", "subview"])(
  "does not advertise %s backing as a complete canonical shared chunk",
  async (kind) => {
    const positions =
      kind === "ordinary"
        ? new Float32Array([1, 2, 3])
        : new Float32Array(new SharedArrayBuffer(24), 12, 3);
    positions.set([1, 2, 3]);
    const chunks: ProjectSharedChunk[] = [];
    await encode(session(positions), {
      onSharedChunk: (chunk) => chunks.push(chunk),
    });
    expect(chunks).toEqual([]);
  },
);

it("excludes noncanonical binary types and preserves the bounded weak registry", async () => {
  const {
    encodedProjectSharedChunk,
    rememberProjectSharedChunks,
    reusableProjectSharedChunks,
    validateProjectSharedChunks,
  } = await import("../src/project-shared-chunks");
  const positions = shared();
  expect(
    encodedProjectSharedChunk(
      positions,
      "u32",
      projectValueHash(positions, "u32"),
    ),
  ).toBeUndefined();
  expect(
    encodedProjectSharedChunk(
      positions,
      "f64",
      projectValueHash(positions, "f64"),
    ),
  ).toBeUndefined();
  positions[0] = NaN;
  expect(
    encodedProjectSharedChunk(
      positions,
      "f32",
      projectValueHash(positions, "f32"),
    ),
  ).toBeUndefined();
  expect(() =>
    validateProjectSharedChunks([
      { sha256: "invalid", buffer: positions.buffer },
    ]),
  ).toThrow();
  const owned = Array.from({ length: 129 }, (_, i) => ({
    sha256: i.toString(16).padStart(64, "0"),
    buffer: new SharedArrayBuffer(4),
  }));
  rememberProjectSharedChunks(owned);
  expect(reusableProjectSharedChunks()).toHaveLength(128);
  expect(reusableProjectSharedChunks()[0].buffer).toBe(owned[1].buffer);
});

it("clears only weak backing references on pagehide and fences active and queued restores", async () => {
  vi.resetModules();
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  const references: { deref: () => SharedArrayBuffer | undefined }[] = [];
  class WeakReferenceDouble {
    constructor(private value: SharedArrayBuffer) {
      references.push(this);
    }
    deref(): SharedArrayBuffer | undefined {
      return this.value;
    }
  }
  vi.stubGlobal("WeakRef", WeakReferenceDouble);
  const registry = await import("../src/project-shared-chunks");
  const candidate = {
    sha256: "a".repeat(64),
    buffer: shared().buffer as SharedArrayBuffer,
  };
  registry.rememberProjectSharedChunks([candidate]);
  expect(references).toHaveLength(1);
  expect(registry.reusableProjectSharedChunks()[0].buffer).toBe(
    candidate.buffer,
  );
  references[0].deref = () => undefined;
  expect(registry.reusableProjectSharedChunks()).toEqual([]);
  registry.rememberProjectSharedChunks([candidate]);
  expect(() =>
    registry.rememberProjectSharedChunks(
      registry.validateProjectSharedChunks([
        candidate,
        { ...candidate, sha256: "invalid" },
      ]),
    ),
  ).toThrow();
  expect(references).toHaveLength(2);
  let launched = 0,
    terminated = 0;
  class HeldWorker {
    constructor() {
      launched++;
    }
    postMessage() {}
    terminate() {
      terminated++;
    }
  }
  vi.stubGlobal("Worker", HeldWorker);
  const { decodeProjectInBackground } =
    await import("../src/project-decoding-client");
  const active = decodeProjectInBackground(new Blob()),
    queued = decodeProjectInBackground(new Blob());
  const results = Promise.all([
    expect(active).rejects.toMatchObject({ name: "AbortError" }),
    expect(queued).rejects.toMatchObject({ name: "AbortError" }),
  ]);
  await Promise.resolve();
  expect(launched).toBe(1);
  events.dispatchEvent(new Event("pagehide"));
  await results;
  expect(registry.reusableProjectSharedChunks()).toEqual([]);
  expect(launched).toBe(1);
  expect(terminated).toBe(1);
});

it.each(["success", "storage-failure", "cancel-during-storage"])(
  "publishes first-export candidates only after successful storage: %s",
  async (mode) => {
    vi.resetModules();
    const positions = shared();
    const candidate = {
      sha256: projectValueHash(positions, "f32").sha256,
      buffer: positions.buffer as SharedArrayBuffer,
    };
    let finishStorage!: (file: Blob) => void;
    const storageEntered = new Promise<void>((resolveEntered) => {
      vi.doMock("../src/transient-blob-storage", () => ({
        diskBackedBlob: (file: Blob) => {
          resolveEntered();
          if (mode === "storage-failure")
            return Promise.reject(Error("disk failure"));
          if (mode === "cancel-during-storage")
            return new Promise<Blob>((resolve) => {
              finishStorage = resolve;
            });
          return Promise.resolve(file);
        },
      }));
    });
    const decoderInputs: { reusableChunks?: ProjectSharedChunk[] }[] = [];
    class WorkerDouble {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      constructor(private url: URL) {}
      postMessage(value: { reusableChunks?: ProjectSharedChunk[] }) {
        if (String(this.url).includes("project-encoding-worker")) {
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                file: new Blob(["encoded"]),
                sharedChunkTokens: [
                  { sha256: candidate.sha256, sourceToken: 0 },
                ],
              },
            }),
          );
        } else {
          decoderInputs.push(value);
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                error: "intentional decoder stop after input observation",
              },
            }),
          );
        }
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerDouble);
    const { encodeProjectInBackground } =
      await import("../src/project-encoding-client");
    const { decodeProjectInBackground } =
      await import("../src/project-decoding-client");
    const controller = new AbortController();
    const encoded = encodeProjectInBackground(
      session(positions),
      controller.signal,
    );
    if (mode === "cancel-during-storage") {
      await storageEntered;
      controller.abort();
      await expect(encoded).rejects.toThrow(/cancelled/i);
      finishStorage(new Blob(["late encoded"]));
      await Promise.resolve();
      await Promise.resolve();
    } else if (mode === "storage-failure")
      await expect(encoded).rejects.toThrow("disk failure");
    else await encoded;
    await expect(
      decodeProjectInBackground(new Blob(["probe"])),
    ).rejects.toThrow("intentional decoder stop");
    expect(decoderInputs).toHaveLength(1);
    expect(decoderInputs[0].reusableChunks).toHaveLength(
      mode === "success" ? 1 : 0,
    );
    if (mode === "success")
      expect(decoderInputs[0].reusableChunks![0].buffer).toBe(positions.buffer);
  },
);

it("rejects a sparse worker response before storage and preserves the weak registry atomically", async () => {
  vi.resetModules();
  let storageCalls = 0;
  vi.doMock("../src/transient-blob-storage", () => ({
    diskBackedBlob: () => {
      storageCalls++;
      return new Promise<Blob>(() => {});
    },
  }));
  const registry = await import("../src/project-shared-chunks");
  const existing = {
    sha256: "a".repeat(64),
    buffer: new SharedArrayBuffer(4),
  };
  registry.rememberProjectSharedChunks([existing]);
  class SparseWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    postMessage() {
      const malformed = new Array(2);
      malformed[0] = {
        sha256: "b".repeat(64),
        sourceToken: 0,
      };
      queueMicrotask(() =>
        this.onmessage?.({
          data: { file: new Blob(["encoded"]), sharedChunkTokens: malformed },
        }),
      );
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", SparseWorker);
  const { encodeProjectInBackground } =
    await import("../src/project-encoding-client");
  const controller = new AbortController();
  let error: Error | undefined;
  const outcome = encodeProjectInBackground(
    session(shared()),
    controller.signal,
  ).catch((failure: Error) => {
    error = failure;
  });
  try {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(error?.message).toMatch(/Invalid project encoding chunk token/);
    expect(storageCalls).toBe(0);
    expect(registry.reusableProjectSharedChunks()).toEqual([existing]);
  } finally {
    controller.abort();
    await outcome;
  }
});
