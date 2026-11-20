import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/admin";
import { adminAuth, adminAuthPublic } from "./routes/admin-auth";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Status, setup and login answer without a session; everything after requireAdmin needs one.
app.route("/api/admin", adminAuthPublic);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminAuth);

app.notFound((c) => c.json({ error: "not_found" }, 404));
