# ScanForge shared application API and MCP

## Intent and scope

Provide semantic control of supported ScanForge modeling features through a standardized MCP interface while preserving the browser-local geometry runtime, existing editing semantics and unrelated work. The UI and agents share native CAD creation/rebuild use cases, geometry workers, validation and the project/history commit boundary. Existing GUI interaction code is retained; this integration does not relocate the entire React state tree or introduce a headless/cloud engine.

## Boundaries

`src/automation/catalog.json` is the wire-schema registry. The official SDK server reads it for MCP discovery. `ApplicationApi` validates the same schemas before dispatch, tracks workspace revisions/retry receipts and owns transient jobs/artifacts. `operations.ts` resolves explicit workspace objects and executes existing domain algorithms. `use-workspace-api.ts` adapts the current editor state to that gateway and publishes mutations synchronously before returning revision receipts. The editor uses shared CAD creation/rebuild helpers and routes modeling undo/redo through the gateway.

`scripts/mcp-server.mjs` implements MCP stdio using the official TypeScript SDK, plus the authenticated loopback HTTP queue. It never runs geometry or accesses arbitrary user files. `browser-bridge.ts` pairs explicitly, fetches command envelopes and posts structured results. `AgentConnection` owns connection controls with credentials held only in memory. The connection remains mounted while Settings closes.

The bridge's session identifier explicitly identifies the owning browser; it is independent of MCP transport/session versions. Geometry remains owned by the browser workers. There is one admission lane, not a duplicate agent worker pool. Heavy tools acknowledge a job immediately; agents read status separately. Native handles never appear in tool inspection output.

## Mutation correctness

All public mutations require `expectedRevision` and `requestId`. The revision includes geometry identity, metadata, authoring, selection, model history and relevant settings. A human action can advance it. Immediately before applying asynchronous work, the executor checks cancellation and whether the original revision is still current. Results that cannot be applied release newly owned native handles; previous model/history handles are preserved. Existing domain validation and lock checks run at commit.

Retry receipts are bounded to the latest256 requests and are transient. They prevent ordinary in-session duplicate writes, not crash replay. A changed request needs a new ID. Project imports restore exact bodies in a separate kernel before atomic replacement; failed imports dispose that kernel. A cancelled native operation retains the admission lane until cleanup settles.

## Connection and resource ownership

The bridge requires a >=32-character operator-supplied token, exact approved origins and loopback Host. OPTIONS is the sole unauthenticated preflight exception and grants no access. One browser owner, 60-second lease, queue64, poll batch16, body/command2MiB, 30-second response timeout and eight-hour service lifetime bound the bridge. Closing stdio closes HTTP service. Browser disconnect/page exit requests active-job cancellation; every worker retains its existing cleanup rules.

The API keeps at most32 terminal/running job records, latest256 retry receipts, and64 transient artifacts totaling64MiB. Artifact access checks a15-minute inactivity lease. No token/customer payload is stored in resource ledgers. The browser's normal IndexedDB backups and user project data are separate persistent resources.

## Implementation and verification plan

1. Define a shared schema registry, error/results contract, revision receipts, admission and bounded jobs/artifacts.
2. Bind existing geometry, CAD, sketch, surface, history and import/export services; resolve explicit object/feature references.
3. Add official-SDK stdio discovery/calls/resources and secure single-owner loopback pairing.
4. Integrate editor connection controls and shared use cases without replacing unrelated GUI work.
5. Verify schema rejection, retries, cancellation/stale-state rollback, ownership/security/lifecycle and actual SDK-to-browser modeling/export. Run build first, focused suites, application suite, native CAD suite, formatting and browser workflow.
6. Commit only the integration's files/hunks after validation. Do not deploy or push.

## Adding features

**Mandatory repository rule:** every application change must also be available through MCP for agentic work. GUI and MCP must use shared application operations with consistent inputs, validation, errors, state transitions and results. Missing MCP parity blocks completion and commit; it must be addressed in the same coherent change. Existing tools may satisfy the rule when they fully expose the changed behavior. See the authoritative [repository instructions](../AGENTS.md) for scope, documentation and validation requirements.

Add a complete input schema and accurate description to the registry, then an operation handler using existing/new domain services. Use explicit IDs and units. Place all asynchronous mutation checks immediately before the first state write; do not compare the start revision again after your own successful commit. Construct required artifacts before commit so resource-limit failures cannot report a failed command after changing the model.

New native outputs must be released on cancellation or rejected commit. Never release handles referenced by the current model or history. Add contract/rollback tests and a browser workflow where the feature changes native or rendered state. UI and agent call sites must share the use case. Keep unsupported features out of discovery until their implementation and tests exist. Document limitations before marketing full autonomous coverage.

Remote MCP, OAuth, persistent automation receipts, headless runtime, stable topology naming and workflow batching are future independent capabilities; none is implicitly enabled here.
