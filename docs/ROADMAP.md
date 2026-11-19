# Delivery roadmap

Complete small vertical slices. The checkboxes below describe current delivery status, not promises about dates. Update [AI_MEMORY.md](../AI_MEMORY.md) after each working session.

## M0: Repository foundation

- [x] Explain the problem and current status in README.md.
- [x] Define scope, architecture, decisions, and a validation plan.
- [x] Add agent guidance, project memory, contribution guidance, and license.
- [x] Define a repository check and GitHub Actions workflow.
- [x] Run the local foundation checks.
- [x] Commit the foundation.
- [x] Publish and verify the repository on GitHub.

Exit: documentation checks pass, the initial commit exists, and its files can be inspected on GitHub. A local pass does not establish a passing hosted CI run.

## M1: Domain rules and two-terminal relay

- [x] Define payload types, limits, errors, IDs, timestamps, and versions.
- [x] Implement request lifecycle and role rules in a shared domain layer (credential authentication remains a relay responsibility).
- [x] Test human-role acceptance, recipient validation, stale versions, retries, and terminal states.
- [x] Define decision revisions and invalidate stale acknowledgments.
- [x] Add a single-process synthetic domain handoff demo.
- [x] Add SQLite persistence with migrations, transactional event recording, reopen/crash recovery, and competing-writer tests.
- [x] Add a synthetic SQLite close/reopen and retry demonstration.
- [x] Add a loopback-only authenticated relay and two terminal clients for a synthetic request/reply/approval scenario.

Exit: two terminal clients complete a persisted lifecycle; invalid and duplicate operations behave as documented. This is not yet an assistant integration.

## M2: Connect the actual assistants

- [ ] Confirm both participants' assistant clients and operating systems.
- [x] Pin the official MCP SDK and verify stdio with matching SDK clients.
- [ ] Validate transport with the actual assistant clients and record their versions.
- [x] Expose scoped inbox, request, reply, decision, start, and completion actions.
- [x] Provide a separate human-profile terminal acceptance interface.
- [x] Verify effective agent identity at startup/per call, omit human-only tools, and test role/revocation boundaries.
- [x] Exercise a local handoff using Claude Code and Codex with automatic review.

Exit: both assistants exchange and act on an explicitly accepted request. Record exact tested client versions and instructions. Do not claim compatibility from an MCP configuration alone.

## M3: Cross-machine operation and recovery

- [x] Define and test operator provisioning and the registered HTTPS origin for the pilot (ADR-014).
- [ ] Deploy the pilot and verify a real handoff across two laptops.
- [x] Verify the public HTTPS relay with separate participant profiles on one laptop.
- [x] Add invite sign-in, the browser inbox, and version-aware approvals.
- [ ] Add agent device pairing.
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
