import type { GlobalSceneInput } from "./scan-global-scene-worker";
import { yieldScanTask } from "./scan-task";
/** Copy immutable author carriers in bounded tasks, then transfer only the copies.
 * This replaces one long structured-clone pause when admitting a large scene. */
export async function copyGlobalSceneForTransfer(
  input: GlobalSceneInput,
  check: () => void,
) {
  const copies = new Map<
    Float32Array | Uint32Array,
    Float32Array | Uint32Array
  >();
  const transfer: ArrayBuffer[] = [];
  const copy = async <T extends Float32Array | Uint32Array>(
    source: T,
  ): Promise<T> => {
    check();
    const cached = copies.get(source);
    if (cached) return cached as T;
    if (!(source instanceof Float32Array || source instanceof Uint32Array))
      throw Error("Global scene transport requires typed geometry.");
    const result =
      source instanceof Float32Array
        ? new Float32Array(source.length)
        : new Uint32Array(source.length);
    copies.set(source, result);
    transfer.push(result.buffer);
    for (let first = 0; first < source.length; first += 1048576) {
      check();
      result.set(
        source.subarray(first, Math.min(source.length, first + 1048576)),
        first,
      );
      if (first + 1048576 < source.length) await yieldScanTask();
    }
    check();
    return result as T;
  };
  const scans: GlobalSceneInput["scans"][number][] = [];
  for (const scan of input.scans) {
    const g = scan.geometry;
    scans.push({
      ...scan,
      geometry: {
        points: await copy(g.points),
        normals: await copy(g.normals),
        ...(g.flags ? { flags: await copy(g.flags) } : {}),
        ...(g.labels ? { labels: await copy(g.labels) } : {}),
      },
    });
  }
  check();
  return { input: { ...input, scans }, transfer };
}
