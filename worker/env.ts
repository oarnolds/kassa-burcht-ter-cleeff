// BACKUPS is there once R2 is switched on in the Cloudflare account and the bucket is bound in wrangler.jsonc.
export type Env = { DB: D1Database; SETUP_TOKEN: string; BACKUPS?: R2Bucket };

export type AppEnv = { Bindings: Env; Variables: { deviceId: string } };
