# Agent Instructions

## Scope

This repository is in project-setup phase. Product scope and technology stack remain undecided.

## Working rules

1. Read `README.md` before changing files.
2. Treat repository files as durable project context; do not rely on prior chat history.
3. Confirm product or stack decisions with the user before adding application code, dependencies, scripts, CI, or deployment configuration.
4. Prefer the smallest change that satisfies the request. Reuse existing code and conventions once they exist.
5. Keep secrets out of Git. Store local secrets in ignored files and commit sanitized examples only when needed.
6. Verify relevant checks before handing off changes. If no checks exist, state that plainly.

## UI conventions

- Default to optimistic UI for member actions: show the result at once, send the request, and on failure roll back only that change and show the error notice. Votes and decisions are optimistic too; the server still settles the final tally.
- Keep a pending state, on the acting control only, for auth, server-generated results (codes, invites, previews), irreversible or destructive actions, account deletion, random draws, and OS permission prompts.
- Meet the speed budgets in `docs/agents/implementation-loop.md` (Speed) for any added or changed UI.
- Use the `frontend-design` skill for every UI change, and review the result with screenshots before handing off.

## Communication

Apply the `caveman` skill at ultra intensity to every response in this repository. Keep all
technical substance; remove filler, articles, and pleasantries. Remain in this mode until the
user says `stop caveman` or `normal mode`. Use full clarity for security warnings,
irreversible-action confirmations, or sequences where terse fragments risk misinterpretation.

## Git workflow

- Work on a feature branch.
- Keep commits focused.
- Open a pull request into `main`.
- Do not rewrite shared branch history.
- Do not add Claude session links (`claude.ai/code/session_…`) to commit messages or pull request descriptions.

## Agent skills

### Issue tracker

Issues and specs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.

### Serial implementation

For every implementation task, use the single-lane orchestrator, worker, and validator loop in `docs/agents/implementation-loop.md`.
