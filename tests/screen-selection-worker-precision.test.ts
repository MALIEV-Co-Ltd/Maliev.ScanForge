import { expect, it, vi } from "vitest";
import * as THREE from "three";

it("retains precise mesh positions through the actual selection worker dispatcher", async () => {
  vi.resetModules();
  const messages: any[] = [];
  const scope = {
    onmessage: null as null | ((event: { data: any }) => void),
    postMessage(message: any, options: { transfer: Transferable[] }) {
      messages.push(structuredClone(message, { transfer: options.transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/screen-selection-worker");
    const x = 100000000;
    const source = [
      x,
      0,
      0,
      x + 4,
      0,
      0,
      x + 4,
      4,
      0,
      x,
      0,
      -1,
      x + 4,
      0,
      -1,
      x + 4,
      4,
      -1,
    ];
    const positions = Float64Array.from(source);
    const transferred = structuredClone(positions, {
      transfer: [positions.buffer],
    });
    expect(positions.byteLength).toBe(0);
    scope.onmessage!({
      data: {
        initialize: { positions: transferred, hidden: [], pointCloud: false },
      },
    });
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
    camera.position.set(x + 2, 2, 10);
    camera.lookAt(x + 2, 2, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    scope.onmessage!({
      data: {
        frame: {
          orthographic: true,
          matrix: camera.matrixWorld.toArray(),
          projection: camera.projectionMatrix.toArray(),
          near: camera.near,
          far: camera.far,
        },
        region: { kind: "rectangle", start: [0, 0], end: [200, 200] },
        view: { width: 200, height: 200, through: false },
        range: { start: 0, end: 2 },
      },
    });
    expect(messages).toHaveLength(1);
    expect([...messages[0].mask]).toEqual([1, 0]);
    expect(source[3]).toBe(x + 4);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
