import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
export function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return match.slice(1).map(Number);
}
export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
export function bumpVersion(version, type) {
  const [major, minor, patch] = parseVersion(version);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Invalid release type: ${type}`);
}
export function commitType(message, files) {
  const markers = [
    ...message.matchAll(/^Release-Type: (major|minor|patch|none)\s*$/gm),
  ];
  if (markers.length > 1)
    throw new Error("A commit must have at most one Release-Type trailer.");
  if (markers.length) return markers[0][1];
  return files.some((file) =>
    /^(src\/|public\/|scripts\/|package(?:-lock)?\.json$|vite\.config\.ts$)/.test(
      file,
    ),
  )
    ? "patch"
    : "none";
}
export function createPlan() {
  const head = git("rev-parse", "HEAD");
  const baseline = JSON.parse(readFileSync("package.json", "utf8")).version;
  const tags = git("tag", "--merged", "HEAD", "--list", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .sort(compareVersions);
  const latest = tags.at(-1);
  const current =
    latest && compareVersions(latest, baseline) >= 0
      ? latest.slice(1)
      : baseline;
  const taggedHead = latest && git("rev-list", "-n", "1", latest) === head;
  const hashes = taggedHead
    ? []
    : git("rev-list", "--reverse", latest ? `${latest}..HEAD` : "HEAD")
        .split("\n")
        .filter(Boolean);
  const commits = hashes.map((hash) => ({
    hash,
    message: git("show", "-s", "--format=%B", hash),
    files: git(
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      hash,
    ).split("\n"),
  }));
  const types = commits.map((commit) =>
    commitType(commit.message, commit.files),
  );
  const type =
    ["major", "minor", "patch"].find((type) => types.includes(type)) ?? "none";
  const version =
    !latest || taggedHead || type === "none"
      ? current
      : bumpVersion(current, type);
  const tag = `v${version}`;
  const milestone = parseVersion(version)[2] === 0;
  const previousMilestone = tags
    .filter(
      (item) => parseVersion(item)[2] === 0 && compareVersions(item, tag) < 0,
    )
    .at(-1);
  return {
    head,
    version,
    tag,
    type: !latest ? "initial" : type,
    release: !latest || taggedHead || type !== "none",
    milestone,
    previousMilestone: previousMilestone ?? null,
  };
}
export function renderNotes(plan, commits, curated) {
  if (!curated?.trim())
    throw new Error(
      `Write useful release notes in docs/releases/${plan.tag}.md before a major/minor release.`,
    );
  const groups = {
    "Features and improvements": [],
    Fixes: [],
    "Other changes": [],
  };
  for (const { hash, subject } of commits) {
    if (/^Merge\b/.test(subject)) continue;
    const group = /^fix(?:\(|:)/i.test(subject)
      ? "Fixes"
      : /^feat(?:\(|:)/i.test(subject)
        ? "Features and improvements"
        : "Other changes";
    groups[group].push(
      `- ${subject.replace(/[<>]/g, "")} (${hash.slice(0, 7)})`,
    );
  }
  const range = plan.previousMilestone
    ? `${plan.previousMilestone}...${plan.tag}`
    : plan.tag;
  return `${curated.trim()}\n\n## Complete change history\n\nIncludes intervening patch versions since ${plan.previousMilestone ?? "the beginning of the project"}.\n\n${Object.entries(
    groups,
  )
    .filter(([, items]) => items.length)
    .map(([name, items]) => `### ${name}\n\n${items.join("\n")}`)
    .join(
      "\n\n",
    )}\n\n[Full source history](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/${plan.previousMilestone ? "compare" : "commits"}/${range})\n`;
}

function writeNotes(plan) {
  const range = plan.previousMilestone
    ? `${plan.previousMilestone}..${plan.head}`
    : plan.head;
  const commits = git("log", "--reverse", "--format=%H%x09%s", range)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });
  const notes = renderNotes(
    plan,
    commits,
    readFileSync(`docs/releases/${plan.tag}.md`, "utf8"),
  );
  writeFileSync(".resources/release-notes.md", notes);
}

function main() {
  const command = process.argv[2];
  mkdirSync(".resources", { recursive: true });
  if (command === "plan") {
    const plan = createPlan();
    if (
      plan.release &&
      plan.milestone &&
      !existsSync(`docs/releases/${plan.tag}.md`)
    )
      throw new Error(`Missing docs/releases/${plan.tag}.md`);
    writeFileSync(
      ".resources/release-plan.json",
      JSON.stringify(plan, null, 2),
    );
    if (plan.release && plan.milestone) writeNotes(plan);
    console.log(JSON.stringify(plan, null, 2));
    if (process.env.GITHUB_OUTPUT)
      for (const key of ["release", "version", "tag", "milestone"])
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${plan[key]}\n`);
  } else if (command === "publish") {
    const plan = JSON.parse(
      readFileSync(".resources/release-plan.json", "utf8"),
    );
    if (!plan.release) return;
    if (git("rev-parse", "HEAD") !== plan.head)
      throw new Error("Release head changed after validation.");
    const existing = git("tag", "--list", plan.tag);
    if (existing && git("rev-list", "-n", "1", plan.tag) !== plan.head)
      throw new Error("Release tag already belongs to another commit.");
    if (!existing)
      git("tag", "-a", plan.tag, plan.head, "-m", `ScanForge ${plan.tag}`);
    git("push", "origin", `refs/tags/${plan.tag}`);
    if (!plan.milestone) return;
    writeNotes(plan);
    const gh = (...args) => execFileSync("gh", args, { stdio: "inherit" });
    try {
      execFileSync("gh", ["release", "view", plan.tag, "--json", "tagName"], {
        stdio: "pipe",
      });
    } catch {
      gh(
        "release",
        "create",
        plan.tag,
        "--verify-tag",
        "--title",
        `ScanForge ${plan.tag}`,
        "--notes-file",
        ".resources/release-notes.md",
      );
    }
  } else throw new Error("Usage: node scripts/release.mjs plan|publish");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
