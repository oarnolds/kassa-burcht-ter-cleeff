import { app } from "./app";
import { runBackup } from "./backup";
import type { Env } from "./env";
import { runNightly } from "./nightly";

export default {
  fetch: app.fetch,
  // Runs on the schedules in wrangler.jsonc: the weekly copy of everything to the backup bucket, and the nightly
  // run that brings the boekhouding up to date. Any other schedule does nothing.
  scheduled: (controller, env, ctx) => {
    if (controller.cron === "0 3 * * MON") ctx.waitUntil(runBackup(env, new Date()));
    else if (controller.cron === "0 2 * * *") ctx.waitUntil(runNightly(env, new Date()));
  },
} satisfies ExportedHandler<Env>;
