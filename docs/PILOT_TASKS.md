# Internal pilot task list

Build around one real workflow. Two developers work on dependent changes in one repository. One assistant requests a change. The recipient reviews and approves it, the assignee reports the exact commit, and the requester can review that commit. Use synthetic data for the rehearsal. See the [roadmap](ROADMAP.md) and the [two-person validation plan](VALIDATION.md).

## Run the internal rehearsal

From the Agent Bridge checkout with Node 24 and Git installed:

```powershell
npm.cmd ci
npm.cmd run demo:pilot
```

On Unix, use `npm` in those commands. Look for `PASS`, an exact commit ID, and the cleanup confirmation. The rehearsal opens an ephemeral loopback relay, uses fresh CLI credentials, and copies the synthetic fixture into two private Git checkouts. It runs real contract tests using a scripted approval and deterministic reviewer. The real-assistant phone and two-laptop exercises have their own guides. No account is needed to run the rehearsal.

## Before inviting a tester

### 1. Close out the browser inbox

- [x] Record the phone approval and automatic completion update in [PR #8](https://github.com/GarvitSobti/agentbridge/pull/8) and mark it ready for review.
- [ ] Owner reviews and merges the PR.

Done when the inbox is on main, CI is green, and the record describes the physical phone approval and the laptop CLI roles used in the test.

### 2. Make the handoff easy to repeat

- [x] Add a small synthetic producer and consumer fixture to this repository. Give the fixture a shared field contract and an automated check that catches an incompatible change.
- [x] Add a single documented rehearsal command. It should create disposable state, run the two identities through a handoff, and print the result and cleanup instructions. Generate fresh credentials for each rehearsal.

Done when the command runs from a clean checkout with Node 24 and the locked dependencies. It shows a request, human approval, agent completion, and the exact fixture commit. Record which checks were run and whether review used a live assistant or a fixture.

### 3. Make joining and diagnosing a workspace predictable

- [x] Add a setup check for profile selection, effective participant and role, and the configured relay origin. Give errors for an unreachable relay, an invalid profile, and revoked access clear recovery steps.
- [x] Write a first-run path for connecting Codex and Claude Code with an operator-issued agent profile. Cover expired browser invites and how to request a fresh one.

Done when both profiles can be verified from a fresh checkout without exposing tokens, and someone following the runbook can tell which piece of setup needs fixing.

### 4. Rehearse the failures that could interrupt a handoff

- [x] Verify that changing a decision or request version prevents stale agreement or approval and that an agent credential cannot approve.
- [x] Discard a write receipt, restart the relay with a pending task, and retry using the original key. Check for one creation and one approval in the timeline.
- [x] Verify that an existing browser session retrieves the same pending request after relay restart and that revocation takes effect on the next protected request.
- [ ] Interrupt the phone browser connection while an approval is in flight and verify the UI shows a clear outcome or recovery path.

Done when the rehearsal can be repeated and the evidence shows one request and one approval in the timeline, the current versions, and no loss of history across restart.

### 5. Make the inbox answer who acts next

- [ ] Use the existing request and decision data to show who must approve, whether work has started, whether a new decision needs agreement, and which commit the assignee reported.
- [ ] Make stale state, connection loss, and an expired invite easy to recover from on desktop and phone. Verify the current inbox behavior first and change the gaps the rehearsal exposes.

Done when each participant can find their next action and the completion evidence from the page, and can recover from a stale view or reconnect without guessing whether their action succeeded.

### 6. Make completion lead to an exact-commit review

- [x] Rehearse the case where the relay has a completion and the reviewer's checkout lacks the reported commit. Document the existing Git fetch path and make the watcher's recovery message specific enough to follow.
- [x] Verify with a deterministic reviewer that fetching the commit supplies the exact reported object to the watcher and that running the check again reuses the saved result. Keep the reported checks and the local review outcome identifiable.
- [ ] Repeat exact-commit recovery with the live reviewer in the two-laptop pilot.

Done when the requester can go from the completion report to its exact commit review with the documented Git and watcher commands, including recovery from `COMMIT_UNAVAILABLE`.

## Before a hosted pilot

### 7. Prove one stable deployment can be operated

- [ ] Document and test a stable HTTPS origin, a persistent private SQLite directory, relay restart, backup and restore, and invite and credential revocation.
- [ ] Repeat the internal rehearsal against that deployment with the synthetic fixture.

Done when restoring into a fresh private directory preserves the request timeline and scoped access, and the operator can revoke access and check service health. The restore procedure must account for credentials revoked after the backup was taken.

## When the internal rehearsal passes

### 8. Run the two-laptop trial

- [ ] Run a dependent feature and a mid-task contract revision with two people, separate laptops and Git checkouts, and their own assistant sessions.
- [ ] Compare the run with the usual workflow. Record setup time separately, then count inbox prompts, context relays, and coordination rework using the [validation template](VALIDATION.md).

Done when both participants can describe what they shared and approved, the exact commit they reviewed, and which step took the most effort. Use that result to choose the next feature.
