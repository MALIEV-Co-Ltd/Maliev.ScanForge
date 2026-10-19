import type { GlobalQueryWorkerInit } from "./scan-global-query-worker";

type Carrier = Float32Array | Uint32Array | Uint8Array;

function carriers(input: GlobalQueryWorkerInit): Carrier[] {
  return input.scans.flatMap(({ geometry: g }) => [
    g.points,
    g.normals,
    ...(g.labels ? [g.labels] : []),
    ...(g.flags ? [g.flags] : []),
    ...(g.rawTargetIds ? [g.rawTargetIds] : []),
    ...(g.targetMeshes ?? []).flatMap((mesh) => [
      mesh.vertices,
      mesh.triangles,
      ...(mesh.flags ? [mesh.flags] : []),
    ]),
  ]);
}

const shared = (buffer: ArrayBufferLike) =>
  typeof SharedArrayBuffer !== "undefined" &&
  buffer instanceof SharedArrayBuffer;

/** Count physical backing storage, including unused bytes of subarray carriers.
 * Structured clone preserves aliases within one packet. Shared transport adds
 * one immutable copy of each ordinary backing; existing shared inputs add none.
 * This is input accounting only, not evaluator or whole-process admission. */
export function globalQueryInputBytes(
  input: GlobalQueryWorkerInit,
  workers: number,
  sharing: boolean,
) {
  const buffers = new Set(carriers(input).map((value) => value.buffer));
  let bytes = 0;
  for (const buffer of buffers)
    bytes +=
      buffer.byteLength * (shared(buffer) ? 1 : sharing ? 2 : workers + 1);
  return bytes;
}

/** Pool-owned immutable packet. No module cache retains copies after close.
 * Copy backing buffers once across the complete packet, preserving view offsets,
 * element types and aliases, including aliases between different scans. */
export function shareGlobalQueryInput(
  input: GlobalQueryWorkerInit,
): GlobalQueryWorkerInit {
  const buffers = new Map<ArrayBufferLike, SharedArrayBuffer>();
  const views = new Map<Carrier, Carrier>();
  const geometries = new Map<
    GlobalQueryWorkerInit["scans"][number]["geometry"],
    GlobalQueryWorkerInit["scans"][number]["geometry"]
  >();
  const share = <T extends Carrier>(value: T): T => {
    if (shared(value.buffer)) return value;
    const existing = views.get(value);
    if (existing) return existing as T;
    let buffer = buffers.get(value.buffer);
    if (!buffer) {
      buffer = new SharedArrayBuffer(value.buffer.byteLength);
      new Uint8Array(buffer).set(new Uint8Array(value.buffer));
      buffers.set(value.buffer, buffer);
    }
    const copy = new (
      value.constructor as {
        new (buffer: ArrayBufferLike, offset: number, length: number): T;
      }
    )(buffer, value.byteOffset, value.length);
    views.set(value, copy);
    return copy;
  };
  return {
    scans: input.scans.map((scan) => {
      let geometry = geometries.get(scan.geometry);
      if (!geometry) {
        const g = scan.geometry;
        geometry = {
          points: share(g.points),
          normals: share(g.normals),
          ...(g.labels ? { labels: share(g.labels) } : {}),
          ...(g.flags ? { flags: share(g.flags) } : {}),
          ...(g.rawTargetIds ? { rawTargetIds: share(g.rawTargetIds) } : {}),
          ...(g.targetMeshes
            ? {
                targetMeshes: g.targetMeshes.map((mesh) => ({
                  ...mesh,
                  vertices: share(mesh.vertices),
                  triangles: share(mesh.triangles),
                  ...(mesh.flags ? { flags: share(mesh.flags) } : {}),
                })),
              }
            : {}),
        };
        geometries.set(g, geometry);
      }
      return { id: scan.id, geometry };
    }),
  };
}

/** Ordinary caller backings remain live after a coordinator receives shared copies. */
export function globalQueryExternalInputBytes(input: GlobalQueryWorkerInit) {
  const buffers = new Set(carriers(input).map((value) => value.buffer));
  let bytes = 0;
  for (const buffer of buffers) if (!shared(buffer)) bytes += buffer.byteLength;
  return bytes;
}
