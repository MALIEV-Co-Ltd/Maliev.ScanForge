import type { FieldLinearSystem } from "./field-linear-solver";
import type { FieldConnection, FieldFixedValue } from "./field-system-assembly";
import { fixFieldVariables } from "./field-variable-fixing";

export interface FieldCandidateConnection extends FieldConnection {
  weight: number;
}

export interface FieldCandidateNode {
  node: number;
  quarterTurns: number;
  referenceAngle: number;
}

/** Recovered selected-candidate updates; mesh indexing and selection are supplied. */
export function applyFieldCandidateConstraints(
  system: FieldLinearSystem,
  nodeCount: number,
  variableNodes: Uint32Array,
  fixed: readonly FieldFixedValue[],
  connections: readonly FieldCandidateConnection[],
  nodes: readonly FieldCandidateNode[],
): { system: FieldLinearSystem; affectedVariables: Uint32Array } {
  if (
    !Number.isInteger(nodeCount) ||
    nodeCount < 0 ||
    nodeCount > 2147483647 ||
    variableNodes.length !== system.rightHandSide.length ||
    variableNodes.length + fixed.length !== nodeCount
  )
    throw new Error("Candidate constraints require a complete node mapping.");
  const validNode = (node: number) => {
    if (!Number.isInteger(node) || node < 0 || node >= nodeCount)
      throw new Error("Candidate constraint references an invalid node.");
  };
  const nodeToVariable = new Map<number, number>();
  for (const [variable, node] of variableNodes.entries()) {
    validNode(node);
    if (nodeToVariable.has(node))
      throw new Error("Candidate variable nodes must be unique.");
    nodeToVariable.set(node, variable);
  }
  const fixedAngles = new Map<number, number>();
  for (const { node, angle } of fixed) {
    validNode(node);
    if (
      nodeToVariable.has(node) ||
      fixedAngles.has(node) ||
      !Number.isFinite(Math.fround(angle))
    )
      throw new Error("Candidate fixed nodes must be unique and finite.");
    fixedAngles.set(node, Math.fround(angle));
  }
  const validTurns = (value: number) => {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
      throw new Error("Candidate turns must be signed 32-bit integers.");
  };
  // Reuse full symmetric CSR validation and independent ownership, without fixing a variable.
  const owned = fixFieldVariables(system, []);
  const rows = Array.from({ length: variableNodes.length }, (_, row) => {
    const entries = new Map<number, number>();
    for (let k = owned.offsets[row]; k < owned.offsets[row + 1]; k++)
      entries.set(owned.indices[k], owned.coefficients[k]);
    return entries;
  });
  const rhs = owned.rightHandSide;
  const affected: number[] = [];
  const add = (row: number, column: number, value: number) => {
    rows[row].set(column, value + (rows[row].get(column) ?? 0));
  };
  const quarterTurn = Math.fround(Math.PI / 2);
  for (const connection of connections) {
    validNode(connection.left);
    validNode(connection.right);
    validTurns(connection.quarterTurns);
    if (
      connection.left === connection.right ||
      !Number.isFinite(Math.fround(connection.transportAngle)) ||
      !Number.isFinite(connection.weight) ||
      connection.weight < 0
    )
      throw new Error("Candidate connection is invalid.");
    const left = nodeToVariable.get(connection.left);
    const right = nodeToVariable.get(connection.right);
    const { weight } = connection;
    const delta =
      (Math.fround(connection.transportAngle) -
        connection.quarterTurns * quarterTurn) *
      weight;
    if (left !== undefined) {
      add(left, left, weight);
      if (right === undefined)
        rhs[left] = fixedAngles.get(connection.right)! * weight + rhs[left];
      else add(left, right, -weight);
      rhs[left] = delta + rhs[left];
      affected.push(left);
    }
    if (right !== undefined) {
      if (left === undefined)
        rhs[right] = fixedAngles.get(connection.left)! * weight + rhs[right];
      else add(right, left, -weight);
      add(right, right, weight);
      rhs[right] -= delta;
      affected.push(right);
    }
  }
  const usedNodes = new Set<number>();
  for (const node of nodes) {
    validNode(node.node);
    validTurns(node.quarterTurns);
    if (!Number.isFinite(node.referenceAngle) || usedNodes.has(node.node))
      throw new Error("Candidate nodes must be finite and unique in a batch.");
    usedNodes.add(node.node);
    const variable = nodeToVariable.get(node.node);
    if (variable === undefined) continue;
    add(variable, variable, 1);
    rhs[variable] =
      node.quarterTurns * quarterTurn + node.referenceAngle + rhs[variable];
    affected.push(variable);
  }
  let count = 0;
  for (const row of rows) count += row.size;
  if (count > 4294967295)
    throw new Error("Candidate sparse indexing exceeds the 32-bit range.");
  const offsets = new Uint32Array(rows.length + 1);
  const indices = new Uint32Array(count);
  const coefficients = new Float64Array(count);
  let entry = 0;
  for (const [row, entries] of rows.entries()) {
    offsets[row] = entry;
    if (!Number.isFinite(rhs[row]))
      throw new Error("Candidate right-hand side overflowed.");
    for (const [column, value] of [...entries].sort((a, b) => a[0] - b[0])) {
      if (!Number.isFinite(value))
        throw new Error("Candidate sparse coefficient overflowed.");
      indices[entry] = column;
      coefficients[entry++] = value;
    }
  }
  offsets[rows.length] = entry;
  return {
    system: { offsets, indices, coefficients, rightHandSide: rhs },
    affectedVariables: Uint32Array.from(affected),
  };
}
