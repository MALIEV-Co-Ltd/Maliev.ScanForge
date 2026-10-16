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
