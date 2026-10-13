# ScanForge repository instructions

## Mandatory MCP parity

Every change brought into the application must also be available to agents through MCP. This is a hard repository requirement and part of the definition of done. A GUI-only feature or behavior change is incomplete and must not be committed or presented as complete.

- Apply this rule to new features, changed behavior, bug fixes, settings, viewport controls, project and backup workflows, import/export, and all modeling operations. Preserve existing agent capabilities when refactoring or removing application behavior.
- Implement application capabilities through shared application operations used by both the GUI and MCP. Keep validation, authorization, defaults, errors, state transitions, history, and results consistent. Do not maintain separate agent implementations or require agents to click through the GUI.
- Before editing, identify the affected GUI behavior, shared operation, MCP tool/resource, schema, and agent documentation. If coverage is missing, add it in the same coherent change. Updating an existing shared operation is sufficient when its existing MCP contract fully exposes the changed behavior; a new tool is not required for every change.
- Expose actions through discoverable MCP tools and expose the state/results needed to use and verify them through structured responses or resources. Include all meaningful parameters, options, object references, units, diagnostics, and failure states. Presentation changes must preserve agent access to the underlying capability and information; they do not justify unnecessary tools for individual CSS properties.
- Update `src/automation/catalog.json`, the shared executor and editor adapter as needed. Retain revision checks, request retry protection, cancellation, resource limits, lock checks, and existing history semantics. Do not advertise an unsupported operation in discovery.
- Add or update contract and behavior tests demonstrating MCP access to the changed capability. For native geometry, rendered state, files, or cross-boundary changes, include the appropriate integration/browser verification and compare GUI and MCP outcomes.
- Update `docs/AGENT_GUIDE.md` whenever agent usage, schemas, output, prerequisites, limits, or recovery procedures change. Keep `docs/MCP_ARCHITECTURE.md` consistent with architectural changes.
- Completion reports and reviews must identify the MCP coverage and actual validation results. Missing parity is a blocking defect, not optional follow-up work. Do not silently defer MCP support or introduce exceptions; only an explicit instruction from the repository owner can change this rule.

See [the agent guide](docs/AGENT_GUIDE.md) and [the shared API architecture](docs/MCP_ARCHITECTURE.md) for the current integration contracts.
