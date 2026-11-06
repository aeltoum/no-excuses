// Cloudflare Workers entry. A Worker starts in milliseconds and never sleeps
// for minutes, so the API stays fast without keep-awake traffic.
import pg from "pg";
import { handle, inScope, maintenance, type Scope } from "./app.js";

// Secrets and vars reach app.ts through process.env (nodejs_compat); the
// database comes from a Hyperdrive binding when one is configured.
type Env = Readonly<{
  DATABASE_URL?: string;
  HYPERDRIVE?: Readonly<{ connectionString: string }>;
}>;
type Context = Readonly<{ waitUntil(promise: Promise<unknown>): void }>;

function open(env: Env) {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required");
  // Workers allow six open connections per run.
  const pool = new pg.Pool({ connectionString, max: 4 });
  const tasks: Promise<unknown>[] = [];
  const scope: Scope = {
    pool,
    // Runs after the response, like setImmediate on Node; waitUntil keeps it alive.
    later: (task) => {
      tasks.push(
        new Promise((resolve) => setTimeout(resolve, 0))
          .then(() => inScope(scope, task))
          .catch(() => console.error("Background task failed")),
      );
    },
    pushBatch: 20,
    deletionBatch: 10,
  };
  const close = async () => {
    // Later work can queue more work, so drain until nothing is left.
    for (let index = 0; index < tasks.length; index++) await tasks[index];
    await pool.end();
  };
  return { scope, close };
}

export default {
  async fetch(request: Request, env: Env, context: Context) {
    const { scope, close } = open(env);
    try {
      return await inScope(scope, () => handle(request));
    } finally {
      context.waitUntil(close());
    }
  },
  // Every minute (wrangler.jsonc): weekly rollover, cleanup, and push delivery.
  async scheduled(_controller: unknown, env: Env, context: Context) {
    const { scope, close } = open(env);
    context.waitUntil(inScope(scope, maintenance).finally(close));
  },
};
