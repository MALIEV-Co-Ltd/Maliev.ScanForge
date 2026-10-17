import { rectangleSketch, type Sketch } from "./sketch";

/** Replace editable geometry while retaining the sketch's placement and references. */
export function resetSketchRectangle(sketch: Sketch): Sketch {
  return {
    ...rectangleSketch(),
    ...(sketch.frame ? { frame: sketch.frame } : {}),
    ...(sketch.reference ? { reference: sketch.reference } : {}),
  };
}
