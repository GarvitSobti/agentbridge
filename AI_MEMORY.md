# Project memory

Last updated: 2026-11-19

## Current position

The HTTPS relay merged in PR #7 at `64385f2a67f58bd8d8f72e43c51c8ba9c3b15fca`. PR #8 merged. Its description records the physical phone test. The internal rehearsal and setup diagnostics merged in PR #9. Approval recovery merged in PR #10. PR #6 updates the review watcher’s Git ownership diagnostics on current main. Two real Codex sessions completed a mid-task decision revision. Claude Code later reported a fresh synthetic CRM completion that Codex reviewed automatically in about 12 seconds on one laptop. A two-laptop handoff remains open.

Working name: Agent Bridge. Repository: `GarvitSobti/agentbridge`. Owner: Garvit Sobti. MIT license. Unpublished package name: `agent-bridge`.

## Confirmed direction

- Build an open-source two-person proof of concept before commercial discovery.
- Two developers, one repository, separate branches; eventual test across two machines. The friend uses Claude, but the exact client and OS are still unknown.
- Explicit requests, clarifications, revisioned interface decisions, and self-reported completion references.
- Use existing assistants. No model or separate model API key in the relay.
- Human acceptance remains a distinct server-enforced role. Keep human profiles out of MCP configuration.
- Explicit inbox checks remain the default. The requester can opt in to one local Codex review for a selected outgoing request. The relay manages coordination and human approvals.
- Same-user operator privileges remain trusted. Role separation does not isolate filesystem access or prove a human is present.
- Existing products overlap. Uniqueness, reduced coordination effort, and willingness to pay are unproven.

## Delivered

- Repository instructions, scope, architecture, ADR log, roadmap, validation plan, security/contribution guidance, and checks.
- Domain lifecycle, bounded inputs, workspace/role checks, stale-version errors, stable retry receipts, immutable decision revisions and current-agreement gates.
- Built-in SQLite, append-only migrations, transactional state/event/receipt updates, persistent inbox and event cursors, writer/crash/failure tests.
- Authenticated IPv4-loopback HTTP, hash-only credential registry, persistent revocation, private separate agent/human profiles, local operator actions, and terminal clients. Credentials and the database stay outside the checkout.
- Stdio MCP adapter with ten agent-scoped tools using the official v2 SDK. Effective role/workspace/participant checked at startup and per call. No privileged or catch-all tools. Profile-reader module avoids SQLite/operator imports in the adapter.
- Strict Zod tool schemas, stable write retry keys, expected versions, bounded HTTP requests/responses, redirect refusal, sanitized errors, and untrusted peer-content envelopes.
- Official SDK subprocess tests plus HTTP boundary tests. [MCP guide](docs/MCP.md) documents direct-Node host configuration, human approval, error/retry semantics, and what remains unverified. ADR-012 records the dependency/transport choices.
- [Review watcher](docs/AUTO_REVIEW.md) reads one terminal completion and passes a bounded Git diff and agreement context to a dedicated Codex CLI review. Private reservation and result records suppress duplicate launches after concurrent checks or restart. See ADR-013.
- [HTTPS pilot](docs/HTTPS_PILOT.md) lets an operator initialize one named workspace and register the relay's HTTPS origin. A same-host Caddy example fronts the loopback relay. Terminal, MCP, and review clients use private origin-bound profiles. See ADR-014.

- [Browser inbox](docs/BROWSER_INBOX.md) for one hosted workspace. A one-use operator invite opens a human browser session. The page shows recent requests and events, supports versioned accept/decline, and displays reported completion evidence.

- [Internal rehearsal](docs/PILOT_TASKS.md) for a synthetic health-monitor contract. It uses two checkouts, a discarded write receipt, relay restart, versioned approval, and exact-commit fetch recovery. `bridge doctor` confirms the effective profile and origin.

## Verification

