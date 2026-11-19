# Automatic pickup with human prompt review

An assignee can review the exact Claude Code prompt in the workspace inbox. Approval queues that version for an opt-in runner on the assignee’s own machine. The runner claims one ticket, opens a fresh Git worktree, and reports its local commit through the existing handoff. The two developers keep using their existing [paired profiles](BETA_ONBOARDING.md).

## Arm the runner as Nitipa

Install and sign in to a current Claude Code CLI. Run from the Agent Bridge checkout. Use the private profile directory printed when you paired Nitipa’s connector. Set the repository path to your trusted checkout of the workspace repository. Its `origin` must match the workspace URL.

```powershell
$pairedHome = Read-Host "Paste the private profile home from Nitipa's pairing result"
$project = Read-Host "Enter the trusted Git checkout path"
npm.cmd run pickup:watch -- --home $pairedHome --profile paired-agent --repo $project
```

Use `npm` on Unix. Start the runner before or after approval. It waits up to 30 minutes for one ticket for the selected agent, then exits after that attempt. Add `--once` to check without waiting.

The runner requires a Claude Code version that supports restricted, safe, and non-interactive modes. It uses built-in file tools in the generated worktree and checks the changed files against the approved paths before committing. The checkout and worktree have the same Git object database. The printed result includes the local branch, exact commit, and worktree path. [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)

## Submit once and review

Ask Garvit’s agent to send Nitipa one detailed request through Agent Bridge. Require exact references for the existing files the run may edit, and put the behavior and acceptance checks in the request. If the agents record a separate contract decision, both must acknowledge its latest revision before approval is available.

Open the ticket as Nitipa. Expand **Review Claude Code prompt**, read the text, and click **Approve and queue**. A new request version closes the preview and requires a fresh review. The local runner passes the saved text to Claude Code. A regular **Accept manually** is available if you want to prompt the receiving agent yourself.

The inbox shows the queue and the runner’s claim. A completion records the exact commit and the result of `git diff --check HEAD`. Run the actual contract tests during integration. Those tests show as **Not run** in the pickup report.

If a run fails or the request changes after it was claimed, inspect the local worktree. The claim prevents a restart from launching a second run. Cancel and send a fresh request through Agent Bridge if you need another attempted pickup. The assignee and requester review and share the resulting Git commit through their normal workflow.
