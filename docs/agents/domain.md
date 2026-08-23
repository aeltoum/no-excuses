# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repository root.
- **`docs/adr/`** for decisions touching the area being changed.

If these files do not exist, proceed silently. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## File structure

This repository uses a single-context layout:

    /
    ├── CONTEXT.md
    ├── docs/adr/
    └── src/

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is missing, reconsider whether the language belongs to the project or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
