# Ribbon verification status

The ten supplied ribbon screenshots are the command inventory reference. Missing entries now appear in their corresponding tabs. Licensing commands remain excluded from the agreed scope. Every command has independently authored artwork.

## Status meanings

- **Verified:** an executed ScanForge workflow is recorded in the validation evidence. The command may still be disabled while busy, without an applicable object, or without an undo/redo step. This status describes the documented scope, not complete reference-application parity or unrestricted scan sizes.
- **In progress:** an implementation exists, but its complete UI workflow and reference options are not fully verified. The ribbon button is disabled.
- **Planned:** no command implementation exists. The ribbon button is disabled.

The explicit allowlist is in `src/ui/ribbon-verification.ts`. A registered callback or passing numerical test does not enable a command. Unknown implemented commands default to In progress. Buttons have native disabled attributes, visible status badges, and explanatory tooltips/accessibility descriptions.

## Verified command scopes

New document, scan import, project save, undo/redo, fit view, isometric and six standard views, wireframe, object color, appearance settings, deletion, STEP export and STL export retain their existing validated workflows. Evidence pointers accompany each allowlist entry. Export checks do not establish correctness of every advanced geometry producer. Import checks do not establish a complete over-1-GB editing workflow.

Edit Scan is enabled for the [documented Scan Data MVP](SCAN_DATA_MVP.md): live topology panels, stroke/area/wand selection, clipping, hole filling and boundary/selected-area operations. Its manufactured and browser validation does not establish native numerical equivalence or unrestricted input sizes. Other mesh processing, primitive fitting/construction, alignment, sketching, surfacing, Freeform, advanced CAD operations and analysis remain disabled in the ribbon until their complete workflows and options are verified. Their existing implementations and tests remain available in source for continued development. This ribbon gate does not claim to gate every other entry point, keyboard shortcut or inspector action. Physical SpaceMouse navigation remains a separate verification concern.

## Added inventory entries

| Tab       | Added or restored entries                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main      | Prepare scan; Deselect all; Extract primitives; Construct; Align; 2D sketch; Multiple sections; Surfacing; Auto freeform; Move face; Trim; Combine; Cut; Intersect; Pattern; Fillet / Chamfer |
| Construct | Plane from 2D sketch                                                                                                                                                                          |
| Surfacing | From 2D sketch                                                                                                                                                                                |
| Settings  | Millimetres; Inches; Metres; Language; Options                                                                                                                                                |
| Help      | Video tutorials; Help (PDF); Examples; Check for update; System log; Reset layout; Change log; Credits                                                                                        |

Existing entries in Edit / View, Scan Data, Freeform, CAD and Analysis were retained and subjected to the same gate. Help/update entries are placeholders for this project's own content and release service; they do not contact the reference vendor.

## Promotion requirements

A command must have an implemented UI with recovered reference options and behavior, focused regression coverage, executed complete browser workflows, and applicable validation of errors, selection requirements, undo/redo and persistence. Record the actual evidence and remaining limits before explicitly promoting its allowlist entry. Missing evidence keeps it disabled.
