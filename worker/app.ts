import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/admin";
import { requireDevice } from "./middleware/device";
import { adminAuth, adminAuthPublic } from "./routes/admin-auth";
import { adminCash } from "./routes/admin-cash";
import { adminDevices } from "./routes/admin-devices";
import { adminProducts } from "./routes/admin-products";
import { adminSales } from "./routes/admin-sales";
import { adminStock } from "./routes/admin-stock";
import { kassa } from "./routes/kassa";
import { pair } from "./routes/pair";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/pair", pair);

// Kassa: every route needs the token of a paired device.
app.use("/api/kassa/*", requireDevice);
app.route("/api/kassa", kassa);

// Beheer: status, setup and login answer without a session; everything after requireAdmin needs one.
app.route("/api/admin", adminAuthPublic);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminAuth);
app.route("/api/admin", adminDevices);
app.route("/api/admin", adminProducts);
app.route("/api/admin", adminCash);
app.route("/api/admin", adminSales);
app.route("/api/admin", adminStock);

app.notFound((c) => c.json({ error: "not_found" }, 404));
