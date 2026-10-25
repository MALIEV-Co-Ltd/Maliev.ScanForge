import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";

const storage = vi.hoisted(() => ({ stage: vi.fn() }));
vi.mock("../src/transient-blob-storage", () => ({
  DISK_BLOB_BLOCK_BYTES: 1,
  diskBackedBlob: storage.stage,
}));

type Artifact = { artifactId: string; name: string; bytes: number };
let api: ApplicationApi;
function success<T>(result: ApiResult): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  return result.result as T;
}
beforeEach(() => {
  storage.stage.mockReset().mockImplementation(async (blob: Blob) => blob);
  const state: WorkspaceSnapshot = {
    name: "Staging lifecycle",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const unexpected = () => {
    throw Error("Artifact staging must not mutate geometry");
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
      context.artifact(
        new Blob(["Q"]),
        "upload.bin",
        "application/octet-stream",
      ),
  });
});
afterEach(() => {
  api.dispose();
  vi.useRealTimers();
});
async function initial() {
  return success<Artifact>(
    await api.invoke("object_get", { entityId: "staging-fixture" }),
  );
}
function append(artifact: Artifact, base64 = "Ug==") {
  return api.invoke("artifact_put", {
    artifactId: artifact.artifactId,
    name: artifact.name,
    offset: 1,
    base64,
  });
}
function pause() {
  let release!: () => void;
  storage.stage.mockImplementationOnce(
    (blob: Blob) =>
      new Promise<Blob>((resolve) => {
        release = () => resolve(blob);
      }),
  );
  return () => release();
}
async function contents(artifact: Artifact) {
  return success<{ base64: string }>(
    await api.invoke("artifact_read", { artifactId: artifact.artifactId }),
  ).base64;
}
it("does not resurrect an upload deleted while storage is pending", async () => {
  const artifact = await initial(),
    release = pause(),
    pending = append(artifact);
  success(
    await api.invoke("artifact_delete", { artifactId: artifact.artifactId }),
  );
  release();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  expect(
    success<{ artifacts: Artifact[] }>(await api.invoke("session_get"))
      .artifacts,
  ).toEqual([]);
});
it("keeps the winning append when a concurrent append settles later", async () => {
  const artifact = await initial(),
    release = pause(),
    first = append(artifact);
  const winner = success<Artifact>(await append(artifact, "Uw=="));
  expect(winner.bytes).toBe(2);
  release();
  expect(await first).toMatchObject({
    ok: false,
    error: { code: "UPLOAD_CONFLICT" },
  });
  expect(await contents(artifact)).toBe("UVM=");
});
it("rejects completion after API disposal", async () => {
  const artifact = await initial(),
    release = pause(),
    pending = append(artifact);
  api.dispose();
  release();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "DISCONNECTED" },
  });
});
it("does not revive an upload that expires while storage is pending", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const artifact = await initial(),
    release = pause(),
    pending = append(artifact);
  vi.setSystemTime(1_900_001);
  release();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  expect(
    success<{ artifacts: Artifact[] }>(await api.invoke("session_get"))
      .artifacts,
  ).toEqual([]);
});
it("preserves existing bytes on a rejected storage transaction", async () => {
  const artifact = await initial();
  storage.stage.mockRejectedValueOnce(new Error("Storage quota unavailable"));
  expect(await append(artifact)).toMatchObject({
    ok: false,
    error: { code: "OPERATION_FAILED" },
  });
  expect(await contents(artifact)).toBe("UQ==");
});
