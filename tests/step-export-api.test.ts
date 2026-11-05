import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";

function setup() {
  const base = {
    name: "Object",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    color: "#ffffff",
    opacity: 1,
    visible: true,
  };
  const state: WorkspaceSnapshot = {
    name: "Export",
    entities: [
      { ...base, id: "scan", kind: "mesh" },
      { ...base, id: "exact", kind: "cad", kernelId: "exact-native" },
      {
        ...base,
        id: "hidden",
        kind: "cad",
        kernelId: "hidden-native",
        visible: false,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const exportStep = vi.fn(async () =>
    new TextEncoder().encode("ISO-10303-21; exact STEP"),
  );
  const host = {
    snapshot: () => state,
    cad: () => ({ exportStep }),
    busy: () => false,
    activity: vi.fn(),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createOperations(host));
  return { api, state, exportStep };
}
async function run(api: ApplicationApi, args: Record<string, unknown>) {
  const receipt = await api.invoke("project_export", args);
  if (!receipt.ok) return { status: "rejected", error: receipt.error };
  const jobId = (receipt.result as { jobId: string }).jobId;
  for (let i = 0; i < 100; i++) {
    const response = await api.invoke("job_get", { jobId });
    if (!response.ok) throw Error(response.error.message);
    const job = response.result as any;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Export did not settle");
}
it("retains strict STEP defaults and exposes the GUI's explicit exact-only subset without mutation", async () => {
  const h = setup(),
    revision = h.api.currentRevision();
  try {
    expect(await run(h.api, { format: "step" })).toMatchObject({
      status: "failed",
      error: {
        message: "STEP export requires exact CAD for every exported object.",
      },
    });
    expect(h.exportStep).not.toHaveBeenCalled();
    const job = await run(h.api, { format: "step", cadOnly: true });
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({
      name: "Export.step",
      mime: "application/step",
      excludedEntityIds: ["scan"],
    });
    expect(h.exportStep).toHaveBeenLastCalledWith(["exact-native"]);
    const local = h.api.readArtifactBlob(job.result.artifactId);
    expect(await local.text()).toBe("ISO-10303-21; exact STEP");
    const remote = await h.api.invoke("artifact_read", {
      artifactId: job.result.artifactId,
    });
    expect(remote.ok && (remote.result as any).base64).toBe(
      btoa(await local.text()),
    );
    await h.api.invoke("artifact_delete", {
      artifactId: job.result.artifactId,
    });
    expect(() => h.api.readArtifactBlob(job.result.artifactId)).toThrow(
      /expired|not found/,
    );
    expect(await local.text()).toBe("ISO-10303-21; exact STEP");
    const all = await run(h.api, {
      format: "step",
      visible: false,
      cadOnly: true,
    });
    expect(all.status).toBe("succeeded");
    expect(h.exportStep).toHaveBeenLastCalledWith([
      "exact-native",
      "hidden-native",
    ]);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.state.history).toEqual([]);
    h.api.dispose();
    expect(() => h.api.readArtifactBlob(all.result.artifactId)).toThrow(
      /closed|disposed/,
    );
  } finally {
    h.api.dispose();
  }
});
it("rejects empty exact export and cadOnly on other formats before kernel work", async () => {
  const h = setup();
  try {
    h.state.entities = h.state.entities.filter((e) => e.kind === "mesh");
    expect(await run(h.api, { format: "step", cadOnly: true })).toMatchObject({
      status: "failed",
      error: { message: "STEP export requires at least one exact CAD object." },
    });
    for (const format of ["stl", "project"])
      expect(await run(h.api, { format, cadOnly: true })).toMatchObject({
        status: "failed",
        error: { message: "cadOnly is supported only for STEP export." },
      });
    expect(h.exportStep).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});
