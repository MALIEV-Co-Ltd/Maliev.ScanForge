export type NativeSketchLineAttachmentResult = {
  stage: "start-point" | "end-point" | "edge-range" | "edge-curve";
  status: number;
  continues: boolean;
  wireStatus?: 1 | 4;
};

/**
 * Selected ordinary, nonclosing line-builder normal-return paths from initial
 * wire status zero. Diagnostic transfers/exceptions and whole body admission
 * are outside this mapping. A continuing event does not assign wire status 0.
 */
export function resolveNativeSketchLineAttachment(
  input: unknown,
): NativeSketchLineAttachmentResult {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Line attachment requires an explicit result record.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "stage" && key !== "status"))
    throw new Error("Unsupported line attachment result field.");
  const { stage, status: value } = record;
  if (
    stage !== "start-point" &&
    stage !== "end-point" &&
    stage !== "edge-range" &&
    stage !== "edge-curve"
  )
    throw new Error("Unsupported line attachment stage.");
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  )
    throw new Error("Line attachment status must be a signed 32-bit integer.");
  const status = value | 0;
  const continues = status === 1 || (stage === "edge-range" && status === 5);
  return {
    stage,
    status,
    continues,
    ...(continues
      ? {}
      : {
          wireStatus:
            stage === "edge-curve" && status === 5
              ? (1 as const)
              : (4 as const),
        }),
  };
}
