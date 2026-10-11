# Direction-field numerical component

`src/field-linear-solver.ts` implements the recovered active-support conjugate-gradient recurrence and optional inverse-diagonal scaling. It is a numerical component for the reconstruction pipeline under investigation. It is not connected to the freeform command and does not generate patches/topology.

`src/field-system-assembly.ts` now supplies the recovered connection equations to this solver. Its graph, fixed values, integer quarter-turns, anchor classification and global connection weight remain explicit caller inputs. It does not infer any of them from a scan. The native producer and UI option mapping remain unrecovered.

## Connection assembly

For a connection from node L to node R, weight w adds w to both free diagonals and -w to the paired free off-diagonals. A fixed neighbor instead contributes its angle times w to the free node's right-hand side. For L, the transported angle times w is added and the integer quarter-turn count times w times float pi/2 is subtracted; R uses the opposite signs. Transported angles use float precision, while accumulation uses double precision. The quarter-turn constant is 1.5707963705062866.

Anchor strengths use float precision. Only strengths strictly above float 0.000002 contribute to a free node: strength goes on its diagonal, and strength times the supplied target angle goes on its right-hand side. Fixed nodes are eliminated in ascending node order; their anchors do not affect the remaining system. The browser representation combines repeated matrix entries and sorts column indices. This is an independently authored sparse representation, not native container or bitwise arithmetic equivalence.

The assembled equations are supported by REA evidence `ev_91d61461e811b599c9c2108d3fc1f32b528e09ef018bce814535d8fdc37b55f2`, specifically the row-assembly section of the recovered smoothing solve. No scan classification or weight/default semantics follow from those equations. An unanchored connected component can remain singular; assembly does not certify a unique solution. Do not treat the iterative solver's stopping status as a positive-definiteness certificate.

Six assembly tests cover fixed-neighbor elimination, an oriented chain solved through the iterative component, quarter-turn constants and orientation reversal, the strict anchor cutoff, fixed anchors, repeated connections, sorted sparse entries, explicit zero rows and invalid/overflowing input. These are synthetic numerical tests, not a full scan-to-surface workflow.

## Input and ownership

The caller supplies a full symmetric positive-definite matrix as sparse rows (`offsets`, `indices`, `coefficients`), a right-hand side, an initial solution and unique residual seed indices. Symmetry and positive-definiteness are caller preconditions, not certificates produced by this component. Missing or zero diagonal entries use scaling one. Recovered scaling lookup semantics for duplicate diagonal entries are unresolved; callers should supply unique matrix entries.

The seed list initializes residual support. It is not a mask of variables that must remain fixed. Sparse multiplication expands support into neighboring indices, including explicit zero entries, and retains isolated seed indices. Variable fixing is a separate operation described below; selecting integer targets from scan-derived state remains unresolved.

## Fixed-variable update

`src/field-variable-fixing.ts` implements the recovered full compressed-row branch from REA evidence `ev_7f5d5f386506c9187eae505a76b1f2e323a8bf5641868093027987ca1b6fde55`. For a chosen variable and value, the diagonal becomes one, its right-hand side becomes the chosen value, and its off-diagonal coefficients become zero. Each paired neighbor coefficient is also cleared after subtracting that coefficient times the chosen value from the neighbor's right-hand side. Explicit zero entries and the sparse dimensions remain intact. Multiple distinct choices are applied sequentially.

The browser component copies all arrays and requires sorted unique full symmetric rows with an explicit diagonal in every row. Validation of malformed inputs, duplicate choices, nonfinite numbers and overflow is independent browser hardening. Symmetry is checked; positive-definiteness is not certified. Each variable must be fixed only once per original system: already-cleared coefficients cannot restore earlier contributions if a target is changed later. The native nested-container branches have different storage/update paths and are not implemented by this CSR component.

Six tests cover paired elimination, input ownership, solving fixed equations, adjacent choices in either order, explicit zero neighbors, empty inputs, malformed/asymmetric systems and overflow. A pipeline test compares the full fixed system against independently assembled fixed-node reduction on an oriented connection graph, then checks every solved equation. These are synthetic numerical checks; native runtime and complete scan workflow parity remain unverified.

Input arrays are immutable. Results contain a separately owned solution, iteration count, active count and initial/final residual statistics. Malformed dimensions, invalid indices, duplicate seeds, nonfinite inputs and invalid limits are rejected. Nonfinite intermediate statistics and denominators return breakdown; these browser guards are independent input hardening, not established native failure parity. Cancellation is checked before allocation and at iteration boundaries; execution remains synchronous and has no worker transport yet.

## Recovered numerical policies

- Initial residual is the right-hand side minus each seeded sparse row's product with the initial solution.
- Unscaled statistic is residual squared norm. With diagonal scaling it is residual dot inverse-diagonal-scaled residual.
- An initial statistic below 0.00001 returns without iteration. This absolute gate can accept a small nonzero residual.
- Relative stopping compares the current statistic with the initial statistic times tolerance squared, using strict less-than.
- Iteration limit -1 means 1,000 iterations. Zero means no iterations. Limits use the native signed 32-bit range.
- The recurrence uses active-support sparse multiplication, step size from statistic divided by direction dot product, solution/residual updates, and the next direction from scaled residual plus the previous direction times the statistic ratio.
- A zero denominator returns breakdown. The final iteration limit is checked before another convergence test, so a solution reaching zero residual on the last permitted iteration still reports the limit.

These contracts derive from canonical REA evidence `ev_79c45654af004a2f7defbbebfc30ca1c4fe375c23b2919938fb247395c465bb4`, `ev_185bd4b2d248ba3bafc595bd3cc93f850d6efb1fa80ae79b1f50fe42bfa18313`, `ev_2e972280a495773bd5e6de0c34467cd38cb1ccb9bda1459b3cb11580a65d105d`, `ev_803e848d7702ba440acf1a46d86ee0e8907f739ed22c414b274e1415de5483df`, `ev_4ad3778cde4a224b65d83896ea788e7881373dfec486939c63b9e1471e9f5703`, `ev_609628d949058aaa92a12a7e77ea310284d970c862fc677256d100fca5a4d527`, `ev_30b2f149d0b42752f2c8757e98fd1b8844454d83030d6de21c43a45f640ed344`, `ev_6e2390355da1039d0ea2083006aeb5b95eb7eab9e4ef7aa9279b97c028c3345d` and `ev_066dbf9828e35ddf8120a69413aac5193861c23a0054913ff1475ab8c4661ff5`. Call-site assembly confirms the arguments omitted by the caller's inferred decompiler prototypes. Raw pseudocode remains private.

## Validation and remaining boundary

Seven tests cover a known coupled system, a 64-variable manufactured system with every equation checked and scaling both on/off, support expansion, nonzero initial values, input ownership, small-residual/last-iteration policies, zero denominator, zero iteration allowance, malformed inputs and pre-aborted cancellation. These validate the browser numerical contract, not a native runtime comparison or bitwise equivalence.

The sparse-factorization branch remains separate and is not implemented by this iterative component. Scan-derived connection assembly, boundary constraints, integer selection and owner callbacks, and topology extraction must be recovered and integrated before automatic freeform reconstruction can be claimed. The existing projected-grid fitter remains independent.
