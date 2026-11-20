export type Env = { DB: D1Database; SETUP_TOKEN: string };

export type AppEnv = { Bindings: Env; Variables: { deviceId: string } };
