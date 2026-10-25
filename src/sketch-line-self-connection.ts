import { requireNativeSketchLinePreparedEndpoints } from "./sketch-line-prepared";
import { evaluateNativeSketchLinePoint } from "./sketch-line-conversion";
import {
  checkNativeSketchWireSelfConnection,
  type NativeSketchWireSelfConnection,
} from "./sketch-wire-self-connection";

export type NativeSketchLineSelfConnection = NativeSketchWireSelfConnection & {
  witnessParameter?: number;
};

/**
 * Prepared nonperiodic analytic line with known endpoint parameters. Native
 * parameter resolution leaves these values unchanged; the witness uses their
 * sum times one half, followed by analytic evaluation. This is a connection
 * candidate diagnostic, not complete wire topology or body admission.
 */
export function checkNativeSketchLineSelfConnection(
  input: unknown,
  squaredThreshold: unknown,
): NativeSketchLineSelfConnection {
  const { start, end, conversion } =
    requireNativeSketchLinePreparedEndpoints(input);
  let witnessParameter: number | undefined;
  const result = checkNativeSketchWireSelfConnection(
    start,
    end,
    squaredThreshold,
    () => {
      // The native pair resolver treats an unset first coordinate as invalid.
      if (start[0] === -31415800000000 || end[0] === -31415800000000)
        throw new Error(
          "Line self-connection witness has unset endpoint coordinates.",
        );
      const parameter = (conversion.interval[1] + conversion.interval[0]) * 0.5;
      const witness = evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        parameter,
      );
      witnessParameter = parameter;
      return witness;
    },
  );
  return {
    ...result,
    ...(witnessParameter === undefined ? {} : { witnessParameter }),
  };
}
