import type { Entity, Positions } from "./types";
import type { GlobalSceneInput } from "./scan-global-scene-worker";
import type {
  GlobalAlignmentPreparationPacket,
  GlobalAlignmentPreparationResponse,
  GlobalAlignmentPreparedMesh,
} from "./global-alignment-input-worker";
import { yieldScanTask } from "./scan-task";

export interface GlobalAlignmentCandidates {
  entityIds: string[];
  blocked: { id: string; reason: string }[];
  excluded: { id: string; reason: string }[];
  canPreview: boolean;
}
function unavailable(entity: Entity) {
  if (!entity.visible) return "The object is hidden.";
  if (entity.kind === "pointcloud")
    return "Global Fine Align requires triangle meshes; use N-points alignment for point clouds.";
  if (
    entity.kind !== "mesh" ||
    entity.kernelId ||
    entity.brep ||
    entity.parametric
  )
    return "Choose scan meshes; use origin/reference alignment for exact CAD.";
  if (entity.locked) return "Unlock the mesh before Global Fine Align.";
  if (entity.meshSelection?.hidden.length)
    return "Show all triangles before Global Fine Align.";
  if (!entity.positions.length || entity.positions.length % 9)
    return "Global Fine Align requires nonempty complete mesh facets.";
  return undefined;
}
/** Metadata only: opening the dialog never traverses scan coordinates. */
export function inspectGlobalAlignmentCandidates(
  entities: readonly Entity[],
  entityIds?: readonly string[],
): GlobalAlignmentCandidates {
  const result: GlobalAlignmentCandidates = {
    entityIds: [],
    blocked: [],
    excluded: [],
    canPreview: false,
  };
  const selected = entityIds === undefined ? undefined : new Set(entityIds);
  const seen = new Set<string>();
  if (selected && selected.size !== entityIds!.length)
    result.blocked.push({
      id: "",
      reason: "Global alignment object IDs must be unique.",
    });
  for (const entity of entities) {
    if (selected && !selected.has(entity.id)) continue;
    if (!entity.id || seen.has(entity.id)) {
      result.blocked.push({
        id: entity.id,
        reason: "Global alignment scene IDs must be unique and nonempty.",
      });
      continue;
    }
    seen.add(entity.id);
    const reason = unavailable(entity);
    if (reason) {
      const explicitlyScoped = !!selected;
      const rawVisibleMesh =
        entity.visible &&
        entity.kind === "mesh" &&
        !entity.kernelId &&
        !entity.brep &&
        !entity.parametric;
      (explicitlyScoped || rawVisibleMesh
        ? result.blocked
        : result.excluded
      ).push({ id: entity.id, reason });
    } else result.entityIds.push(entity.id);
  }
  for (const id of selected ?? [])
    if (!seen.has(id))
      result.blocked.push({
        id,
        reason: "Global alignment object was not found.",
      });
  result.canPreview =
    !result.blocked.length &&
    result.entityIds.length >= 2 &&
    result.entityIds.length <= 32;
  return result;
}
export interface GlobalAlignmentInputSummary {
  entityIds: string[];
  scanCount: number;
  vertices: number;
  triangles: number;
  searchTolerance: number;
  spacing: number;
  budget: number;
  mask: number;
  parallel: boolean;
  preparation: {
    physicalWorkers: number;
    reusedIndexedScans: number;
    indexedTriangleSoups: number;
    admission?: GlobalAlignmentInputAdmission;
  };
}
export interface GlobalAlignmentInputAdmission {
  limitBytes: number;
  retainedBytes: number;
  peakPreparationBytes: number;
  estimatedPeakBytes: number;
}
/** Native millimetre dialog storage is Float32, then absolute-valued and widened. */
export function normalizeGlobalSearchTolerance(value?: number): number {
  const entry = value === undefined ? 0.5 : value;
  if (
    typeof entry !== "number" ||
    !Number.isFinite(entry) ||
    !Number.isFinite(Math.fround(entry))
  )
    throw Error(
      "Global alignment search tolerance must be a finite Float32 number.",
    );
  return Math.abs(Math.fround(entry));
}
/** Metadata-only collective admission. Counts shared typed backing stores once.
 * The STL table allowance is an engine heap estimate, not a browser heap cap;
 * authored render buffers and downstream query indexes have separate owners.
 */
