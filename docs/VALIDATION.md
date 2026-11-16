# Two-person proof-of-concept validation

Status: planned. No results have been collected.

## Question

Can two developers using existing coding assistants complete dependent work with fewer manual relays and repeated explanations, without introducing more interruptions or incorrect code?

Technical feasibility, usefulness, and willingness to pay are different questions. This pilot addresses the first two with a small sample; it does not establish market fit.

## Fixture and baseline

Use a small synthetic CRM with a health-monitor response consumed by a task-creation component. Do not copy private university, employer, client, or teammate source into the public repository.

Baseline: the participants' usual messaging, a shared specification, separate branches, normal tests, and stacked PRs if they normally use them. Do not intentionally weaken the baseline to favor the prototype.

Use comparable task variants and alternate which workflow goes first when feasible. Repeating exactly the same task can make the second attempt easier through familiarity; record that limitation.

## Scenarios

| Scenario | Exercise | Required observation |
| --- | --- | --- |
| Dependent feature | Task creation needs a health-monitor field owned by the other participant | Request reaches the intended person, is accepted by that human, and returns usable references |
| Mid-task change | A previously agreed response field changes while the consumer is being built | New revision needs new agreement; stale approvals cannot be reused; record when the agent actually sees the change |
| Offline handoff | Recipient disconnects before a request and reconnects after relay restart | Request remains retrievable, recipient approval is still required, and retries do not duplicate it |

## Record for each run

- Participants, assistant/client versions, operating systems, repository fixture revision, and task variant.
- Start/end time and time spent configuring the tool, recorded separately.
- Manual copy-and-paste relays and human prompts needed just to check the inbox.
- Repeated explanations, wrong assumptions, and rework caused by coordination failures.
- Unnecessary messages, interruptions, missed requests, and duplicate actions.
- Exact completion commits, test commands, outcomes, and who ran them.
- Each participant's explanation of what was shared and what they approved.

Do not use message count as the main success metric: more messages can mean more overhead. Do not treat assistant-written summaries as independent verification of test results.

## Technical acceptance

- Human-only acceptance and participant/workspace isolation hold through direct API attempts, not only through the UI.
- Invalid lifecycle transitions and stale decision approvals are rejected.
- Retries and reconnects do not create duplicate work.
- Required state survives restart.
- Credentials and full private conversations are absent from logs and tracked files.

## Usefulness decision

Review results with both participants. Continue if the coordination workflow demonstrably reduces relaying or rework without hiding failures or adding disproportionate setup and inbox-check overhead. If normal shared notes and stacked PRs are just as effective, record that result and reconsider the boundary.

Publish counts and observations as a two-person exploratory trial, not a general productivity percentage. Preserve failed runs. Any example of saved time must include what was measured and the task context.

## Results template

```text
Date / fixture / task variant:
Participants / assistants / OS:
Workflow (baseline or prototype):
Setup time / task elapsed time:
Manual relays / inbox-check prompts / repeated explanations:
Coordination rework / unnecessary interruptions:
Commits / checks / observer:
Failure or surprise:
Participant feedback:
Next change to investigate:
```
