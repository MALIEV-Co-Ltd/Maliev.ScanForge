import { expect, it } from "vitest";
import { timelineCommand } from "../src/ui/timeline-command";
import {
  RIBBON_ICON_ARTWORK,
  ribbonCommandPalette,
} from "../src/ui/RibbonCommandIcon";
for (const [label, command] of [
  ["Opening part.stl", "open"],
  ["Delete 25 triangles", "editScan"],
  ["Reduce Noise", "reduceNoise"],
  ["Extrude sketch", "extrude"],
  ["Create sketch", "sketch2d"],
  ["Create freeform", "newFreeform"],
  ["Fit surface", "fitSurface"],
  ["Create NURBS surface", "nurbsSurface"],
  ["Deviation analysis", "deviation"],
  ["Create plane", "fitPlane"],
  ["Create cylinder", "fitCylinder"],
  ["Project selected boundary", "sketch2d"],
])
  it(`uses matching toolbar artwork for ${label}`, () => {
    expect(timelineCommand(label)).toBe(command);
    expect(RIBBON_ICON_ARTWORK[command]).toBeTruthy();
    expect(ribbonCommandPalette(command).base).toMatch(/^#[a-f0-9]{6}$/i);
  });
