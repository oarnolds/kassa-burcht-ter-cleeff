export type Env = { DB: D1Database; SETUP_TOKEN: string; BACKUPS: R2Bucket };

export type AppEnv = { Bindings: Env; Variables: { deviceId: string } };
