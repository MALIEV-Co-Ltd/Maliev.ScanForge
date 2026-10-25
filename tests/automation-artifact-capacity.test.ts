import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as diskStorage from "../src/transient-blob-storage";
import {
  ApplicationApi,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";

const MiB = 1024 * 1024;
const NativeBlob = Blob;
const realBackings = new WeakMap<Blob, Blob>();

// Policy-only large sizes: backing bytes stay tiny. Real full-file browser
// acceptance is separate; this double also preserves size during replacement.
class LogicalBlob extends NativeBlob {
  constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
    // Never pass a logical size to the native constructor: its backing remains
    // an actual tiny Blob, including when appending to a logical large upload.
    const backing = new NativeBlob(
      parts.map((part) =>
        part instanceof NativeBlob ? (realBackings.get(part) ?? part) : part,
      ),
      options,
    );
    super([backing], options);
    realBackings.set(this, backing);
    const size = parts.reduce(
      (total, part) =>
        total +
        (part instanceof NativeBlob ? part.size : new NativeBlob([part]).size),
      0,
    );
    Object.defineProperty(this, "size", { value: size, configurable: true });
  }
}
function logicalBlob(bytes: number) {
  const blob = new LogicalBlob(["Q"]);
  Object.defineProperty(blob, "size", { value: bytes });
  return blob;
}
function success<T>(wire: ApiResult): T {
  expect(wire.ok).toBe(true);
  if (!wire.ok) throw Error(wire.error.message);
  return wire.result as T;
}
type Artifact = { artifactId: string; name: string; bytes: number };
let api: ApplicationApi;
let nextBlob: Blob;
let nextName: string;
beforeEach(() => {
  vi.stubGlobal("Blob", LogicalBlob);
  const state: WorkspaceSnapshot = {
    name: "Artifact policy",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const unexpected = () => {
    throw Error("Resource tests must not mutate the workspace");
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: unexpected,
    commit: unexpected,
    replace: unexpected,
    select: unexpected,
    setSelection: unexpected,
    setSketch: unexpected,
    undo: unexpected,
    redo: unexpected,
    view: unexpected,
    settings: unexpected,
    busy: () => false,
    activity: unexpected,
  };
  api = new ApplicationApi(host, {
    object_get: (_args, context) =>
      context.artifact(nextBlob, nextName, "application/octet-stream"),
  });
});
afterEach(() => {
  api?.dispose();
  vi.unstubAllGlobals();
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
async function store(bytes: number, name = "output.bin") {
  nextBlob = logicalBlob(bytes);
  nextName = name;
  return api.invoke("object_get", { entityId: "resource-fixture" });
}
async function artifacts() {
  return success<{ artifacts: Artifact[] }>(await api.invoke("session_get"))
    .artifacts;
}
const append = (artifact: Artifact, offset: number, base64 = "Ug==") =>
  api.invoke("artifact_put", {
    artifactId: artifact.artifactId,
    name: artifact.name,
    offset,
    base64,
  });

it("preserves the previous upload when temporary disk storage fails at a large-block boundary", async () => {
  const original = success<Artifact>(await store(64 * MiB - 1, "upload.bin"));
  vi.stubGlobal("indexedDB", {
    open: () => {
      throw new Error("Temporary storage unavailable");
    },
  });
  expect(await append(original, original.bytes)).toMatchObject({
    ok: false,
    error: { code: "OPERATION_FAILED" },
  });
  expect((await artifacts())[0].bytes).toBe(original.bytes);
});

it("does not resurrect an upload deleted while a disk checkpoint is pending", async () => {
  const original = success<Artifact>(await store(64 * MiB - 1, "upload.bin"));
  let release!: () => void;
  const checkpoint = vi
    .spyOn(diskStorage, "diskBackedBlob")
    .mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          release = () => resolve(blob);
        }),
    );
  try {
    const pending = append(original, original.bytes);
    await api.invoke("artifact_delete", { artifactId: original.artifactId });
    release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await artifacts()).toEqual([]);
  } finally {
    checkpoint.mockRestore();
  }
});

it("rejects an obsolete checkpoint after a concurrent append succeeds", async () => {
  const original = success<Artifact>(await store(64 * MiB - 1, "upload.bin"));
  let release!: () => void;
  const checkpoint = vi
    .spyOn(diskStorage, "diskBackedBlob")
    .mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          release = () => resolve(blob);
        }),
    );
  try {
    const pending = append(original, original.bytes);
    const newer = success<Artifact>(
      await append(original, original.bytes, "Uw=="),
    );
    release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "UPLOAD_CONFLICT" },
    });
    expect((await artifacts())[0]).toMatchObject(newer);
  } finally {
    checkpoint.mockRestore();
  }
});

it("admits an 80 MiB completed artifact using logical metadata without a large backing allocation", async () => {
  const artifact = success<Artifact>(await store(80 * MiB));
  expect(artifact.bytes).toBe(80 * MiB);
  expect(await artifacts()).toHaveLength(1);
});

it("admits a full-size aligned project larger than 512 MiB", async () => {
  const artifact = success<Artifact>(
    await store(736091936, "three-scans.scanforge"),
  );
  expect(artifact.bytes).toBe(736091936);
  const retained = await artifacts();
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject(artifact);
});

