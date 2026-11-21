// BACKUPS is there once R2 is switched on in the Cloudflare account and the bucket is bound in wrangler.jsonc.
// MOLLIE_API_KEY is a Worker secret (test_… or live_…); without it pin is off. MOLLIE_API_BASE only ever
// points at a local stand-in for Mollie, in the end-to-end tests (see worker/lib/mollie.ts).
export type Env = { DB: D1Database; SETUP_TOKEN: string; BACKUPS?: R2Bucket; MOLLIE_API_KEY?: string; MOLLIE_API_BASE?: string };

export type AppEnv = { Bindings: Env; Variables: { deviceId: string } };
