import { afterEach, expect, it, vi } from "vitest";
import { decodeProjectInBackground } from "../src/project-decoding-client";
import { projectEncodingSnapshot } from "../src/project-encoding-snapshot";
import { packProjectTransport } from "../src/project-transport";
import { prepareScanRenderData, scanRenderData } from "../src/scan-render-data";
import type { ProjectSession } from "../src/project-file";
import type { Entity } from "../src/types";
import { transformDatumScan } from "../src/datum-alignment";
import { cloudPlacement } from "../src/point-cloud-placement";
const entity = (): Entity => ({
  id: "mesh",
  name: "mesh",
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  visible: true,
  opacity: 1,
  color: "#aaa",
});
class DecodeWorker {
  static all: DecodeWorker[] = [];
  static hold = false;
  static bad = false;
  static cloud = false;
  static largePositions: number[] | undefined;
  terminated = false;
  input: any;
  onmessage?: ({ data }: { data: any }) => void;
  onerror?: ({ message }: { message: string }) => void;
  constructor() {
    DecodeWorker.all.push(this);
  }
  postMessage(input: any) {
    this.input = input;
    if (!DecodeWorker.hold) void this.finish();
  }
  async finish() {
    if (this.terminated) return;
    if (DecodeWorker.bad) {
      this.onmessage?.({ data: { packet: {} } });
      return;
    }
    let e = entity();
    if (DecodeWorker.largePositions)
      e = { ...e, positions: DecodeWorker.largePositions.slice() };
    if (DecodeWorker.cloud)
      e = transformDatumScan(
        { ...e, kind: "pointcloud" },
        [1, 0, 0, 3, 0, 1, 0, 4, 0, 0, 1, 5],
      );
    const session: ProjectSession = {
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Restored",
        entities: [e],
      },
      history: [],
      future: [{ label: "Future", entities: [e] }],
    };
    const displays =
      DecodeWorker.cloud || DecodeWorker.largePositions
        ? []
        : [
            {
              positions: e.positions,
              data: prepareScanRenderData(e.positions as Float32Array),
            },
          ];
    const transport = await packProjectTransport({
      snapshot: projectEncodingSnapshot(session),
      displays,
    });
    this.onmessage?.({
      data: {
        packet: structuredClone(transport.packet, {
          transfer: transport.transfers,
        }),
      },
    });
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  DecodeWorker.all = [];
  DecodeWorker.hold = false;
  DecodeWorker.bad = false;
  DecodeWorker.cloud = false;
  DecodeWorker.largePositions = undefined;
});
it("restores independent numeric geometry while retaining project history aliases", async () => {
  vi.stubGlobal("Worker", DecodeWorker);
  const earlierOwner = Array.from({ length: 65538 }, (_, i) => i + 1);
  DecodeWorker.largePositions = earlierOwner;
  const restored = await decodeProjectInBackground(new Blob());
  const geometry = restored.project.entities[0].positions;
  expect(restored.future[0].entities[0].positions).toBe(geometry);
  earlierOwner[0] = 999;
  expect(geometry[0]).toBe(1);
});
it("returns a validated prepared snapshot with retained history and cached geometry identity", async () => {
  vi.stubGlobal("Worker", DecodeWorker);
  const file = new Blob(["fixture"]),
    s = await decodeProjectInBackground(file),
    e = s.project.entities[0];
  expect(s.project.name).toBe("Restored");
  expect(s.future[0].entities[0].positions).toBe(e.positions);
  expect(scanRenderData(e.positions)?.normals).toEqual(
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  );
  expect(DecodeWorker.all[0].terminated).toBe(true);
  expect(DecodeWorker.all[0].input.file).toBe(file);
});
it("restores native cloud accessors and Double placement across the worker boundary", async () => {
  vi.stubGlobal("Worker", DecodeWorker);
  DecodeWorker.cloud = true;
  const s = await decodeProjectInBackground(new Blob()),
    e = s.project.entities[0];
  expect(cloudPlacement(e)).toBeDefined();
  expect(Array.from(e.positions).slice(0, 3)).toEqual([3, 4, 5]);
  expect(s.future[0].entities[0].pointCloudPlacement).toBe(
    e.pointCloudPlacement,
  );
});
it("cancels a running decoder and releases it without publishing any project", async () => {
  vi.stubGlobal("Worker", DecodeWorker);
  DecodeWorker.hold = true;
  const controller = new AbortController(),
    pending = decodeProjectInBackground(new Blob(), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(DecodeWorker.all).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(DecodeWorker.all[0].terminated).toBe(true);
});
it("rejects malformed data and admits the next request", async () => {
  vi.stubGlobal("Worker", DecodeWorker);
  DecodeWorker.bad = true;
  await expect(decodeProjectInBackground(new Blob())).rejects.toThrow();
  DecodeWorker.bad = false;
  expect(
    (await decodeProjectInBackground(new Blob())).project.entities,
  ).toHaveLength(1);
  expect(DecodeWorker.all.every((w) => w.terminated)).toBe(true);
});
it("does not run synchronous decoding when browser workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  await expect(decodeProjectInBackground(new Blob())).rejects.toThrow(
    /worker/i,
  );
});
it("releases a blocked decoder after the two-minute lease", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", DecodeWorker);
  DecodeWorker.hold = true;
  const pending = decodeProjectInBackground(new Blob()),
    rejected = expect(pending).rejects.toThrow(/lease/);
  await vi.advanceTimersByTimeAsync(120001);
  await rejected;
  expect(DecodeWorker.all[0].terminated).toBe(true);
});
