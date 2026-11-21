import { Hono } from "hono";
import { isLocalHost } from "../shared/local-host";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/admin";
import { requireDevice } from "./middleware/device";
import { adminAuth, adminAuthPublic } from "./routes/admin-auth";
import { adminCash } from "./routes/admin-cash";
import { adminDevices } from "./routes/admin-devices";
import { adminMaintenance } from "./routes/admin-maintenance";
import { adminPin } from "./routes/admin-pin";
import { adminProducts } from "./routes/admin-products";
import { adminReports } from "./routes/admin-reports";
import { adminSales } from "./routes/admin-sales";
import { adminStock } from "./routes/admin-stock";
import { kassa } from "./routes/kassa";
import { kassaPin } from "./routes/kassa-pin";
import { mollieWebhook } from "./routes/mollie-webhook";
import { pair } from "./routes/pair";

export const app = new Hono<AppEnv>();

// Cloudflare serves this address over plain http as well. Nothing is answered there: the pairing code, the
// kassa's token and the beheer password may only travel encrypted. Over https the browser is told to stay on it.
app.use("/api/*", async (c, next) => {
  const url = new URL(c.req.url);
  if (isLocalHost(url.hostname)) return next();
  if (url.protocol !== "https:") return c.json({ error: "https_required" }, 400);
  await next();
  c.header("Strict-Transport-Security", "max-age=31536000");
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/pair", pair);
// Mollie calls this itself: no token and no session.
app.route("/api/mollie", mollieWebhook);

// Kassa: every route needs the token of a paired device.
app.use("/api/kassa/*", requireDevice);
app.route("/api/kassa", kassa);
app.route("/api/kassa", kassaPin);

// Beheer: status, setup and login answer without a session; everything after requireAdmin needs one.
app.route("/api/admin", adminAuthPublic);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminAuth);
app.route("/api/admin", adminDevices);
app.route("/api/admin", adminProducts);
app.route("/api/admin", adminCash);
app.route("/api/admin", adminSales);
app.route("/api/admin", adminStock);
app.route("/api/admin", adminReports);
app.route("/api/admin", adminMaintenance);
app.route("/api/admin", adminPin);

app.notFound((c) => c.json({ error: "not_found" }, 404));
