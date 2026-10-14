import { createContext, useContext, type ReactNode } from "react";
export const ToolWorkspace = createContext<string | undefined>(undefined);
export const commandWorkspaces = {
  objectColor: ["objectColor", "Object color"],
  pointNoise: ["pointNoise", "Reduce point noise"],
  pointReduce: ["pointReduce", "Reduce points"],
  fineAlign: ["processing", "Fine alignment"],
  repairMesh: ["processing", "Repair topology"],
  segmentMesh: ["processing", "Segment surfaces"],
  smoothMesh: ["processing", "Smooth mesh"],
  decimateMesh: ["processing", "Reduce polygons"],
  globalAlignment: ["processing", "Global alignment"],
  landmarkAlignment: ["processing", "Paired landmarks"],
  loft: ["advancedCad", "Loft"],
  sweep: ["advancedCad", "Sweep"],
  fillet: ["advancedCad", "Fillet"],
  chamfer: ["advancedCad", "Chamfer"],
  surfaceOffset: ["advancedCad", "Surface offset"],
  sewSurfaces: ["advancedCad", "Sew surfaces"],
  shell: ["advancedCad", "Shell"],
  surfaceThicken: ["advancedCad", "Thicken surface"],
  splitSolid: ["advancedCad", "Split solid"],
  circularPattern: ["advancedCad", "Circular pattern"],
  linearPattern: ["advancedCad", "Linear pattern"],
  mirrorBody: ["advancedCad", "Mirror body"],
  extrude: ["reconstruct", "Extrude"],
  revolve: ["reconstruct", "Revolve"],
  boolean: ["reconstruct", "Boolean tools"],
} as const;
export function workspaceGroup(workspace: string): string {
  return (
    commandWorkspaces[workspace as keyof typeof commandWorkspaces]?.[0] ??
    workspace
  );
}
export function workspaceTitle(workspace: string): string | undefined {
  return commandWorkspaces[workspace as keyof typeof commandWorkspaces]?.[1];
}
/** Unrelated command controls are not mounted, rather than merely hidden by CSS. */
export function ToolSection({
  tools,
  children,
}: {
  tools: string[];
  children: ReactNode;
}) {
  const workspace = useContext(ToolWorkspace);
  return !workspace || tools.includes(workspace) ? <>{children}</> : null;
}
