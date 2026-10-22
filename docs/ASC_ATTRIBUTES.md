# ASC attributes through GUI and MCP

ASC imports default to **XYZ / RGB colors**. The reader detects whitespace,
comma or semicolon separation in the first fifty native-sized reader chunks,
then retains that separator. It attempts three Float32 coordinates plus three
decimal integer colors; successful colors retain the low eight bits with
alpha 255. Records with readable XYZ but no complete integer RGB parse use
white. Records without readable XYZ are skipped. Coordinates must be finite
and within the existing supported range; color integers outside signed 32-bit
range are rejected because native CRT overflow behavior is not yet verified.
Native reader chunks contain at most 199 characters; UTF-8 decoding is strict.
Non-ASCII encoding and native locale parity remain unverified.

Choose **XYZ / scanner normals** explicitly for XYZ NX NY NZ files. This
preserves the former ScanForge extension: all non-comment records must have
consistent three or six columns; six-column floats become normals. Six integer
columns are ambiguous, so the application does not guess their meaning.
Existing saved normals retain their original meaning when reopened.

In Settings → Scan import, **ASC attributes** changes future imports only.
Agents read the same setting as `project_get.settings.importAscAttributes` and
write `settings_set.patch.importAscAttributes`, with `xyz-rgb` or `xyz-normal`.
Single and batch `project_import` accept an optional `ascAttributes` override;
omission captures the shared preference. An explicit override does not change
that preference. Revision, retry, cancellation and per-file history contracts
remain the same as other imports. Source-coordinate placement and units remain
independent of attribute interpretation.

Point-cloud summaries expose `ascAttributes` and, for colored clouds,
`pointColorAttributes: { encoding: "rgba8", points, bytes }`. They omit bulk
color bytes. Use `object_get(includeGeometry: true)` for the explicit byte array
or `object_geometry_digest` for its canonical `pointColors`/`u8` SHA-256.
Colors index point slots and remain unchanged under rigid placement and units.
Deletion, extraction, voxel and count reduction retain the exact corresponding
source colors; smoothing preserves colors by point slot. Selection and
deviation overlays do not replace authored colors.

JSON saves containing new cloud attributes use wire version 2; binary project
and backup containers use version 4. Older readers reject these versions rather
than silently dropping attributes. Current readers retain older files, and
ordinary files without new attributes retain their prior versions. Color
chunks are byte encoded and deduplicated through current state and history;
they are not expanded into binary manifest metadata. Restore and Undo/Redo
preserve the carrier. Mesh-only exports do not export point-cloud colors.

The native reader binding is documented in
[the current native ASC investigation](NATIVE_ASC_IMPORT_CONTRACT.md).
Retaining native color bytes does not establish native displayed-color parity:
Three's normalized vertex colors use its linear working space and sRGB output,
while the native framebuffer transfer function remains unverified. Full native
GUI ASC outcomes and downstream native alignment admission are still open.
