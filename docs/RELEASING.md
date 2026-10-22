# ScanForge releases

This repository creates source releases. It does not deploy a website or upload
compiled CAD binaries. ScanForge will become a frontend service of the
Legacy.Maliev.* site; deployment integration is separate work.

Every push to `main` runs the existing build, unit suite, native CAD smoke suite
and formatting checks. Publishing requires an explicit manual dispatch of
**Release validated source** on `main`, after validation of that exact SHA passes.
Pushing a checkpoint does not publish a release. Release processing is serialized;
rerunning the same SHA reuses its tag. Pull requests, failed runs and superseded
builds cannot publish.

## Version decisions

- **Major:** substantial new application capabilities or meaningful changes.
- **Minor:** improvements and bug fixes grouped into a milestone.
- **Patch:** small deployable increments; source, runtime assets, build scripts
  and dependency changes default to patch. Docs/tests alone do not bump a version.

When preparing a change, Codex chooses its release type and writes a Git commit
trailer if needed: `Release-Type: major`, `Release-Type: minor`,
`Release-Type: patch` or `Release-Type: none`. The largest requested increment
since the last release wins. Major resets minor and patch; minor resets patch.
Use `none` for deliberately nonrelease commits. Release versions derive from
the highest version tag reachable from main, with `package.json` as the initial
baseline. Version tags are authoritative; no bot commits or CI recursion.

The first actual release uses the checked-in baseline **v0.1.0**, without an
increment. Automatic increments begin only after that first version tag.

## Useful release notes

Before a major/minor increment, author `docs/releases/vX.Y.0.md` describing the
user-visible outcome, significant changes and known limits. The release script
requires these notes and appends the complete commit history since the previous
major/minor tag, including all intervening patches. Conventional `feat:` and
`fix:` subjects get their own groups; other descriptive commits are also kept.
Patch versions create an annotated tag only, without a GitHub release or separate
release notes. Their changes appear in the next milestone's notes.

Inspect a plan locally with `node scripts/release.mjs plan` (read-only Git;
output plan and cumulative notes are ignored under `.resources`). `publish` writes tags and GitHub
releases and belongs in the validated workflow, not local validation.

Future production builds must stamp package metadata from the selected release
tag before building (`npm version X.Y.Z --no-git-tag-version --ignore-scripts`)
so the badge matches the shipped version. Local development shows the checked-in
package baseline. Runtime badges link to GitHub releases.

The current binary provenance gate in [CAD distribution](CAD_DISTRIBUTION.md)
still applies before distributing compiled kernel assets. Source release
automation does not clear that gate. No deployment credentials are needed.
