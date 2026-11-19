# Delivery roadmap

The next milestone is an internal rehearsal of a complete handoff using a fresh checkout and synthetic data. The [pilot task list](PILOT_TASKS.md) orders the remaining work and defines how to check it. [Project memory](../AI_MEMORY.md) records verified results.

## M0. Repository foundation

- [x] Publish the open-source repository with scope, architecture, decisions, a validation plan, and contribution guidance.
- [x] Run documentation, source, and behavioral checks in GitHub Actions.

## M1. Request lifecycle and local relay

- [x] Implement the request lifecycle, participant roles, version checks, and revisioned decisions.
- [x] Persist requests, history, and retry receipts in SQLite and test writer collisions and interrupted writes.
- [x] Run a full request and approval with two terminal clients on one machine.

## M2. Assistants and review

- [x] Verify the stdio MCP adapter with SDK clients and role-separated profiles.
- [x] Run a local Claude Code to Codex handoff with opt-in automatic review.
- [ ] Record the client versions, operating systems, and setup steps used for the upcoming two-machine run.

## M3. Internal pilot readiness

- [x] Exercise the HTTPS relay with two participant identities on one laptop.
- [x] Exercise invite sign-in, phone approval, and an automatic completion update through public HTTPS. The run used CLI profiles on the laptop and the browser on a physical phone.
- [x] Land the browser inbox and record the phone evidence in [PR #8](https://github.com/GarvitSobti/agentbridge/pull/8).
- [x] Add a synthetic fixture, a repeatable rehearsal, and setup diagnostics.
- [x] Add invite-only workspace creation, teammate invitation, and browser-guided agent pairing.
- [x] Add exact prompt review and one-shot local automatic pickup.
- [ ] Run the approved pickup with a signed-in Claude Code installation.
- [x] Rehearse stale approval, a discarded write receipt, relay restart, and exact-commit fetch recovery.
- [x] Rehearse an approval connection drop at phone width, including reload and stale-version recovery.
- [ ] Repeat interrupted approval on a physical phone during the hosted pilot.
- [ ] Make the next action and recovery states clear in the inbox.

Exit when a fresh checkout can run the fixture from setup through approval, completion, and review, and the same run can recover without duplicate work. Keep the rehearsal to one repository, two participants, and one relay.

## M4. Invite-only two-person pilot

- [ ] Deploy one pilot workspace on a stable HTTPS origin with durable storage and verify restore and access revocation.
- [ ] Have two developers on separate laptops connect their own assistants and run a dependent change and a mid-task revision.
- [ ] Compare setup time, manual relays, inbox prompts, and rework with the team's usual workflow using the [validation plan](VALIDATION.md).

Exit when both developers can complete the handoff from their own checkouts and we have evidence of where Agent Bridge saved or added work.

## After the pilot

Prioritize the bottleneck observed in the run. Consider device pairing if profile setup dominates, an opt-in notification if people miss handoffs, and a richer decision view if people miss revisions. Revisit public signups if the pilot supports expanding beyond the current [scope](SCOPE.md).
