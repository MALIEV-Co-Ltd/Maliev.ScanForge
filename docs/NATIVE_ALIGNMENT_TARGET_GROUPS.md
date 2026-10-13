# Native alignment target-group query

The orientation worker `0x140aa96b0` and distance worker `0x140aa9a20`
iterate prepared targets in controller order. Every target receives the original
query radius. A hit replaces the current candidate only when its absolute
signed distance is strictly smaller. Equal-distance hits retain the first target,
including its normal and boundary classification.

Retained REA evidence for the orientation worker is
`ev_5bce5f6475e8be17af75b3718c6b0eed6361064149ff631f69c78fad90a7ccc7`.
The static target-loop observation was checked against the retained worker
pseudocode, and seven new executions of the original controller `0x140aa91c0`
and original query workers confirm its numerical consequence.

`tests/fixtures/alignment-target-group-native.json` captures nearest-first,
nearest-later, reordered distance ties, distinct targets per vertex/lane, and
three-target cases. The probe constructs triangle/query-node records directly
and preserves original query/controller arithmetic. CRT square-root/cosine and
progress imports are bound; task dispatch invokes lanes serially. It does not
execute the original target constructor or native UI, nor prove real multicore
scheduling. The retained image digest is checked before execution.

`nativeAlignmentTargetGroupQuery` implements this ordering. Eight focused tests
compare the ported controller objective, worker squared errors, maximum distances,
and orientation signs against all seven captures and check radius preservation.
A two-lane case with opposing nearest-target normals rejects a lane and produces
the native Float32-maximum sentinel; it must not be replaced by averaging only
successful workers.

The shared surface-refinement operation now prepares ordered indexed mesh target
groups. GUI additional fixed surface checkboxes and MCP `targetIds` use the same
request builder, geometry validation and worker. Target buffers are copied before
transfer and remain immutable. Existing single-target requests remain supported.
CAD-surface target queries and enclosing native application-controller comparisons
remain unverified; this operation accepts indexed mesh surfaces only.

Seven further captures execute the complete original refinement thread
`0x140aaa250` on those controlled target groups. The probe binds allocation/free,
CRT memory and trigonometry imports and the security-cookie check while retaining
the original optimizer, six-parameter transform, controller and geometry queries.
The initial best objective uses the native Float32-maximum sentinel. Seven port
comparisons match initial/best objective, final parameters, convergence and final
matrix exactly using the fixed 1,000-evaluation budget and Float32 step.

The two-lane rejection case demonstrates a separate search contract: the original
thread can signal convergence while retaining the sentinel objective and identity
matrix. Convergence therefore does not by itself establish useful correspondences.
These captures still construct target query-node records directly, use serial
lane scheduling, and do not execute the target constructor or native UI.
