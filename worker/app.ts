import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/admin";
import { requireDevice } from "./middleware/device";
import { adminAuth, adminAuthPublic } from "./routes/admin-auth";
import { adminDevices } from "./routes/admin-devices";
import { pair } from "./routes/pair";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/pair", pair);

// Kassa: every route needs the token of a paired device.
app.use("/api/kassa/*", requireDevice);
app.get("/api/kassa/ping", (c) => c.json({ ok: true }));

// Beheer: status, setup and login answer without a session; everything after requireAdmin needs one.
app.route("/api/admin", adminAuthPublic);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminAuth);
app.route("/api/admin", adminDevices);

app.notFound((c) => c.json({ error: "not_found" }, 404));
