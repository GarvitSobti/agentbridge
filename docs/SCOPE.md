# Product scope

Status: accepted proof-of-concept boundaries. Updated: 2026-11-18.

Delivered so far: domain rules, persistence, loopback HTTP/terminal workflow, and local stdio MCP tools with official SDK protocol tests. Actual assistant pairing, separate-machine access, ownership configuration, and the measured two-person pilot remain outside the completed slices. See [MCP setup](MCP.md) and [the roadmap](ROADMAP.md).

## Problem

Two developers using separate coding assistants on the same repository manually relay requests, interface decisions, and completion details. Assumptions drift while both developers work. We want to reduce this coordination work without taking control away from either developer.

## First user and unit of work

- One workspace bound to one Git repository identity.
- Two named human participants on separate machines, each with an existing assistant and separate Git branch.
- One request addressed to one participant, with one accountable owner.
- Explicitly declared ownership paths used as routing hints. Ambiguous ownership requires a named recipient.
- Selected messages and references, not automatic upload of full conversations or repository snapshots.

Do not depend on GitHub availability to exchange a message. Git repository identity and references are metadata; remote existence and commit reachability must not be assumed verified.

## Included behaviors

| Capability | Acceptance condition |
| --- | --- |
| Workspace membership | Each credential is bound to a participant, workspace, and role; cross-workspace access fails. |
| Request creation | An agent can send a bounded request with a named recipient, selected references, and a retry key. |
| Human acceptance | Only the addressed human can accept or decline; a peer or agent credential cannot impersonate them. |
| Clarification | Participants can exchange replies without silently accepting work or altering an agreed decision. |
| Decisions | Proposals have revisions; agreement records the exact revision and both participants. Editing creates a new revision needing fresh agreement. |
| Agent pickup | An agent explicitly reads accepted work; receiving a message does not launch a process. |
| Completion | The assigned agent can report a summary and exact branch/commit/check references; the report is labeled self-reported. |
| Persistence | Requests, messages, decisions, and lifecycle events survive a relay restart. |
| Offline handoff | Pending messages remain retrievable after a participant disconnects and returns. |
| Human visibility | A terminal interface shows requests, approvals, decisions, and completion details. |

## Explicit exclusions

- Automatic dependency discovery, semantic change detection, file locks, or conflict prediction.
- Automated Git operations, PR creation, branch stacking, merging, or deployment.
- Remote command execution, editing another machine, or launching or resuming another participant's agent.
- Unbounded polling or autonomous negotiation loops.
- Guaranteed delivery into an active assistant without an inbox check.
- A replacement editor, shared model runtime, full chat platform, or general multi-agent framework.
- Multi-repository workflows, more than two participants, enterprise SSO, billing, and hosted multi-tenant SaaS.
- Independently certified integration results or claims that a green report proves correctness.

## Definition of a successful proof of concept

1. Two real participants complete a request, clarification, decision, acceptance, and completion sequence through their actual assistants.
2. A mid-task decision revision cannot reuse approvals from the previous revision.
3. Offline requests persist, and retries do not create duplicate work.
4. An agent token cannot perform human-only acceptance; unrelated credentials cannot access the workspace.
5. Both participants can explain what was shared, what was approved, and which commit the completion report references.
6. The pilot compares manual relays, repeated explanations, rework, elapsed time, and interruptions against the normal workflow.

A technical pass establishes feasibility. A reduction in coordination effort is a separate result to measure, not an assumed benefit. It does not establish willingness to pay.

## Scope changes

Record consequential changes in [DECISIONS.md](DECISIONS.md), update this document and [the roadmap](ROADMAP.md), and keep the README status accurate. User instructions can revise scope; routine implementation choices do not need a new approval ceremony.
