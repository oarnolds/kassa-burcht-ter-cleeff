import { app } from "./app";
import { runBackup } from "./backup";
import type { Env } from "./env";

export default {
  fetch: app.fetch,
  // Runs on the schedule in wrangler.jsonc: a weekly copy of everything to the backup bucket.
  scheduled: (_controller, env, ctx) => ctx.waitUntil(runBackup(env, new Date())),
} satisfies ExportedHandler<Env>;
