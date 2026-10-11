import type { SectionResult } from "./types";

/** ASCII DXF R2000 LINE entities in model-space millimetres, preserving world XYZ section coordinates. */
export function exportSectionDxf(section: SectionResult): string {
  if (
    !section.segments.length ||
    section.segments.length % 6 ||
    !section.segments.every(Number.isFinite)
  )
    throw new Error("DXF export requires complete finite section segments.");
  const pairs: (string | number)[] = [
    0,
    "SECTION",
    2,
    "HEADER",
    9,
    "$ACADVER",
    1,
    "AC1015",
    9,
    "$INSUNITS",
    70,
    4,
    9,
    "$MEASUREMENT",
    70,
    1,
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "TABLES",
    0,
    "TABLE",
    2,
    "LAYER",
    70,
    1,
    0,
    "LAYER",
    100,
    "AcDbSymbolTableRecord",
    100,
    "AcDbLayerTableRecord",
    2,
    "SECTION",
    70,
    0,
    62,
    7,
    6,
    "CONTINUOUS",
    0,
    "ENDTAB",
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "ENTITIES",
  ];
  let handle = 256;
  for (let i = 0; i < section.segments.length; i += 6) {
    const p = section.segments.slice(i, i + 6);
    if (p[0] === p[3] && p[1] === p[4] && p[2] === p[5]) continue;
    pairs.push(
      0,
      "LINE",
      5,
      (handle++).toString(16).toUpperCase(),
      100,
      "AcDbEntity",
      8,
      "SECTION",
      100,
      "AcDbLine",
      10,
      p[0],
      20,
      p[1],
      30,
      p[2],
      11,
      p[3],
      21,
      p[4],
      31,
      p[5],
    );
  }
  if (handle === 256)
    throw new Error("DXF export requires a nonzero section segment.");
  pairs.push(0, "ENDSEC", 0, "EOF");
  return pairs.join("\r\n") + "\r\n";
}
