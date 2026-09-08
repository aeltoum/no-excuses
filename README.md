# No Excuses

Private friend-group fitness accountability app. The accepted implementation baseline is a
React Native/Expo development build backed by local Supabase; hosted services remain behind
separate approval gates.

## Local setup

Prerequisites:

- Node.js `24.19.0` (see `.node-version`)
- pnpm `11.19.0` through Corepack
- Docker Desktop or another Docker-compatible runtime for the local Supabase stack
- Xcode or Android Studio only when running the corresponding native development build

From a clean clone:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm db:start
pnpm db:reset
pnpm --filter @no-excuses/mobile start
```

In a second terminal, build the local development client with `pnpm mobile:ios` or
`pnpm mobile:android`. Expo Go is not supported. `pnpm db:start` prints the local anonymous
key; copy it into an ignored `.env.local` using `.env.example`. Do not put hosted URLs or
privileged keys in client-readable variables.

The deterministic migration tests use an in-process PostgreSQL-compatible engine, so
`pnpm check` does not need Docker or any hosted dependency. `pnpm db:start` and
`pnpm db:reset` are the integration path for the complete local Supabase stack. To run the
M1 atomicity and idempotency smoke against real PostgreSQL, point `DATABASE_URL` at an empty,
disposable database with `psql` available and run `pnpm db:test:postgres`. The command creates
the local test roles and applies every migration, so never point it at a database containing
data.

## Repository layout

- `apps/mobile`: Expo Router development-build shell
- `packages/contracts`: versioned OpenAPI source, generated TypeScript, and runtime schemas
- `packages/shared-kernel`: domain-neutral identity, time, request, result, event, and transaction primitives
- `packages/delivery`: thin API, queue/Cron worker, and environment-config boundaries
- `supabase`: local stack configuration and forward-only migrations
- `fixtures`: synthetic-only persona and scenario vocabulary
- `tests`: contract, fixture, and migration evidence
- `evidence`: requirement ledger and reusable Gate 1 evidence
- `scripts`: generated-artifact, dependency-pin, and secret checks

The workspace replaces Metro's archived `image-size` dependency with the maintained,
MIT-licensed, API-compatible `image-size-next@2.1.1` fork. That exact release fixes the
zero-length ICNS and ISO-BMFF parser loops tracked as CVE-2025-71329 and CVE-2025-71330;
the lockfile records its npm integrity digest and the dependency check enforces both the
override and reviewed digest.

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

Milestone 1 shared kernel and delivery skeleton. Product behavior remains governed by
`CONTEXT.md` and the implementation contracts; these primitives and shells add no domain
business rules.

## Product and design context

- [`CONTEXT.md`](CONTEXT.md) defines the product's canonical language.
- [`docs/implementation/screen-state-accessibility-contracts.md`](docs/implementation/screen-state-accessibility-contracts.md) defines app navigation, states, and accessible interaction.
- [`docs/design/no-excuses-visual-system.md`](docs/design/no-excuses-visual-system.md) defines the approved charcoal and Safety-yellow visual language for the website and member app.
