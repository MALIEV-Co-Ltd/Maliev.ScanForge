import * as THREE from "three";
import { ScreenSelectionIndex } from "./screen-selection";

let index: ScreenSelectionIndex | undefined;
self.onmessage = ({ data }) => {
  try {
    if (data.initialize) {
      index?.dispose();
      index = new ScreenSelectionIndex(
        data.initialize.positions,
        data.initialize.hidden,
      );
      return;
    }
    if (!index) throw new Error("Selection geometry is unavailable.");
    const camera = data.frame.orthographic
      ? new THREE.OrthographicCamera()
      : new THREE.PerspectiveCamera();
    camera.near = data.frame.near;
    camera.far = data.frame.far;
    camera.matrixAutoUpdate = false;
    camera.matrix.fromArray(data.frame.matrix);
    camera.projectionMatrix.fromArray(data.frame.projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    const mask = index.select(camera, data.region, data.view, data.range);
    self.postMessage(
      { mask, start: data.range?.start ?? 0 },
      { transfer: [mask.buffer] },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
