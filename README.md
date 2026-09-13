# No Excuses

Private friend-group fitness accountability product. Active True MVP delivery target is an
installable Progressive Web App for iPhone and Android browsers, backed by Supabase. Existing
React Native/Expo work is preserved for deferred native-app implementation. Hosted services
remain behind separate approval gates.

## Local setup

Prerequisites:

- Node.js `24.19.0` (see `.node-version`)
- pnpm `11.19.0` through Corepack
- Docker Desktop or another Docker-compatible runtime for the local Supabase stack
- Xcode or Android Studio only when working on deferred native applications

From a clean clone:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm db:start
pnpm db:reset
```

Start active True MVP PWA shell with `pnpm web:dev`, then open exactly
`http://127.0.0.1:4174/`. Existing `mobile:*` commands run deferred React Native/Expo client
and are not active True MVP delivery path.
`pnpm db:start` prints the local anonymous key; copy it into an ignored `.env.local` using
`.env.example`. Do not put hosted URLs or privileged keys in client-readable variables.

For local PWA integration, start `pnpm api:local` in a separate terminal with
`DATABASE_URL` and `SUPABASE_ANON_KEY` from `pnpm exec supabase status --output json`.
This test adapter binds only `127.0.0.1:8787`, verifies bearer tokens against local
Supabase Auth, and calls existing private PostgreSQL functions. Keep database URL and any
service-role key in process environment only; never use them as `VITE_*` values. Start
`pnpm web:dev` with local public `VITE_*` values from `.env.local`. For the unmocked
Chromium/WebKit flow, set `LIVE_PWA_INTEGRATION=1`, `DATABASE_URL`,
`LOCAL_SUPABASE_ANON_KEY`, and `LOCAL_SUPABASE_SERVICE_ROLE_KEY`, then run
`pnpm --filter @no-excuses/web test:browser live-local.spec.ts`. This creates new
synthetic local Auth users and Groups; it does not reset or clean existing data.
For a deterministic recovery pass, start the API with `LOCAL_FAIL_ONCE_TARGET=1` and
run the same live browser command with `LIVE_PWA_FAIL_ONCE=1`. The first target request
then returns a test-only 503 before DB mutation; retry uses the same idempotency key.
With local `DATABASE_URL` set, `pnpm db:test:pwa-settlement` runs the existing
PostgreSQL settlement fixture in a disposable database and drops it on exit.

The deterministic migration tests use an in-process PostgreSQL-compatible engine, so
`pnpm check` does not need Docker or any hosted dependency. `pnpm db:start` and
`pnpm db:reset` are the integration path for the complete local Supabase stack. To run the
M1 atomicity and idempotency smoke against real PostgreSQL, point `DATABASE_URL` at an empty,
disposable database with `psql` available and run `pnpm db:test:postgres`. The command creates
the local test roles and applies every migration, so never point it at a database containing
data.

## Repository layout

- `apps/mobile`: preserved deferred Expo Router native-client implementation
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

True-MVP rescope after the identity, Group, and accountability-calendar foundation. The
active product and PWA delivery boundary is
[`docs/product/true-mvp-scope.md`](docs/product/true-mvp-scope.md). Previously accepted
features and native-client work remain documented as deferred target-product behavior; they
have not been rejected or erased.

## Product and design context

- [`docs/product/true-mvp-scope.md`](docs/product/true-mvp-scope.md) selects what ships now,
  what is deferred, and where every deferred decision remains recorded.
- [`CONTEXT.md`](CONTEXT.md) defines the product's canonical language.
- [`docs/implementation/screen-state-accessibility-contracts.md`](docs/implementation/screen-state-accessibility-contracts.md) defines app navigation, states, and accessible interaction.
- [`docs/design/no-excuses-visual-system.md`](docs/design/no-excuses-visual-system.md) defines the approved charcoal and Safety-yellow visual language for the website and member app.
