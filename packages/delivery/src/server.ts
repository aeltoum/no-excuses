// Node entry: local development and the one-time organizer seed. Production
// runs the same app on Cloudflare Workers (cloudflare.ts).
import { createServer } from "node:http";
import { Readable } from "node:stream";
import pg from "pg";
import { enroll, handle, maintenance, useProcessScope } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");
const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
useProcessScope({
  pool,
  later: (task) =>
    setImmediate(() => {
      task().catch(() => console.error("Background task failed"));
    }),
  pushBatch: 200,
  deletionBatch: 50,
});

const server = createServer(async (incoming, outgoing) => {
  const method = incoming.method ?? "GET";
  const response = await handle(
    new Request(`http://localhost:${port}${incoming.url}`, {
      method,
      headers: incoming.headers as HeadersInit,
      body: ["GET", "HEAD"].includes(method)
        ? undefined
        : (Readable.toWeb(incoming) as ReadableStream),
      duplex: "half",
    } as RequestInit),
  );
  outgoing
    .writeHead(response.status, Object.fromEntries(response.headers))
    .end(Buffer.from(await response.arrayBuffer()));
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await pool.end();
}
process.on("SIGTERM", () => {
  void close();
});
process.on("SIGINT", () => {
  void close();
});
if (process.argv[2] === "seed-organizer") {
  const email = process.env.SEED_ORGANIZER_EMAIL;
  if (!email) throw new Error("SEED_ORGANIZER_EMAIL required");
  enroll(email, "", true)
    .then(() =>
      console.log(
        "Organizer seeded; age and consent remain required before Group creation",
      ),
    )
    .catch(() => {
      console.error(
        "Organizer seed failed; check whether already seeded or Auth/DB unavailable",
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
} else {
  server.listen(port, host, () => {
    console.log(`PWA API listening on ${port}`);
    void maintenance();
  });
  setInterval(() => {
    void maintenance();
  }, 60_000).unref();
}
