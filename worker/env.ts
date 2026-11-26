// BACKUPS is there once R2 is switched on in the Cloudflare account and the bucket is bound in wrangler.jsonc.
// MOLLIE_API_KEY is a Worker secret (test_… or live_…); without it pin is off. MOLLIE_API_BASE only ever
// points at a local stand-in for Mollie, in the end-to-end tests (see worker/lib/mollie.ts).
export type Env = {
  DB: D1Database;
  SETUP_TOKEN: string;
  BACKUPS?: R2Bucket;
  ATTACHMENTS?: R2Bucket;
  MOLLIE_API_KEY?: string;
  MOLLIE_API_BASE?: string;
  // The organisation's read-only access token (payments, refunds, chargebacks, settlements, balances, profiles): a Worker
  // secret the penningmeester sets himself (see worker/lib/mollie-read.ts). Without it the boekhouding reads nothing of Mollie.
  MOLLIE_ORG_TOKEN?: string;
  // Enable Banking (ING): the application id and its private key (PKCS#8 PEM) are Worker secrets the penningmeester sets;
  // ENABLE_BANKING_API_BASE only ever points at a local stand-in (see worker/lib/enable-banking.ts).
  ENABLE_BANKING_APP_ID?: string;
  ENABLE_BANKING_PRIVATE_KEY?: string;
  ENABLE_BANKING_API_BASE?: string;
  // Google (Gmail, read only, for "Zoek bijlage"): the OAuth client id and secret are Worker secrets the penningmeester sets.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type AppEnv = { Bindings: Env; Variables: { deviceId: string } };
