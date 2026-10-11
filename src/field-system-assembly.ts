import type { FieldLinearSystem } from "./field-linear-solver";

export interface FieldConnection {
  left: number;
  right: number;
  transportAngle: number;
  quarterTurns: number;
}
export interface FieldFixedValue {
  node: number;
  angle: number;
}
export interface FieldAnchor extends FieldFixedValue {
  strength: number;
}
export interface AssembledFieldSystem {
  system: FieldLinearSystem;
  variableNodes: Uint32Array;
}

/** Recovered graph equations; topology, constraint classification and weights are caller inputs. */
export function assembleFieldSystem(
  nodeCount: number,
  connections: readonly FieldConnection[],
  connectionWeight: number,
  fixed: readonly FieldFixedValue[],
  anchors: readonly FieldAnchor[],
): AssembledFieldSystem {
  if (!Number.isInteger(nodeCount) || nodeCount < 0 || nodeCount > 2147483647)
    throw new Error(
      "Field node count must be a nonnegative signed 32-bit integer.",
    );
  if (!Number.isFinite(connectionWeight) || connectionWeight < 0)
    throw new Error("Field connection weight must be finite and nonnegative.");
  const validNode = (node: number) => {
    if (!Number.isInteger(node) || node < 0 || node >= nodeCount)
      throw new Error("Field constraint references an invalid node.");
  };
  const fixedValues = new Map<number, number>();
  for (const value of fixed) {
    validNode(value.node);
    if (!Number.isFinite(value.angle) || fixedValues.has(value.node))
      throw new Error("Field fixed values must be finite and unique.");
    fixedValues.set(value.node, value.angle);
  }
  const variableNodes = new Uint32Array(nodeCount - fixedValues.size);
  const nodeToVariable = new Int32Array(nodeCount).fill(-1);
  for (let node = 0, index = 0; node < nodeCount; node++)
    if (!fixedValues.has(node)) {
      variableNodes[index] = node;
      nodeToVariable[node] = index++;
    }
  const rows = Array.from(
    { length: variableNodes.length },
    (_, index) => new Map<number, number>([[index, 0]]),
  );
  const rhs = new Float64Array(rows.length);
  const add = (row: number, column: number, coefficient: number) => {
    rows[row].set(column, (rows[row].get(column) ?? 0) + coefficient);
  };
  const quarterTurn = Math.fround(Math.PI / 2);
  for (const connection of connections) {
    validNode(connection.left);
    validNode(connection.right);
    if (
      connection.left === connection.right ||
      !Number.isFinite(connection.transportAngle) ||
      !Number.isFinite(Math.fround(connection.transportAngle)) ||
      !Number.isInteger(connection.quarterTurns) ||
      connection.quarterTurns < -2147483648 ||
      connection.quarterTurns > 2147483647
    )
      throw new Error("Field connection is invalid.");
    const left = nodeToVariable[connection.left];
    const right = nodeToVariable[connection.right];
    const transport = Math.fround(connection.transportAngle) * connectionWeight;
    const turn = connection.quarterTurns * connectionWeight * quarterTurn;
    if (left >= 0) {
      add(left, left, connectionWeight);
      if (right >= 0) add(left, right, -connectionWeight);
      else rhs[left] += connectionWeight * fixedValues.get(connection.right)!;
      rhs[left] -= turn;
      rhs[left] += transport;
    }
    if (right >= 0) {
      add(right, right, connectionWeight);
      if (left >= 0) add(right, left, -connectionWeight);
      else rhs[right] += connectionWeight * fixedValues.get(connection.left)!;
      rhs[right] += turn;
      rhs[right] -= transport;
    }
  }
  const anchored = new Set<number>();
  for (const anchor of anchors) {
    validNode(anchor.node);
    const strength = Math.fround(anchor.strength);
    if (
      !Number.isFinite(anchor.angle) ||
      !Number.isFinite(anchor.strength) ||
      !Number.isFinite(strength) ||
      anchor.strength < 0 ||
      anchored.has(anchor.node)
    )
      throw new Error("Field anchors must be finite, nonnegative and unique.");
    anchored.add(anchor.node);
    const row = nodeToVariable[anchor.node];
    if (row >= 0 && strength > Math.fround(0.000002)) {
      add(row, row, strength);
      rhs[row] += strength * anchor.angle;
    }
  }
  let nonzeros = 0;
  for (const row of rows) nonzeros += row.size;
  if (nonzeros > 4294967295)
    throw new Error("Field sparse indexing exceeds the 32-bit representation.");
  const offsets = new Uint32Array(rows.length + 1);
  const indices = new Uint32Array(nonzeros);
  const coefficients = new Float64Array(nonzeros);
  let entry = 0;
  for (let row = 0; row < rows.length; row++) {
    offsets[row] = entry;
    if (!Number.isFinite(rhs[row]))
      throw new Error("Field right-hand side overflow.");
    for (const [column, coefficient] of [...rows[row]].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (!Number.isFinite(coefficient))
        throw new Error("Field coefficient overflow.");
      indices[entry] = column;
      coefficients[entry++] = coefficient;
    }
  }
  offsets[rows.length] = entry;
  return {
    system: { offsets, indices, coefficients, rightHandSide: rhs },
    variableNodes,
  };
}
