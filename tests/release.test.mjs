import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  bumpVersion,
  commitType,
  compareVersions,
  renderNotes,
} from "../scripts/release.mjs";

it("increments each owner's version level and resets lower numbers", () => {
  expect(bumpVersion("2.4.99", "major")).toBe("3.0.0");
  expect(bumpVersion("2.4.99", "minor")).toBe("2.5.0");
  expect(bumpVersion("2.4.99", "patch")).toBe("2.4.100");
  expect(compareVersions("v1.2.100", "v1.2.9")).toBeGreaterThan(0);
  expect(() => bumpVersion("1.02.3", "patch")).toThrow();
});
it("defaults runtime changes to patch, ignores docs and honors explicit decisions", () => {
  expect(commitType("Improve picking", ["src/viewport.ts"])).toBe("patch");
  expect(
    commitType("Document picking", [
      "docs/picking.md",
      "tests/picking.test.ts",
    ]),
  ).toBe("none");
  expect(
    commitType("New modeling foundation\n\nRelease-Type: major", [
      "src/model.ts",
    ]),
  ).toBe("major");
  expect(
    commitType("Internal fixture\n\nRelease-Type: none", ["src/fixture.ts"]),
  ).toBe("none");
  expect(() =>
    commitType("Release-Type: major\nRelease-Type: minor", []),
  ).toThrow();
});
it("includes intervening patch commits in cumulative milestone notes", () => {
  const notes = renderNotes(
    { tag: "v1.3.0", previousMilestone: "v1.2.0" },
    [
      { hash: "abcdef0123", subject: "fix: Correct plane picking" },
      { hash: "1234567890", subject: "feat: Add sketch snaps" },
    ],
    "Sketches now snap to existing geometry.",
  );
  expect(notes).toContain("Sketches now snap");
  expect(notes).toContain("Correct plane picking");
  expect(notes).toContain("Add sketch snaps");
  expect(notes).toContain("v1.2.0...v1.3.0");
  expect(() => renderNotes({}, [], "")).toThrow("useful release notes");
});
it("plans from real Git history, skips docs, aggregates patch changes and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "scanforge-release-test-"));
  const script = resolve("scripts/release.mjs");
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
    });
  const git = (...args) => run("git", args);
  const plan = () => {
    run(process.execPath, [script, "plan"]);
    return JSON.parse(
      readFileSync(join(root, ".resources/release-plan.json"), "utf8"),
    );
  };
  try {
    git("init");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release-test@example.invalid");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    git("add", ".");
    git("commit", "-m", "Initial source");
    mkdirSync(join(root, "docs/releases"), { recursive: true });
    writeFileSync(
      join(root, "docs/releases/v0.1.0.md"),
      "First actual release",
    );
    expect(plan()).toMatchObject({
      tag: "v0.1.0",
      type: "initial",
      milestone: true,
    });
    git("tag", "v0.1.0");
    writeFileSync(join(root, "docs/note.md"), "Document only");
    git("add", ".");
    git("commit", "-m", "Improve documentation");
    expect(plan().release).toBe(false);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/main.ts"), "export const value = 1;");
    git("add", ".");
    git("commit", "-m", "fix: Correct picking");
    expect(plan().tag).toBe("v0.1.1");
    git("tag", "v0.1.1");
    expect(plan().tag).toBe("v0.1.1");
    expect(plan().release).toBe(true);
    writeFileSync(
      join(root, "docs/releases/v0.2.0.md"),
      "Useful modeling improvements",
    );
    git("add", "docs");
    git("commit", "-m", "Improve sketch workflow\n\nRelease-Type: minor");
    expect(plan()).toMatchObject({
      tag: "v0.2.0",
      milestone: true,
      previousMilestone: "v0.1.0",
    });
    git("checkout", "--orphan", "unreleased");
    git("commit", "--allow-empty", "-m", "Independent source");
    expect(plan().tag).toBe("v0.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // The real Git subprocess sequence exceeds Vitest's 5s default on Windows.
}, 30_000);
