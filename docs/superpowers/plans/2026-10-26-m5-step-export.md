# Shared exact STEP export

Preserve the GUI's exact-only visible export behavior through the existing
`project_export` job. Add explicit `cadOnly` (STEP only, default false), retain
strict existing agent defaults, and return excluded object IDs when requested.
Reject empty exact selections and misuse on other formats before kernel work.
GUI submits that shared job, receives its immutable artifact Blob without
base64 copies, downloads it and releases the artifact. Keep artifact quotas,
owner/revision fences and native/job leases. Own a reachable cancel control and
abort on unmount; no second busy owner.

- [x] Red/green public contract tests: strict mixed rejection, exact-only subset,
      hidden inputs, empty/misused options, immutable local artifact delivery,
      disposal and unchanged history.
- [x] Implement shared selection/output and GUI job/delivery/cancellation.
- [x] Built actual GUI download vs public MCP STEP contents and exact properties,
      errors and cancellation, preserving the source scene.
- [x] Docs, focused/full verification, static review, receipts and draft PR push.

Native reference and full M5 acceptance remain separate gates.
