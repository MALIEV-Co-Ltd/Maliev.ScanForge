import * as THREE from "three";
import {
  nativeInteractivePixelPlane,
  nativeInteractiveMovement,
  nativeInteractiveProjectPoint,
  type InteractiveDragInput,
} from "./interactive-alignment-math";
import type { NavigationCamera } from "./camera-gizmo";
export interface InteractivePointerDrag {
  handle: number;
  from: readonly number[];
  to: readonly number[];
  pivot: readonly number[];
  strength: number;
  continuation?: boolean;
}
export function captureInteractiveCamera(
  camera: NavigationCamera,
  target: THREE.Vector3,
  bounds: THREE.Box3,
  width: number,
  height: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 2147483647 ||
    height > 2147483647
  )
    throw new Error(
      "Interactive alignment requires a nonempty integer viewport.",
    );
  camera.updateMatrixWorld(true);
  const anchor = (
    bounds.isEmpty() ? target.clone() : bounds.getCenter(new THREE.Vector3())
  ).toArray();
  const e = camera.matrixWorldInverse.elements;
  const matrix = [
    e[0],
    e[4],
    e[8],
    0,
    e[1],
    e[5],
    e[9],
    0,
    e[2],
    e[6],
    e[10],
    0,
  ];
  const [x, y, z] = anchor.map((v, i) => v - target.getComponent(i));
  for (let r = 0; r < 3; r++)
    matrix[r * 4 + 3] =
      y * matrix[r * 4 + 1] + x * matrix[r * 4] + z * matrix[r * 4 + 2];
  const pixelMode = camera instanceof THREE.PerspectiveCamera;
  const planeBounds =
    camera instanceof THREE.OrthographicCamera
      ? [
          camera.left / camera.zoom,
          camera.bottom / camera.zoom,
          -1,
          camera.right / camera.zoom,
          camera.top / camera.zoom,
          1,
        ]
      : [-1, -1, -1, 1, 1, 1];
  const model = Array.from(e),
    projection = Array.from(camera.projectionMatrix.elements),
    rectangle = [0, 0, width, height];
  return {
    matrix,
    anchor,
    pixelMode,
    width,
    height,
    viewSize: pixelMode ? height : planeBounds[4] - planeBounds[1],
    plane: (point: readonly number[]) =>
      nativeInteractivePixelPlane({
        rectangle,
        bounds: planeBounds,
        point,
        pixelMode,
      }),
    project: (point: readonly number[]) =>
      nativeInteractiveProjectPoint({
        frame: matrix,
        anchor,
        point,
        pixelMode,
        model,
        projection,
        viewport: rectangle,
      }),
  };
}
export type InteractiveCameraContext = ReturnType<
  typeof captureInteractiveCamera
>;
/** Both GUI pointer routing and MCP drag commands consume this same adapter. */
export function interactiveDragForCamera(
  context: InteractiveCameraContext,
  input: InteractivePointerDrag,
): InteractiveDragInput | null {
  if (![1, 2, 3, 4, 5, 6, 10, 11, 12].includes(input.handle))
    throw new Error("Choose an Interactive translation or rotation handle.");
  if (
    input.pivot.length !== 3 ||
    !input.pivot.every((n) => Number.isFinite(Math.fround(n))) ||
    [input.from, input.to].some(
      (p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)),
    ) ||
    (input.continuation !== undefined &&
      typeof input.continuation !== "boolean")
  )
    throw new Error(
      "Interactive drag requires finite normalized viewport points, a finite pivot and a continuation flag.",
    );
  const previousPixel = [
      Math.trunc(input.from[0] * context.width),
      Math.trunc(input.from[1] * context.height),
    ],
    currentPixel = [
      Math.trunc(input.to[0] * context.width),
      Math.trunc(input.to[1] * context.height),
    ];
  if (
    [...previousPixel, ...currentPixel].some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < -2147483648 ||
        value > 2147483647,
    )
  )
    throw new Error("Interactive drag exceeds the native signed pixel range.");
  const previous = context.plane(previousPixel),
    current = context.plane(currentPixel);
  const move = nativeInteractiveMovement({
    mode: input.handle,
    strength: input.strength,
    previousPixel,
    currentPixel,
    waiting: !input.continuation,
    previousPlane: previous,
    currentPlane: current,
    view: context.matrix,
  });
  if (!move.movement) return null;
  const pivot = input.pivot.map(Math.fround),
    projected = context.project(pivot);
  return {
    mode: input.handle,
    frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    original: [1, 0, 0, pivot[0], 0, 1, 0, pivot[1], 0, 0, 1, pivot[2]],
    delta: move.movement,
    previousScreen: [...previous, 0],
    screen: current,
    pivotScreen: [Math.fround(projected[0]), Math.fround(projected[1]), 0],
    viewSize: context.viewSize,
    view: context.matrix,
  };
}
