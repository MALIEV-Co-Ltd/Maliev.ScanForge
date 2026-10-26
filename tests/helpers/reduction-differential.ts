import { weldMeshPositions } from "../../src/mesh-weld";
import { reductionGrid } from "./reduction-grid";
import fan from "../fixtures/smooth-disconnected-fans.json";
export function reductionDifferentialCases() {
  const grid = weldMeshPositions(reductionGrid(12, 11), 1e-6);
  const flat = weldMeshPositions(
    Float32Array.from(reductionGrid(16, 16), (v, i) => (i % 3 === 2 ? 0 : v)),
    1e-6,
  );
  const fans = weldMeshPositions(Float32Array.from(fan.positions), 1e-6);
  const ringPoints = [0, 0, 2, 0, 0, -3],
    ringFaces: number[] = [];
  for (let i = 0; i < 129; i++) {
    const a = (i * Math.PI * 2) / 129;
    ringPoints.push(3 * Math.cos(a), 2 * Math.sin(a), 0.1 * Math.sin(a * 3));
    ringFaces.push(
      0,
      i + 2,
      ((i + 1) % 129) + 2,
      1,
      ((i + 1) % 129) + 2,
      i + 2,
    );
  }
  return [
    { label: "connected curved grid", ...grid, target: 132 },
    {
      label: "flat equal-cost grid through multiple rebuilds",
      ...flat,
      target: 4,
    },
    { label: "disconnected shared fan", ...fans, target: 4 },
    {
      label: "closed high-valence bipyramid",
      vertices: Float64Array.from(Float32Array.from(ringPoints)),
      triangles: Uint32Array.from(ringFaces),
      target: 128,
    },
    {
      label: "degenerate and repeated faces",
      vertices: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      triangles: Uint32Array.from([
        0, 0, 1, 0, 1, 2, 0, 1, 2, 2, 1, 0, 0, 2, 3, 0, 3, 1,
      ]),
      target: 2,
    },
  ];
}
