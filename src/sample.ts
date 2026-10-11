import * as THREE from "three";
import { geometryPositions } from "./io";
import type { Entity } from "./types";

// Independently generated analytic demonstration geometry, not a captured scan.
export function demonstrationBracket(): Entity {
  const base = new THREE.Shape();
  base.moveTo(-35, -25);
  base.lineTo(35, -25);
  base.lineTo(35, 25);
  base.lineTo(-35, 25);
  base.closePath();
  for (const x of [-22, 22])
    for (const y of [-12, 12]) {
      const hole = new THREE.Path();
      hole.absarc(x, y, 4, 0, Math.PI * 2, true);
      base.holes.push(hole);
    }
  const upright = new THREE.Shape();
  upright.moveTo(-35, 0);
  upright.lineTo(35, 0);
  upright.lineTo(35, 50);
  upright.lineTo(-35, 50);
  upright.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 28, 12, 0, Math.PI * 2, true);
  upright.holes.push(hole);
  const a = new THREE.ExtrudeGeometry(base, {
    depth: 6,
    bevelEnabled: false,
    curveSegments: 32,
  });
  const b = new THREE.ExtrudeGeometry(upright, {
    depth: 6,
    bevelEnabled: false,
    curveSegments: 48,
  });
  b.rotateX(Math.PI / 2);
  b.translate(0, 25, 6);
  try {
    return {
      id: crypto.randomUUID(),
      name: "Demonstration bracket",
      kind: "mesh",
      positions: [...geometryPositions(a), ...geometryPositions(b)],
      color: "#5b9ed9",
      visible: true,
      opacity: 1,
      source: "Synthetic example · millimetres",
    };
  } finally {
    a.dispose();
    b.dispose();
  }
}
