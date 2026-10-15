import { BufferAttribute, type Mesh } from "three";
import {
  acceleratedRaycast,
  MeshBVH,
  type SerializedBVH,
} from "three-mesh-bvh";

interface Build {
  start(): void;
}
const queue: Build[] = [];
let active: Build | undefined;
const prepared = new WeakMap<object, Promise<void>>();
function pump(): void {
  if (active) return;
  active = queue.shift();
  active?.start();
}

/** Disposable display index shared by canvas picking and viewport_pick. No authored buffers move. */
export function prepareViewportPicking(mesh: Mesh): Promise<void> {
  const geometry = mesh.geometry;
  const existing = prepared.get(geometry);
  if (existing) return existing;
  const positions = geometry.getAttribute("position");
  if (
    typeof Worker === "undefined" ||
    !positions ||
    !(positions instanceof BufferAttribute) ||
    (geometry.index?.count ?? positions.count) < 30_000
  )
    return Promise.resolve();
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  prepared.set(geometry, ready);
  let worker: Worker | undefined;
  let lease: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(lease);
    worker?.terminate();
    worker = undefined;
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    if (active === job) active = undefined;
    resolve();
    pump();
  };
  const dispose = () => {
    geometry.boundsTree = undefined;
    geometry.removeEventListener("dispose", dispose);
    finish();
  };
  const job: Build = {
    start() {
      try {
        worker = new Worker(
          new URL("./viewport-picking-worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onerror = finish;
        worker.onmessage = ({
          data,
        }: MessageEvent<{ tree?: SerializedBVH }>) => {
          if (!finished && data.tree) {
            try {
              // Indirect construction keeps every rendered facet in its original slot.
              // Preserve the live index and vertex buffers, including non-indexed scans.
              geometry.boundsTree = MeshBVH.deserialize(data.tree, geometry, {
                setIndex: false,
              });
              mesh.raycast = acceleratedRaycast;
            } catch {
              /* Ordinary Three picking remains available on build failure. */
            }
          }
          finish();
        };
        lease = setTimeout(finish, 120_000);
        const copy = new Float32Array(positions.array);
        const index = geometry.index
          ? new Uint32Array(geometry.index.array)
          : undefined;
        worker.postMessage(
          {
            positions: copy,
            index,
            drawRange: geometry.drawRange,
            groups: geometry.groups,
          },
          index ? [copy.buffer, index.buffer] : [copy.buffer],
        );
      } catch {
        finish();
      }
    },
  };
  geometry.addEventListener("dispose", dispose);
  queue.push(job);
  pump();
  return ready;
}
