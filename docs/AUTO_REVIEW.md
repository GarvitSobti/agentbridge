# Automatic review for one handoff

The requester can opt in to a Codex review of one outgoing request. Start a local watcher while the assignee works. When the relay records completion, the watcher reads the reported commit from a local Git checkout and sends its diff and the agreed contract to Codex. The producer uses the existing MCP completion tool. The watcher works from the relay record, so the producer's client is independent of the reviewer.

## Run a review

Use Node 24, Git, and a signed-in Codex CLI that supports `codex exec --ignore-user-config` (CLI 0.168.0 exposes the required options). Use a synthetic repository for the first run. The watcher sends the task title and body, latest agreed decision text, reported check names and outcomes, and the commit diff to the Codex service. Start it only for work you can share with that service. The Codex CLI uses its existing local authentication.

With the relay running, open an outgoing request as Alice. Set the request ID and repository path in PowerShell, then run:

```powershell
$request = "PASTE_ALICE_REQUEST_ID"
$repo = "C:\path\to\alice-worktree"
npm.cmd run review:watch -- --profile alice-agent --request $request --repo $repo
```

Run from the Agent Bridge checkout. For a relay initialized with a custom private directory, add `--home PATH` for the same directory. Keep the watcher terminal open. It checks one request every two seconds for up to 30 minutes. Add `--once` to check a request that may already be completed. Either invocation can start a review.

Bob's human accepts the request, then Bob's agent starts work. After committing, the agent calls `agentbridge_complete` with the full commit ID and actual test claims. In a linked worktree, the commit is already visible to Alice. If Alice uses a separate clone, the commit must be available there before review.

The watcher prints the review and stores it in the private relay directory under `reviews/`. A result of `reviewed` means Codex returned review text. The human decides what to do with the findings. It is separate from Bob's completion and from any later review, approval, or Git integration.

## Try a different producer

In Claude Code, register the same local stdio MCP adapter with Bob's agent profile. For example, from Bob's worktree in PowerShell:

```powershell
$adapter = "C:\path\to\agentbridge\src\mcp\stdio.ts"
claude mcp add --transport stdio agentbridge -- node $adapter --profile bob-agent
```

Add `--home PATH` after the profile for a custom relay. Start Claude Code in Bob's worktree, verify `agentbridge_identity` reports Bob, and follow the [MCP approval and completion flow](MCP.md). Claude Code configuration is documented in [Anthropic's MCP guide](https://code.claude.com/docs/en/mcp). The installed SDK test exercises this producer role with a separate stdio client. Live Claude-to-Codex delivery remains to be verified.

## Use a known shared checkout

If Git reports `REPOSITORY_UNTRUSTED` for a checkout you trust, set `--repo` to the worktree root and add `--trust-repo` when rerunning the watcher. The flag adds one exact `safe.directory` entry to the Git commands for that run. [Git ownership checks](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory)

A `REPOSITORY_UNAVAILABLE` error calls for checking the checkout path. If the watcher reports `GIT_UNAVAILABLE`, check that Git is on your PATH and the checkout still exists.

## Fetch a missing completion commit

If the watcher reports `COMMIT_UNAVAILABLE`, confirm the assignee shared the reported branch through your usual Git remote. From the requester’s checkout, fetch that branch and inspect the exact object:

```powershell
$reportedBranch = Read-Host "Enter the reported branch name"
$reportedCommit = Read-Host "Enter the full reported commit ID"
if ($reportedCommit -notmatch '^(?:[a-f0-9]{40}|[a-f0-9]{64})$') { throw "Enter the full Git commit ID." }
git fetch --no-tags origin "refs/heads/$reportedBranch"
git cat-file -t $reportedCommit
```

When Git prints `commit`, rerun the watcher for the same request with `--once`. Its review uses the reported commit even if the fetched branch has moved. If the commit is still missing, ask the assignee to share a ref that contains it.

## What happens on restart or failure

- The watcher reads the current terminal request, so a completion that arrived during downtime can be picked up on restart. Successful and failed review attempts are kept locally.
- One exclusive reservation per workspace, requester, and request prevents two watchers from starting the same review. If the process dies after reservation, the saved `started` state means the outcome is uncertain. Check it and review manually. The watcher never automatically resubmits an uncertain run.
- If the exact commit is missing or the context exceeds the size limit, the watcher stops before reserving the attempt. Inspect the commit yourself or make the object available and rerun. The patch covers the completion commit's changes relative to its first parent. Review older commits or run integration tests separately as needed.
- The Codex turn uses a temporary working directory and a read-only sandbox. It disables shell tools, hooks, goals, delegation, apps, and web search. It reads the bounded evidence packet from standard input. The watcher uses an agent credential to read relay state and leaves approval and mutation on the existing explicit paths.

Validate the live workflow by starting the watcher before Bob completes, observing a review of Bob's exact commit without asking Alice to check, then rerunning with `--once` and seeing the saved result.
