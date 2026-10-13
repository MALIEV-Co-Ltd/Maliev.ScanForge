# ScanForge project files and recovery

Save project downloads a portable `.scanforge` file. Open it using Import, Open scan, or drag and drop. A file includes the current objects, exact CAD BREP where available, NURBS patches, parametric recipes, object properties, saved selections, sketch authoring, and the complete model timeline. Past and redo revisions, their labels, and the current timeline position survive reopening. Another user can load the file, seek the timeline, and continue modeling. Kernel IDs are regenerated in an isolated worker before the existing document is replaced. If validation or CAD restoration fails, the existing document stays intact.

Modeling revisions are no longer truncated after twenty steps. Shared geometry and BREP payloads are stored once per file. The timeline covers the application's existing modeling history; camera navigation, measurements, fit previews, and separate sketch gesture undo stacks are session state, rather than modeling revisions. Legacy JSON files continue to open, but cannot recover history they never contained.

## Binary container version 2

All integer header fields and floating point payloads use little endian encoding.

| Offset         | Length          | Meaning                                    |
| -------------- | --------------- | ------------------------------------------ |
| 0              | 8 bytes         | ASCII signature `SCANFRG2`                 |
| 8              | 4 bytes         | Unsigned 32-bit UTF-8 manifest byte length |
| 12             | 4 bytes         | Unsigned 32-bit stored payload byte length |
| 16             | Manifest length | Human-readable JSON manifest               |
| After manifest | Payload length  | Contiguous binary chunks                   |

The manifest contains `format: "scanforge-binary"`, `version: 2`, project `name`, `units: "mm"`, sketch `authoring`, an entity `records` table, a `chunks` table, and `current`, `history`, and `future` states. State entity lists are zero-based record indices. Revision entries contain a `label` and an `entities` index list. History runs from oldest to newest; future runs from next redo to latest redo. The current cursor equals the history length.

An entity record preserves authored metadata; positions, CAD edges, normals, hidden/saved facet indices, and BREP reference chunks using `{ chunk, type }`. The type is `f32`, `f64`, `u32`, or `text`. Existing Float32 coordinates stay Float32; JavaScript number arrays use Float64 without rounding. Facet indices use unsigned 32-bit integers. BREP uses UTF-8. Each chunk records its contiguous `offset`, stored `bytes`, `rawBytes`, `codec` (`raw` or `gzip`), and SHA-256 of the uncompressed bytes. Gzip is used only when smaller. Identical chunks and entity records are deduplicated across all states. The address range for each header length is 32 bits; this is a format limit rather than a precision tradeoff.

Loading verifies header lengths, chunk boundaries, codecs, decompressed lengths, SHA-256, references, geometry, authoring data, and feature relationships in every state. Decompression reads in bounded batches and rejects output beyond the declared length. The internal validated project model remains version 1; container versioning is separate from that model.

## Browser backups

IndexedDB stores binary project snapshots locally on the current browser origin. Every 30 seconds, an eligible changed project is backed up; mouse clicks, navigation, and individual modeling actions do not trigger writes. Unchanged projects and busy operations are skipped. There is no additional write on page hiding or refresh, so the interval bounds how much recent work may be absent from recovery.

Each project has a stable identity, stored in the optional `projectId` manifest field. Loading a saved file with this identity or restoring its browser backup continues the same entry. New documents get new identities. Legacy files without an identity receive one when opened. A successful write atomically replaces that project's entry and removes its legacy `:previous` snapshot; restoring a previous-format snapshot continues the original project identity. Tabs independently opened as new documents remain separate; two tabs editing the same identified project share its backup entry, with the last completed write taking precedence.

Main → File → Backup displays project names, saved times, and small viewport thumbnails, and opens automatically when an empty workspace has backups available. Restore uses the same validation and CAD restoration path as a project file. A recovered document stays marked unsaved. Each row has a trash button: click once to show confirmation, then click it again to remove that project backup and any legacy previous snapshot. Moving focus away or pressing Escape cancels confirmation. Deletion serializes after active writes; deleting the open project's backup pauses automatic backups for that document for the rest of this page session, leaving the open model unchanged. Storage failures remain visible inside this dialog, and failed transactions preserve existing snapshots.

Thumbnails are viewport captures at backup time, encoded as WebP at up to 192 × 128 pixels. They are stored alongside the binary file in IndexedDB. Missing or failed thumbnail capture never prevents the project backup from saving. Old backups without images show a placeholder.

Browsers can terminate asynchronous work during refresh or shutdown, so recovery guarantees only the last completed interval backup. Explicit `.scanforge` files provide portable storage beyond browser clearing, origin changes, or private browsing. Compression ratios depend on the project's contents; no fixed reduction is promised.
