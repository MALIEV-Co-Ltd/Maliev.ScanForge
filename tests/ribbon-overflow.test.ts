import { expect, it } from "vitest";
import { ribbonOverflowEdges } from "../src/ui/ribbon-overflow";

it("offers only directions containing offscreen commands", () => {
  expect(ribbonOverflowEdges(0, 500, 900)).toEqual({
    left: false,
    right: true,
  });
  expect(ribbonOverflowEdges(200, 500, 900)).toEqual({
    left: true,
    right: true,
  });
  expect(ribbonOverflowEdges(400, 500, 900)).toEqual({
    left: true,
    right: false,
  });
});
it("removes hints when resize or a short tab makes all commands fit", () => {
  expect(ribbonOverflowEdges(0, 900, 900)).toEqual({
    left: false,
    right: false,
  });
  expect(ribbonOverflowEdges(200, 1000, 900)).toEqual({
    left: false,
    right: false,
  });
});
it("does not flicker at fractional edges or browser overscroll", () => {
  expect(ribbonOverflowEdges(-20, 500, 900)).toEqual({
    left: false,
    right: true,
  });
  expect(ribbonOverflowEdges(399.5, 500, 900)).toEqual({
    left: true,
    right: false,
  });
  expect(ribbonOverflowEdges(420, 500, 900)).toEqual({
    left: true,
    right: false,
  });
});