export function globalAlignmentInputAdmission(
  entities: readonly Entity[],
): GlobalAlignmentInputAdmission {
  const limitBytes = 512 * 1048576;
  const seen = new Set<ArrayBufferLike>();
  let retainedBytes = 0,
    peakPreparationBytes = 0,
    estimatedPeakBytes = 0;
  const carrier = (values: Positions | number[] | Uint32Array) => {
    if (values instanceof Float32Array || values instanceof Uint32Array) {
      if (seen.has(values.buffer)) return 0;
      seen.add(values.buffer);
      return values.buffer.byteLength;
    }
    // A conversion owns a distinct output even if the same authored JS array
    // appears twice; unlike typed carriers it cannot be borrowed directly.
    return values.length * 4;
  };
  for (const entity of entities) {
    const indexed = entity.indexedMesh;
    let scratch = 0;
    if (indexed) {
      retainedBytes += carrier(indexed.vertices) + carrier(indexed.triangles);
      if (indexed.normals) retainedBytes += carrier(indexed.normals);
      else {
        retainedBytes += indexed.vertices.length * 4;
        // Transferred clones remain live beside the borrowed originals and
        // normal output until the disposable worker response is released.
        scratch =
          indexed.vertices.length * 4 + indexed.triangles.length * 4 + 1048576;
      }
    } else {
      const bytes = entity.positions.length * 4;
      // Worst-case output keeps every corner: vertices + normals + indices.
      retainedBytes += (bytes * 7) / 3;
      // Seven coordinate streams cover copied input, native topology arrays,
      // trimmed output and normal output. Reserve 1024 bytes per corner for
      // the largest possible bucket's keys, linked entries and maps, plus tree.
      const workingPeak =
        bytes * 7 + (entity.positions.length / 3) * 1024 + 1048576;
      scratch = workingPeak - (bytes * 7) / 3;
    }
    peakPreparationBytes = Math.max(peakPreparationBytes, scratch);
    estimatedPeakBytes = Math.max(estimatedPeakBytes, retainedBytes + scratch);
    if (
      !Number.isSafeInteger(Math.ceil(estimatedPeakBytes)) ||
      estimatedPeakBytes > limitBytes
    )
      throw Error(
        "Global alignment collective input exceeds its 512 MiB preparation admission.",
      );
  }
  return {
    limitBytes,
    retainedBytes,
    peakPreparationBytes,
    estimatedPeakBytes,
  };
}
export interface GlobalAlignmentInputOptions {
  entityIds?: string[];
  searchTolerance?: number;
  parallel?: boolean;
  signal?: AbortSignal;
  check?: () => void;
  onProgress?: (fraction: number, stage: string) => void;
}
const CHUNK = 65536;
async function visit(
  length: number,
  check: () => void,
  fn: (first: number, end: number) => void,
) {
  for (let first = 0; first < length; first += CHUNK) {
    check();
    fn(first, Math.min(first + CHUNK, length));
    if (first + CHUNK < length) await yieldScanTask();
  }
  check();
}
async function floats(source: Positions, check: () => void, copy = false) {
  const out =
    !copy && source instanceof Float32Array
      ? source
      : new Float32Array(source.length);
  await visit(source.length, check, (first, end) => {
    for (let i = first; i < end; i++) {
      if (
        !Number.isFinite(source[i]) ||
        !Number.isFinite(Math.fround(source[i]))
      )
        throw Error("Global alignment requires finite Float32 geometry.");
      if (out !== source) out[i] = source[i];
    }
  });
  return out;
}
/** One finite-lived worker per necessary derivation, terminated before publishing its carriers. */
async function derive(
  packet: GlobalAlignmentPreparationPacket,
  signal: AbortSignal | undefined,
  check: () => void,
) {
  if (typeof Worker === "undefined")
    throw Error(
      "Global alignment topology and normal preparation requires browser workers.",
    );
  check();
  return new Promise<GlobalAlignmentPreparedMesh>((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const finish = (error?: Error, result?: GlobalAlignmentPreparedMesh) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(staleCheck);
      signal?.removeEventListener("abort", abort);
      worker?.terminate();
      worker = undefined;
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(
        new DOMException(
          "Global alignment preparation cancelled.",
          "AbortError",
        ),
      );
    const timer = setTimeout(
      () => finish(Error("Global alignment input preparation timed out.")),
      120_000,
    );
    const staleCheck = setInterval(() => {
      try {
        check();
      } catch (error) {
        finish(error instanceof Error ? error : Error(String(error)));
      }
    }, 100);
    try {
      worker = new Worker(
        new URL("./global-alignment-input-worker.ts", import.meta.url),
        { type: "module", name: "global-alignment-input" },
      );
      worker.onmessage = ({
        data,
      }: MessageEvent<GlobalAlignmentPreparationResponse>) => {
        try {
          check();
          if (!data || typeof data !== "object")
            throw Error("Invalid global alignment input worker response.");
          if ("error" in data) throw Error(data.error);
          const r = data.result;
          if (
            !r ||
            !(r.vertices instanceof Float32Array) ||
            !(r.triangles instanceof Uint32Array) ||
            !(r.normals instanceof Float32Array) ||
            r.normals.length !== r.vertices.length
          )
            throw Error("Invalid global alignment input worker buffers.");
          finish(undefined, r);
        } catch (error) {
          finish(error instanceof Error ? error : Error(String(error)));
        }
      };
      worker.onerror = (event) =>
        finish(Error(event.message || "Global alignment input worker failed."));
      worker.onmessageerror = () =>
        finish(
          Error("Global alignment input worker response could not be decoded."),
        );
      signal?.addEventListener("abort", abort, { once: true });
      check();
      worker.postMessage(
        packet,
        Object.values(packet).map((value) => value.buffer as ArrayBuffer),
      );
    } catch (error) {
      finish(error instanceof Error ? error : Error(String(error)));
    }
  });
}
export async function prepareGlobalAlignmentInput(
  entities: readonly Entity[],
  options: GlobalAlignmentInputOptions = {},
): Promise<{
  input: GlobalSceneInput;
  entities: Entity[];
  summary: GlobalAlignmentInputSummary;
  release?: () => void;
}> {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
  };
  check();
  const radius = normalizeGlobalSearchTolerance(options.searchTolerance);
  const candidates = inspectGlobalAlignmentCandidates(
    entities,
    options.entityIds,
  );
  if (candidates.blocked.length)
    throw Error(
      candidates.blocked.map((item) => `${item.id}: ${item.reason}`).join(" "),
    );
  if (!candidates.canPreview)
    throw Error("Global Fine Align requires two to 32 visible raw meshes.");
  const selected = new Set(candidates.entityIds);
  const admitted = entities.filter((entity) => selected.has(entity.id));
  const admission = globalAlignmentInputAdmission(admitted);
  const input: GlobalSceneInput = {
    scans: [],
    radius,
    spacing: 12,
    budget: 1000,
    mask: 1,
  };
  const scans: GlobalSceneInput["scans"][number][] = [];
  const summary: GlobalAlignmentInputSummary = {
    entityIds: candidates.entityIds,
    scanCount: admitted.length,
    vertices: 0,
    triangles: 0,
    searchTolerance: radius,
    spacing: 12,
    budget: 1000,
    mask: 1,
    parallel: options.parallel ?? true,
    preparation: {
      physicalWorkers: 0,
      reusedIndexedScans: 0,
      indexedTriangleSoups: 0,
      admission,
    },
  };
  for (const entity of admitted) {
    check();
    options.onProgress?.(
      scans.length / admitted.length,
      `Preparing ${entity.name}`,
    );
    const indexed = entity.indexedMesh;
    let mesh: GlobalAlignmentPreparedMesh;
    if (indexed) {
      if (
        !indexed.vertices.length ||
        indexed.vertices.length % 3 ||
        !indexed.triangles.length ||
        indexed.triangles.length % 3 ||
        indexed.triangles.length * 3 !== entity.positions.length ||
        (indexed.normals && indexed.normals.length !== indexed.vertices.length)
      )
        throw Error(
          "Global alignment indexed topology does not match render geometry.",
        );
      const vertices = await floats(indexed.vertices, check);
      const triangles =
        indexed.triangles instanceof Uint32Array
          ? indexed.triangles
          : new Uint32Array(indexed.triangles.length);
      await visit(triangles.length, check, (first, end) => {
        for (let i = first; i < end; i++) {
          const id = indexed.triangles[i];
          if (!Number.isSafeInteger(id) || id < 0 || id >= vertices.length / 3)
            throw Error(
              "Global alignment topology references a missing vertex.",
            );
          for (let axis = 0; axis < 3; axis++)
            if (
              indexed.vertices[id * 3 + axis] !== entity.positions[i * 3 + axis]
            )
              throw Error("Global alignment indexed topology is stale.");
          if (triangles !== indexed.triangles) triangles[i] = id;
        }
      });
      if (indexed.normals)
        mesh = {
          vertices,
          triangles,
          normals: await floats(indexed.normals, check),
        };
      else {
        const v = await floats(vertices, check, true);
        const t = new Uint32Array(triangles.length);
        await visit(t.length, check, (first, end) =>
          t.set(triangles.subarray(first, end), first),
        );
        const prepared = await derive(
          { vertices: v, triangles: t },
          options.signal,
          check,
        );
        mesh = { vertices, triangles, normals: prepared.normals };
        summary.preparation.physicalWorkers++;
      }
      summary.preparation.reusedIndexedScans++;
    } else {
      mesh = await derive(
        { positions: await floats(entity.positions, check, true) },
        options.signal,
        check,
      );
      summary.preparation.physicalWorkers++;
      summary.preparation.indexedTriangleSoups++;
    }
    summary.vertices += mesh.vertices.length / 3;
    summary.triangles += mesh.triangles.length / 3;
    scans.push({
      id: entity.id,
      geometry: {
        points: mesh.vertices,
        normals: mesh.normals,
        targetMeshes: [{ vertices: mesh.vertices, triangles: mesh.triangles }],
      },
    });
  }
  check();
  input.scans = scans;
  options.onProgress?.(1, "Global alignment inputs ready");
  return { input, entities: admitted, summary };
}
