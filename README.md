# divernote-pr

A Divernote extension. Type `/merge` in an open issue to merge its pull
request.

- An issue Divernote already reviewed merges its reviewed pull request, the
  same as pressing Enter.
- Otherwise, in the issue's worktree: uncommitted changes are committed
  (`/merge <message>` sets the message; the issue's first line is the
  default), the branch is pushed, and its open pull request is used. If it has
  none, one is made against the default branch, titled after the issue.
- The pull request is merged with a merge commit, only at the commit just
  pushed. Once GitHub says it merged, the issue is closed as merged.
- A conflict or failed merge leaves the issue open and says why.
- Not while the agent is working.
- Needs Divernote's `registerIssueCommand`, and `git` and `gh` signed in.
  Turn it off in /settings.

Tests: `node --test test/merge.test.mjs`
