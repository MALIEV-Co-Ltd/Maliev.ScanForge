/** Exact captured native quadrature constants; do not replace with textbook precision.
 * Source mapped SHA256 e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1.
 * Native integral Evidence ev_979b038c67ebed284961dcd3d5aa463a66db013081e9b62a1d60772317980e1a.
 */
export interface NativeSurfaceQuadrature {
  readonly selector: number;
  readonly count: number;
  readonly nodes: { readonly float64: readonly number[] };
  readonly weights: { readonly float64: readonly number[] };
}
export const NATIVE_SURFACE_QUADRATURE: readonly NativeSurfaceQuadrature[] = [
  {
    selector: 0,
    count: 1,
    nodes: {
      float64: [0.0],
    },
    weights: {
      float64: [2.0],
    },
  },
  {
    selector: 1,
    count: 2,
    nodes: {
      float64: [0.57735, -0.57735],
    },
    weights: {
      float64: [1.0, 1.0],
    },
  },
  {
    selector: 3,
    count: 4,
    nodes: {
      float64: [0.33998, 0.86113, -0.33998, -0.86113],
    },
    weights: {
      float64: [0.65214, 0.34785, 0.65214, 0.34785],
    },
  },
  {
    selector: 5,
    count: 6,
    nodes: {
      float64: [0.23861, 0.6612, 0.93246, -0.23861, -0.6612, -0.93246],
    },
    weights: {
      float64: [0.46791, 0.36076, 0.17132, 0.46791, 0.36076, 0.17132],
    },
  },
  {
    selector: 7,
    count: 8,
    nodes: {
      float64: [
        0.18343, 0.52553, 0.79666, 0.96028, -0.18343, -0.52553, -0.79666,
        -0.96028,
      ],
    },
    weights: {
      float64: [
        0.36268, 0.3137, 0.22238, 0.10122, 0.36268, 0.3137, 0.22238, 0.10122,
      ],
    },
  },
  {
    selector: 9,
    count: 10,
    nodes: {
      float64: [
        0.14887, 0.43339, 0.6794, 0.86506, 0.9739, -0.14887, -0.43339, -0.6794,
        -0.86506, -0.9739,
      ],
    },
    weights: {
      float64: [
        0.29552, 0.26926, 0.21908, 0.14945, 0.06667, 0.29552, 0.26926, 0.21908,
        0.14945, 0.06667,
      ],
    },
  },
  {
    selector: 11,
    count: 12,
    nodes: {
      float64: [
        0.12523, 0.36783, 0.58731, 0.7699, 0.90411, 0.98156, -0.12523, -0.36783,
        -0.58731, -0.7699, -0.90411, -0.98156,
      ],
    },
    weights: {
      float64: [
        0.24914, 0.23349, 0.20316, 0.16007, 0.10693, 0.04717, 0.24914, 0.23349,
        0.20316, 0.16007, 0.10693, 0.04717,
      ],
    },
  },
];