it("admits exactly 1 GiB aggregate and rejects one additional byte without losing prior artifacts", async () => {
  const a = success<Artifact>(await store(512 * MiB, "first.bin"));
  const b = success<Artifact>(await store(512 * MiB, "second.bin"));
  expect(await store(1, "excess.bin")).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(
    (await artifacts()).map(({ artifactId, bytes }) => ({ artifactId, bytes })),
  ).toEqual([
    { artifactId: a.artifactId, bytes: 512 * MiB },
    { artifactId: b.artifactId, bytes: 512 * MiB },
  ]);
});

it("counts append replacement once and preserves the exact previous artifact when the next byte exceeds capacity", async () => {
  const original = success<Artifact>(await store(512 * MiB, "upload.bin"));
  success<Artifact>(await store(512 * MiB - 1, "other.bin"));
  const replaced = success<Artifact>(await append(original, original.bytes));
  expect(replaced).toMatchObject({
    artifactId: original.artifactId,
    bytes: 512 * MiB + 1,
  });
  expect(await append(replaced, replaced.bytes)).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(await append(replaced, replaced.bytes - 1)).toMatchObject({
    ok: false,
    error: { code: "UPLOAD_CONFLICT" },
  });
  expect(
    success<{ bytes: number; base64: string }>(
      await api.invoke("artifact_read", {
        artifactId: replaced.artifactId,
        offset: 0,
        length: 2,
      }),
    ),
  ).toMatchObject({ bytes: replaced.bytes, base64: "UVI=" });
  expect((await artifacts()).reduce((sum, item) => sum + item.bytes, 0)).toBe(
    1024 * MiB,
  );
});

it("releases deleted artifact capacity for a new large output", async () => {
  const a = success<Artifact>(await store(512 * MiB, "first.bin"));
  success<Artifact>(await store(512 * MiB, "second.bin"));
  success(await api.invoke("artifact_delete", { artifactId: a.artifactId }));
  expect(
    await api.invoke("artifact_read", { artifactId: a.artifactId }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  success<Artifact>(await store(80 * MiB, "replacement.bin"));
  expect((await artifacts()).reduce((sum, item) => sum + item.bytes, 0)).toBe(
    592 * MiB,
  );
});

it("retains the 64-handle limit while permitting replacement at that boundary", async () => {
  const handles: Artifact[] = [];
  for (let n = 0; n < 64; n++)
    handles.push(success<Artifact>(await store(1, `item-${n}.bin`)));
  expect(await artifacts()).toHaveLength(64);
  success<Artifact>(await append(handles[0], 1));
  expect(await artifacts()).toHaveLength(64);
  expect(await store(1, "sixty-fifth.bin")).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  success(
    await api.invoke("artifact_delete", { artifactId: handles[1].artifactId }),
  );
  success<Artifact>(await store(1, "after-delete.bin"));
  expect(await artifacts()).toHaveLength(64);
});

it("rejects append to an expired artifact instead of reviving its old Blob", async () => {
  vi.useFakeTimers();
  const artifact = success<Artifact>(await store(1));
  await vi.advanceTimersByTimeAsync(900001);
  expect(await append(artifact, 1)).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  expect(await artifacts()).toEqual([]);
});

it("preserves the 900-second lease boundary for a timely append", async () => {
  vi.useFakeTimers();
  const artifact = success<Artifact>(await store(1));
  await vi.advanceTimersByTimeAsync(900000);
  expect(success<Artifact>(await append(artifact, 1)).bytes).toBe(2);
  await vi.advanceTimersByTimeAsync(900000);
  expect(
    success<{ base64: string }>(
      await api.invoke("artifact_read", {
        artifactId: artifact.artifactId,
        offset: 0,
        length: 2,
      }),
    ).base64,
  ).toBe("UVI=");
});

it("still rejects upload chunks larger than one MiB and preserves the existing upload", async () => {
  const artifact = success<Artifact>(await store(1, "upload.bin"));
  const chunk = Buffer.alloc(MiB + 1).toString("base64");
  expect(await append(artifact, 1, chunk)).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(
    success<{ bytes: number; base64: string }>(
      await api.invoke("artifact_read", {
        artifactId: artifact.artifactId,
        offset: 0,
        length: 1,
      }),
    ),
  ).toMatchObject({ bytes: 1, base64: "UQ==" });
});

it("publishes byte, handle, chunk and lease limits through capabilities", async () => {
  expect(
    success<{ limits: unknown }>(await api.invoke("capabilities_get")).limits,
  ).toMatchObject({
    artifactBytes: 1024 * MiB,
    artifactCount: 64,
    artifactChunkBytes: MiB,
    artifactLeaseSeconds: 900,
  });
});

it("encodes a complete read chunk without allocating one string node per byte", async () => {
  const payload = Uint8Array.from({ length: 262144 }, (_, i) => i & 255);
  nextBlob = new LogicalBlob([payload]);
  nextName = "all-byte-values.bin";
  const artifact = success<Artifact>(
    await api.invoke("object_get", { entityId: "resource-fixture" }),
  );
  const convert = vi.spyOn(String, "fromCharCode");
  try {
    const result = success<{
      base64: string;
      nextOffset: number;
      eof: boolean;
    }>(
      await api.invoke("artifact_read", {
        artifactId: artifact.artifactId,
        offset: 0,
        length: payload.length,
      }),
    );
    expect(Buffer.from(result.base64, "base64")).toEqual(Buffer.from(payload));
    expect(result.nextOffset).toBe(payload.length);
    expect(result.eof).toBe(true);
    expect(convert.mock.calls.length).toBeLessThanOrEqual(32);
  } finally {
    convert.mockRestore();
  }
});
