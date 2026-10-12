export const SCAN_UNITS = {
  mm: { label: "Millimeter", millimetres: 1 },
  cm: { label: "Centimeter", millimetres: 10 },
  m: { label: "Meter", millimetres: 1000 },
  in: { label: "Inches", millimetres: 25.4 },
  ft: { label: "Feet", millimetres: 304.8 },
} as const;
export type ScanUnit = keyof typeof SCAN_UNITS;

/** Convert the worker-owned final buffer without duplicating large scans. */
export function convertScanUnits(
  positions: Float32Array,
  unit: ScanUnit = "mm",
) {
  const definition = SCAN_UNITS[unit];
  if (!definition) throw new Error("Unsupported scan unit.");
  if (definition.millimetres !== 1)
    for (let i = 0; i < positions.length; i++) {
      positions[i] *= definition.millimetres;
      if (!Number.isFinite(positions[i]))
        throw new Error(
          "Scan coordinates exceed the supported range after unit conversion.",
        );
    }
  return positions;
}
