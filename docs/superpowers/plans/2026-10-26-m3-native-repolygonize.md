# M3 exact native reconstruction integration

The owner requires exact native Re-polygonize parity before M3 closes (2026-10-26). PR #11 remains draft. Other chats, their checkouts and the live native session remain unchanged; only immutable Git objects and retained artifacts supply reference evidence.

## Implementation

Port the reconstruction slice of immutable commit `6217bea1adad4e00c15e67356f984270e8fd5395`, not its unrelated processing changes. Its five native modules implement signed-field extraction, finalization and native default half-count optimization. Existing reduction, STL-topology, adjacency and mesh-processing dependencies match M3 already. Preserve M3 facet state, typed cloud/mixed voxel inputs and original shared-buffer/project reuse.

Use one shared method resolver and target binder. Mesh reconstruction defaults to native; cloud/mixed reconstruction retains voxel support. Explicit native mode rejects unsupported point inputs. Native omitted targets include visible eligible meshes in scene order; an explicit empty list means source alone. GUI method/default/target controls and MCP discovery must expose the same contract. Explicit voxel mode preserves its replacement and retained-target semantics.

Native mode creates/selects a new owner and hides unchanged inputs; `createNew:false` replaces the requested owner. Carry trusted modeling-visibility provenance through commits, Undo/Redo, timeline, binary encoding/decoding and both GUI/MCP reopen. Do not replace M3 project or transport implementations wholesale. Preserve all revision, retry, lock, cancellation and resource guards.

## Ordered work

1. Add the native kernels, cases and finite observed control; run exact coordinate tests and explicit legacy-voxel regressions.
2. Merge topology-aware worker transport and shared method/binding/publication. Verify preclone admission includes every transmitted carrier.
3. Merge visibility-history metadata and GUI restore, preserving immutable geometry and shared-buffer aliases.
4. Update GUI, catalog, agent guide and architecture; test shared defaults, unsupported inputs, injected topology, source order, new/replacement ownership and failure atomicity.
5. Build and pin the new source/assets; run focused and full tests, CAD and formatting.
6. Run complete original-input GUI/public-MCP reconstruction against retained native ordered corners and normals, with full source-buffer invariance, diagnostics, cancellation/retry/revision/history and persistence.
7. Record native topology as measured, including open/nonmanifold/duplicate results. Retain independently assessed voxel output as the closed-envelope route. Native equality does not imply solid validity or uniform registration improvement.
8. Finish the pending full PLY Fine and ASC rendered views on the final candidate. Obtain final-candidate hosted CI after availability is restored; review, normal expected-head merge, then verify issue #3 and milestone #4 closure.

## Exact comparison and evidence boundaries

The retained full reference has 50,895 ordered facets. Its source/export hashes and observation authority must be explicit; the owner cannot attest the legacy STL/QSF settings. The committed M2 record supplies retained analyst observation, not a newly captured native run. The 136-facet control is separate. Do not turn an undocumented action log into an observed receipt.

Compare every ordered Float32 corner and all observed output-normal bytes. The complete normal diagnostic reproduces the reference using angle-weighted vertex normals and `f32(f32(f32(n0+n1)+n2)/3)`, without renormalization; native attributes are uniformly `0x2020`. Distinguish geometry/normal comparisons from exporter padding/header metadata and from unobserved internal native carriers. Do not populate output from reference geometry or transforms.

All heavy work remains serial and owned, with 4 GiB aggregate memory, 25% CPU and finite leases. Preserve previous failed receipts. Any new validation filesystem/profile mode must identify its actual write volume and keep the 6 GiB available-capacity/RAM checks there; never relabel earlier failed C: admission as a pass. Existing current-build C: default-profile PLY persistence remains separately scoped evidence.

## Verification result

Runtime implementation and the listed comparison/lifecycle work pass on `296925eac314f49c2875bcbdb5ea5245e2cf6fe9`, build `scanforge-bab4f9199590cf11`. See [the final acceptance ledger](../../M3_ACCEPTANCE.md), [native operation evidence](../../evidence/m3-native-repolygonize-final-20261026.json), and [reference provenance](../../evidence/m3-native-repolygonize-reference-20261026.json). The local-C full case includes seven exact result states, actual project export/reimport, reopened history and unchanged source/assets. Earlier network-profile Blob I/O failures remain failed evidence.

The comparison covers indexed/ordered geometry and every observed native STL normal vector through the recovered Float32 mean encoding of actual application vertex normals. It does not claim unknown QSF cache fields or whole-file identity from the generic STL exporter, which continues to write unit geometric normals and zero attributes. Retained native topology is open/nonmanifold; independently assessed voxel output supplies the closed-envelope route. Current Global, coupled original PLY Fine, ASC rendered views, fixture restoration and source review are recorded separately in the acceptance ledger. Final-head CI, normal merge and closure are tracked by [PR #11](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/pull/11), [issue #3](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/3) and [milestone #4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/milestone/4).
