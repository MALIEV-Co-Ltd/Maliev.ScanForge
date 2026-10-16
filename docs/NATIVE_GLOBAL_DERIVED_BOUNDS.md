# Derived bounds during compact evaluator construction

Compact evaluator construction now derives the six triangle bounds from the
immutable indexed coordinates while classifying a triangle into child cells.
The six-value scratch is reused for the complete tree. It no longer allocates
and later detaches a full per-face Float32 bounds carrier.

The cached-bound path is unchanged and remains the default. Compact query
arithmetic, native membership ordering, root construction, hidden-face filtering,
normal caches and packed metadata are unchanged. Optional bounds remapping is
accepted only with an actual stored bounds carrier; derived bounds follow the
provided compacted indices directly.

For the retained three-scan input (6,147,452 faces), the removed allocation totals
147,538,848 bytes (140.70 MiB) across the three preparations. The targets are
prepared sequentially, so this total is not a claim that simultaneous process
peak or browser heap drops by that amount. The largest individual allocation is
removed before it exists. The temporary node graph and membership arrays remain;
this does not yet establish admission under the production 512 MiB query-pool
budget. No admission limit was raised and no public capability was enabled.

## Validation

Eleven new indexed-tree regressions failed before implementation because the
old carrier required stored bounds. The production build and 872 focused tests
then passed, including complete cached/derived tree equality, original native
evaluator construction in both storage modes, malformed inputs, packed query
fixtures and preparation lifecycle checks.

The complete canonical controller replay is independently checked against the
same [native result](NATIVE_GLOBAL_CANONICAL_CONTROLLER.md). The optional
`SCANFORGE_NATIVE_CANONICAL_STORAGE=compact` selects this storage policy for that
diagnostic. It does not bypass production admission in normal application code.
The replay records process-memory checkpoints; these are sampled observations,
not guaranteed peak measurements.

GUI and MCP retain the same shared application kernels and schemas. This change
adds no separate GUI/agent implementation or new public storage option. Large
owner-scan physical-worker registration and GUI/MCP Apply/cancellation/history
remain separate completion requirements.

The complete compact replay passed all 19 native pass snapshots, final states and
six matrix commands: 439 queries and 57 local refinements in 300.95 seconds,
including 6.81 seconds of scene preparation. The earlier five-minute diagnostic
expired before its final assertions; that failure is retained. Only the optional
compact diagnostic was extended to a finite ten-minute query deadline and an
eleven-minute test deadline. Production timeouts and all memory guards were
unchanged. This timing is not a controlled speed comparison with the earlier
185.01-second cached run; it supports retaining the faster cached default.

The [recorded evidence](evidence/native-global-derived-bounds.json) includes 58
post-preparation/controller memory checkpoints. Their sampled maxima were
725,729,280 bytes RSS, 280,052,752 heap bytes and 309,831,373 ArrayBuffer bytes.
These are separate sampled maxima, not simultaneous construction peaks. They
exclude the browser renderer, physical query workers, rendering and project
history. Total process RSS still exceeds 512 MiB; production admission remains
unproven and unchanged.

Physical-browser replay passed 64 native comparisons, two pose checks, two
single-worker fallback checks and two physical query workers. The independent
synthetic registration reached zero gap after five queries. All 71 worker
handles were terminated, the disposable browser closed and its PID was verified
absent. This does not establish physical-worker registration of the large owner
scans. The isolated production build passed with fingerprint
`scanforge-4cfd5eaea0a6d8a9`.

The full default suite passed 46,400 tests with 53 optional skips and zero
failures (466 passed test files, 15 skipped) in 223.51 seconds. The large compact
replay was explicitly executed separately and passed both its metadata and full
controller tests. All final convergence/stability flags remain false, matching
the native identity-start case; this is not successful registration within
tolerance. Build, focused checks, large replay, browser replay and full suite
were serialized. Unrelated working-tree changes were preserved and excluded from
the isolated build/suite snapshot.
