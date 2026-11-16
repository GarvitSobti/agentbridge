# Delivery roadmap

Complete small vertical slices. The checkboxes below describe current delivery status, not promises about dates. Update [AI_MEMORY.md](../AI_MEMORY.md) after each working session.

## M0: Repository foundation

- [x] Explain the problem and current status in README.md.
- [x] Define scope, architecture, decisions, and a validation plan.
- [x] Add agent guidance, project memory, contribution guidance, and license.
- [x] Define a repository check and GitHub Actions workflow.
- [x] Run the local foundation checks.
- [x] Commit the foundation.
- [ ] Publish and verify the repository on GitHub.

Exit: documentation checks pass, the initial commit exists, and its files can be inspected on GitHub. A local pass does not establish a passing hosted CI run.

## M1: Domain rules and two-terminal relay

- [ ] Define payload types, limits, errors, IDs, timestamps, and versions.
- [ ] Implement request lifecycle and role-based authorization in a shared domain layer.
- [ ] Test human-only acceptance, recipient validation, stale versions, retries, and terminal states.
- [ ] Define decision revisions and invalidate stale acknowledgments.
- [ ] Add SQLite persistence with migrations, transactional event recording, and restart tests.
- [ ] Add a loopback-only relay and two terminal clients for a synthetic request/reply scenario.

Exit: two terminal clients complete a persisted lifecycle; invalid and duplicate operations behave as documented. This is not yet an assistant integration.

## M2: Connect the actual assistants

- [ ] Confirm both participants' assistant clients and operating systems.
- [ ] Choose and pin the MCP SDK and validate its transport with those clients.
- [ ] Expose scoped inbox, request, reply, decision, start, and completion actions.
- [ ] Provide a separate human acceptance interface.
- [ ] Verify that MCP credentials cannot approve human-only actions.
- [ ] Exercise one complete handoff using two actual assistant sessions.

Exit: both assistants exchange and act on an explicitly accepted request. Record exact tested client versions and instructions. Do not claim compatibility from an MCP configuration alone.

## M3: Cross-machine operation and recovery

- [ ] Resolve ADR-007 and implement provisioning, authentication, revocation, and redacted logging.
- [ ] Require TLS for non-loopback access and verify workspace/role isolation.
- [ ] Verify event cursors, disconnect/reconnect, server restart, and retry behavior.
- [ ] Document a reproducible setup for two machines without committing credentials.

Exit: a pending request survives a disconnected participant and relay restart. The real pair can reconnect without duplicate work. Do not expose the development relay before these controls are ready.

## M4: Two-person pilot

- [ ] Build a synthetic CRM fixture using no private source or data.
- [ ] Run baseline and prototype scenarios from [VALIDATION.md](VALIDATION.md).
- [ ] Record manual relays, rework, elapsed time, interruptions, and limitations.
- [ ] Publish a reproducible example and honest findings, including failures.
- [ ] Update the README with actual setup commands and implemented capabilities.

Exit: a repeatable two-person demonstration and an evidence-based decision to continue, narrow, or change the project. Commercial discovery remains a later choice.
