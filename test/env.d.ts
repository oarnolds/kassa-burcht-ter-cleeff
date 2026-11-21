declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SETUP_TOKEN: string;
    BACKUPS: R2Bucket;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
