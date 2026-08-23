# No Excuses

Group fitness app project. Product scope and technology stack are intentionally undecided.

## Repository workflow

- `main` stays reviewable and deployable.
- Create a feature branch for each change.
- Open a pull request before merging into `main`.
- Record durable project guidance in this repository instead of relying on chat history.

## Work from another device

Clone once:

```bash
git clone https://github.com/aeltoum/no-excuses.git
cd no-excuses
```

Before starting work:

```bash
git switch main
git pull --ff-only
git switch -c <branch-name>
```

When work is ready:

```bash
git add <files>
git commit -m "<summary>"
git push -u origin <branch-name>
```

## Current phase

Repository setup only. No application stack, scripts, CI, or deployment configuration has been selected.
