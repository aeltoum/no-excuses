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

## Git workflow

- Work on a feature branch.
- Keep commits focused.
- Open a pull request into `main`.
- Do not rewrite shared branch history.

## Agent skills

### Issue tracker

Issues and specs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