- Baseline 67 domain/storage/HTTP/CLI tests pass locally on Node 24.1.0, SQLite 3.49.1, after the profile-reader refactor. Four new HTTP client boundary tests also pass locally.
- Hosted check at commit `bbcc0cdecd677584317a15d8fe5d765f4d575cbe` passed documentation, strict TypeScript, all 74 then-current tests (including seven official SDK stdio tests), and both existing synthetic demos. [CI evidence](https://github.com/GarvitSobti/agentbridge/actions/runs/44318439552).
- The final MCP PR passed 78 tests. The review slice passed `npm.cmd run check` on Windows with documentation, strict source checking, and 79 tests. The new test uses a real Git commit, an official SDK producer, and an injected reviewer. It covers requester scope, a missing commit, racing dispatch attempts, and local record reuse after relay restart.
- Local Windows verification of the HTTPS pilot passed `npm.cmd run check` with 81 tests. The new suite uses runtime-generated TLS, isolated participant profile directories, both stdio MCP clients, the human CLI, origin checks, untrusted certificate rejection, relay restart, retry, and revocation. Caddy deployment and a live two-laptop test remain open.
- Garvit ran the disposable HTTP smoke runner against commit `1485f4b` through a public Cloudflare Quick Tunnel. All 13 API calls passed from one Windows laptop with separate Alice and Bob profiles. The synthetic request reached completed at version 4. Unauthenticated inbox reads returned 401, agent approval returned 403, and human-profile approval, event catch-up, and retry replay succeeded. A real two-laptop assistant handoff and the documented Caddy deployment remain open.
- The browser inbox and planning docs passed `npm.cmd run check` on Windows with 83 tests. Headless Chrome exercised invite sign-in, request selection, mobile-width approval, automatic display of a completion report, and sign-out against a local TLS front door. Garvit then reported successful approval on a physical phone and an automatic completion update over the HTTPS tunnel. The request and completion used the Alice and Bob laptop CLI profiles. A separate two-laptop assistant run remains open.
- `npm.cmd run demo:pilot` passed on Windows. The legacy field failed the contract test and the revised field passed for all 101 scores. The rehearsal rejected stale approval, stale agreement and agent approval, then completed at v10 and reused the deterministic review after fetching the exact commit. The doctor and browser reconnect/revocation tests passed locally. `npm.cmd run check` passed all 84 tests.
- The approval recovery change was exercised in Chrome behind local TLS at phone width. The proxy dropped decision requests before the write and dropped replies after the write. Reconnection reconciled the saved state, reused the exact retry key after reload, and required a new decision when the request version advanced. Same-tab invite renewal preserved the exact key for an interrupted decline. `npm.cmd run check` passed all 86 tests, and `npm.cmd run demo:pilot` passed. A physical-phone outage run remains open.
- PR #6 was brought onto current main. The Git for Windows 2.47.1 test distinguished denied ownership, a missing checkout, a missing commit, and a non-commit object. The scoped trust test checked denial, an opted-in diff read, and denial again. `npm.cmd run check` passed all 86 tests, `npm.cmd run demo:pilot` passed, and the watcher help lists `--trust-repo`.
- Runtime: official server SDK 2.4.0 and Zod 4.6.5. Development: official client SDK 2.4.0, TypeScript 5.9.3, Node types 24.1.0. Registry resolutions and integrity are locked.
- MCP tests use two SDK clients and scripted human-role CLI acceptance, without models. They do not verify actual assistant clients, prompt-injection resistance, human presence, or real code integration. Completion remains self-reported. Writer-kill tests do not simulate power/hardware failure.
- Node 24.1.0 emits SQLite/type-stripping warnings. Type stripping does not replace TypeScript checking.

## Publication and workspace

Public repo: https://github.com/GarvitSobti/agentbridge. Browser inbox work lives on `feat/browser-inbox`. The owner's lab is separate from the GitHub source and holds the synthetic fixture and local evidence.

## Next task

Make the inbox show the next actor for a pending approval, a new contract revision, and a reported completion. Verify the labels against both participants' views, then repeat the interruption exercise on a physical phone during the hosted pilot.
