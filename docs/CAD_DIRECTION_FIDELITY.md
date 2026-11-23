# Prepared line direction fidelity

The native interval wrapper retains its supplied analytic curve, endpoints and
parameters. Reconstructing that curve with OpenCascade's ordinary direction
constructor can normalize its direction again and change component/endpoint
bits. A retained prepared value must not silently become a different kernel
curve.

`src/cad/sketch-prepared-direction.ts` adapts the bundled OpenCascade.js 1.1.1
binding for this case. It constructs a newly owned direction, checks whether
its getters already match the prepared coordinates, and returns without any
memory access when they do. Otherwise it checks the Float64 heap view, binding
type metadata, pointer alignment/bounds and equality between the object's
existing three coordinate doubles and its public getters. It then restores
only those three doubles and verifies exact getter readback. Failed readback
restores the old values before disposal; cleanup failures preserve both causes.
The adapter touches only a newly owned object in our own kernel memory.

Prepared directions must remain near unit length: the squared norm must differ
from one by at most `32 * Number.EPSILON`. This is an application invariant
guard, not a recovered native tolerance or a new user setting. Unsupported
metadata/layout fails with an explicit error instead of silently changing the
geometry. No vendor WASM bytes are modified.

Kernel replacements must pass `tests/kernel-line-direction-fidelity-smoke.mjs`
in addition to the existing CAD tests. The smoke checks 100 deterministic actual
primary-to-converted-line fixtures against their retained prepared direction,
origin and both endpoint bit patterns. It also covers unavailable heap,
unsupported metadata, layout mismatch, readback rollback, aggregated cleanup
failure and nonunit input. Run under the repository's owned resource admission
and finite lease. A binding change may require adapting this small bridge;
never bypass its checks to make a replacement appear compatible.

This establishes the tested candidate's numerical preservation. It does not
establish complete original-native body admission, connection topology, editor
publication or GUI/MCP workflow acceptance. Evidence:
`docs/evidence/reference-sketch-direction-fidelity-20261024.json`.

Also run `tests/kernel-line-open-topology-smoke.mjs` when validating a replacement
kernel. It checks one-edge structure, distinct underlying endpoints, orientation,
exact prepared point/parameter values, short spans and repeated retirement.
It records the bundled tolerance floor separately from the requested semantic
tolerance; neither the tolerance floor nor two vertex occurrences establishes
native topology/admission equivalence by itself.
