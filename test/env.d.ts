declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SETUP_TOKEN: string;
    BACKUPS: R2Bucket;
    ATTACHMENTS: R2Bucket;
    MOLLIE_API_KEY?: string;
    MOLLIE_API_BASE?: string;
    MOLLIE_ORG_TOKEN?: string;
    ENABLE_BANKING_APP_ID?: string;
    ENABLE_BANKING_PRIVATE_KEY?: string;
    ENABLE_BANKING_API_BASE?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
