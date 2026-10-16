# Three-scan coarse placement checkpoint

The alignment milestone requires successful registration as well as agreement
with native output. The identity-start controller replay documented in
[the bounded pool checkpoint](NATIVE_GLOBAL_BOUNDED_POOL.md) matches the retained
native pass snapshots and setter commands, but its result is non-converged.
The application issued 439 query batches; that count was not independently
captured in the retained native oracle.

After deterministic coarse placement, a second complete three-scan target
preparation exposed an allocation peak at the immutable index handoff. The
builder allocated all three final buffers while every staging block remained
live. It now copies and retires staging families in sequence: values, links,
then memberships. Output ordering and numeric contents are unchanged. Authored
input buffers are never detached. Runtimes that cannot transfer scratch buffers
continue to charge that storage conservatively.

The coarse placement uses the existing deterministic PCA/trimmed-ICP heuristic
on retained indexed vertex carriers. This is neither a native coarse algorithm
claim nor verification of the GUI's triangle-soup coarse input route. The two
moving scans had coarse residuals of approximately 0.789 and 0.267 mm; these
numbers alone do not establish correct orientation or successful registration.

The complete seeded preparation passed with the unchanged whole-scene limit:

| Accounted storage                   |       Bytes |
| ----------------------------------- | ----------: |
| Input backing and runtime reserve   | 372,701,152 |
| Retained live total                 | 527,734,620 |
| Peak including construction scratch | 535,885,444 |
| Limit                               | 536,870,912 |

Preparation and complete target hashing took 16.60 seconds. These are accounted
typed allocations, not total process memory. Seeded target hashes have not yet
been compared with a completed native seeded capture. Original input files were
not freshly rehashed; retained carriers were checked against their recorded
SHA-256 identities before use.

The physical browser replay completed 19 passes, 476 query batches and 57 local
refinements through two query workers, followed by staged transforms of all
three full entities. Final mean residuals were 0.958862667, 0.243217953 and
0.278299535 mm; coverage within 0.05 mm was 3%, 25% and 9%. All states remained
non-converged and unstable. This is a retained failing alignment case, not an
accepted successful registration. The seeded native comparison is still open.

The replay took 170.02 seconds and reported no page errors. All five scene,
query and transform worker handles terminated. The disposable browser and its
automation listener exited. Main-page heap samples peaked at 26,260,892 bytes;
this excludes typed backing storage, worker heaps and GPU memory, and these
meshes were not rendered in the editor viewport.

The isolated build passed without build warnings or errors. Focused validation
passed 702 tests in 13 files. The affected suite passed 46,439 tests, with 54
optional skips and no failures, in 210.61 seconds. Formatting and whitespace
checks passed for the changed source and regression. Unrelated working-tree
changes were excluded from that validation snapshot. The private shared
controller and existing public GUI/MCP contracts remain unchanged.

The optional owner-data preparation regression also passed, checking all nine
retained input carrier hashes and all three complete native target index,
facet-normal and neighbor-mask hashes after the handoff change. This verifies
the original canonical geometry; it does not replace the seeded comparison.

Further acceptance still requires the seeded native controller comparison, useful final
alignment, GUI/MCP preview and Apply parity, cancellation and history checks,
actual STL/PLY/ASC imports, combining the scans, and navigation measurements.
The global controller remains private while these requirements are open.

## Native probe lifetime control

A complete original-procedure control now verifies the revised private probe's
allocation and scratch lifetimes against the committed canonical oracle. Large
allocations use zero-initialized private Windows virtual memory rather than
eagerly zeroed Python buffers. Smaller allocations retain their previous backing.
All source angular layouts are copied and checked for independent empty
containers and identical scalar contents before the common scratch pool is
retired through its original destructor.

The complete scene preparation, evaluator controls, 19 pass snapshots, final
states, six setter commands, return value and clock stream match exactly. A
separate readback compared all eight corresponding output fields against the
committed fixture. The outer loop took 84.25 seconds. Tracked raw allocations
peaked at 1,544,046,562 bytes under the unchanged 1,610,612,736-byte ceiling.
The 4 GiB host admission, 1 GiB runtime free-memory guard and 240-second lease
also remain unchanged. The cleanup receipt confirms zero tracked bytes and
release of the executable mappings and exception handler; the owned process
exited.

The [control receipt](evidence/native-global-probe-lifetime-control.json) pins
the probe, result and committed fixture hashes. This is controlled shell runtime
evidence from retained original procedures, not a new REA Evidence ID or a native
UI capture. The original scheduler and full geometry setter outputs are outside
this capture. No application algorithm or public GUI/MCP contract changed.

This control does not close the seeded comparison. Its first revised capture
exited at the memory guard while checking the third target, without producing
a complete controller result. That attempt is retained separately and is not
reported as a successful comparison.

An additional attempt retires the image-file copy after mapping/patching and
the source arrays after checking their native copies. It reached outer pass 15
before the runtime memory guard stopped it. Full equivalence for those further
lifetime changes is unproven; the prepared seeded probe requires that control
to pass before it can run. Neither incomplete attempt changes the completed
control receipt above.

## Supplied merged reference diagnostic

The example folder also contains `final-aligned-and-merged-mesh.stl`, with
3,709,989 triangles and SHA-256
`a26aa1e3e9f572292fc40ba48074f1a9e736f7df9cee87ab4367bde5da8e91d5`.
A bounded streaming read verified the complete file and retained 20,054 uniformly
spaced triangle centroids for diagnostics. Its bounds closely resemble the
third scan's bounds, but the file's creation workflow and intended reference
frame have not been independently verified.

The existing coarse heuristic, searching all 24 candidates against that sample,
returned RMS values of 0.722, 0.260 and 0.270 mm for the three scans. It also
chose a large rotation for the third scan. This is a candidate ambiguity signal,
not proof of a correct pose or native coarse behavior. The sampled metric is
tessellation weighted and measures distances to sampled centroids; it cannot
certify a 0.05 mm surface tolerance. Future quality checks must resolve the
reference provenance and use adequate surface and orientation evidence.
