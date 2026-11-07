export function reductionGrid(nx = 160, ny = 128) {
  const positions = new Float32Array(nx * ny * 18);
  const point = (x: number, y: number) => [
    x,
    y,
    0.002 * x * x + 0.001 * y * y + 0.2 * Math.sin(0.3 * x) * Math.cos(0.2 * y),
  ];
  let cursor = 0;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = point(x, y),
        b = point(x + 1, y),
        c = point(x + 1, y + 1),
        d = point(x, y + 1);
      positions.set([...a, ...b, ...c, ...a, ...c, ...d], cursor);
      cursor += 18;
    }
  return positions;
}
