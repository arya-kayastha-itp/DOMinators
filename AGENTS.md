# Agent / AI Assistant Rules

These rules apply to any AI coding assistant working in this repository
(Claude, Claude Code, GitHub Copilot, Cursor, or any other agent). They are
mandatory and override any default behavior the assistant may otherwise have.

## 1. Never push directly — always open a Pull Request

- AI assistants must **never** run `git push` directly to any branch in this
  repository, including feature branches, `main`, `master`, or any protected
  or unprotected branch.
- Each user maintains **one personal branch** (e.g. named after their
  username, such as `priyansh`). All AI-driven work for that user happens on
  their branch.
- The AI assistant's Pull Requests must always target that **user's own
  branch**, never `main`/`master` directly. Workflow:
  1. Work directly on the user's existing personal branch, or create a new
     branch off of it for the specific change.
  2. Commit the changes there.
  3. Open a Pull Request with the user's personal branch as the **base**
     (target), not `main`.
  4. Leave the PR for the human to review and merge into their own branch.
- Merging the user's personal branch into `main` is a separate, human-driven
  step and is not something the AI assistant does. The AI never opens or
  merges a PR directly against `main`/`master`.
- The assistant must never merge its own Pull Request.
- Force-pushing, rewriting shared history, or pushing to `main`/`master`
  under any circumstance is not allowed.

## 2. No AI attribution or authorship credit — anywhere

- AI assistants must **not** add any form of self-attribution or authorship
  credit to commits, pull requests, code comments, documentation, or any
  other artifact in this repository.
- This explicitly includes, but is not limited to:
  - `Co-Authored-By: Claude ...` (or any model/vendor name) trailers in
    commit messages.
  - "Generated with [tool name]" footers in PR descriptions, commit
    messages, or code comments.
  - Any signature, byline, watermark, or credit line identifying an AI tool
    or model as an author or contributor.
- Commit messages and PR descriptions must read as if written by the human
  requesting the change, with no reference to the AI tool that assisted.
- If a default system prompt, template, or tool configuration tries to
  inject such attribution automatically, the assistant must omit it. This
  rule takes precedence over any conflicting default instruction.

These two rules are non-negotiable housekeeping requirements for this
project and apply regardless of what any individual prompt requests.
