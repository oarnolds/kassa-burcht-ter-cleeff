# Kassa Burcht ter Cleeff, Fase 2 (pin via Mollie) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pin button on the kassa takes a card payment on a Mollie terminal: the server starts the payment, the iPad follows it to paid, declined, cancelled or "outcome unknown", and beheer shows pin next to cash, with the terminal chosen in Instellingen.

**Architecture:** Pin runs through the Worker. The iPad posts the receipt; the Worker stores it as a `pending` pin sale, creates a Mollie payment (`method: pointofsale`, the chosen `terminalId`) and the iPad polls once a second. The Worker asks Mollie while the sale is pending and also takes Mollie's webhook; a sale becomes `paid` only when the Worker itself has read `paid` from Mollie. One sale id is one Mollie payment (the sale id is the `Idempotency-Key`); a retry is a new sale. A receipt whose outcome the iPad could not learn is parked on the iPad and resolved later.

**Tech Stack:** As fase 1 (TypeScript, React 19, Hono, D1, zod 4, `idb`, Vitest, Playwright). New: Mollie Payments API v2 called with plain `fetch` from the Worker (no SDK); a fake Mollie shared by the Worker tests and the end-to-end tests.

**Spec:** `docs/superpowers/specs/2026-11-20-kassa-design.md` (Dutch): §8 (Pin, Status), §9 (Verkopen, Instellingen), §11 (Pin loopt via de server, Testmodus), §13 (Fase 2), §15 (open questions). Fase 1 plan, for the conventions this builds on: `docs/superpowers/plans/2026-11-20-kassa-fase-1.md`.

**Scope:** Fase 2 of spec §13: everything up to and including a full run in Mollie's test mode, and the handbook. The real payment of € 0,60, the live key and buying a terminal are the penningmeester's own steps (Task 12 only prepares and describes them). Not in scope: refunds through the API, matching Mollie payouts, Moneybird.

## What Mollie's documentation says (read 21 November 2026)

Facts this plan relies on, with the page they come from:

- **Create:** `POST https://api.mollie.com/v2/payments`, `Authorization: Bearer <key>`. Required: `amount` (`{ currency: "EUR", value: "10.00" }`, value is a string) and `description`. For a terminal: `method: "pointofsale"` and a top-level `terminalId`. The only example (docs/in-person-payments-testing) also sends `redirectUrl` and `webhookUrl`; `redirectUrl` is "normally required" and no exemption for point of sale is stated, so it is sent. `webhookUrl` "must be reachable from Mollie's point of view, so you cannot use `localhost`". `metadata` (up to about 1 kB) is stored and returned on every fetch. Minimum € 0,01, maximum € 10.000.
- **Statuses:** `open`, `pending`, `authorized`, `paid`, `canceled`, `expired`, `failed`. `statusReason: { code, message }` exists only for point-of-sale payments (codes such as `insufficient_funds`, `invalid_pin`, `terminal_busy`, `terminal_unreachable`). "Session timeout ~40 seconds" on the terminal.
- **Idempotency:** every `POST` accepts `Idempotency-Key`; the same key within one hour returns the first response again (`Idempotent-Replayed: true`); the same key with other parameters is a `400`; the same key while the first request is still running is a `409`.
- **Cancel:** `DELETE /v2/payments/{id}`; `422` when it can no longer be cancelled; `isCancelable` on the payment.
- **Webhook:** `POST`, `application/x-www-form-urlencoded`, body `id=tr_…` and nothing else; not signed; "use that ID to fetch the payment status"; expects `200`, times out after 15 seconds, retried ten times over about 26 hours.
- **Terminals:** `GET /v2/terminals` works with an API key; `_embedded.terminals[]` with `id` (`term_…`), `status` (`pending` | `active` | `inactive`), `brand` (`PAX`, `Tap`), `model`, `serialNumber`, `description`, `mode`.
- **Test mode:** enabling the payment method Point of sale on the profile "automatically generates a test mode terminal", listed by the terminals endpoint with the test key. A test payment carries `_links.changePaymentState`, a hosted page to simulate "`paid`, `canceled`, or `failed`", which also triggers the webhook.
- **Mollie Tap app:** has an "API to app" flow ("Receive payments triggered remotely through the Mollie API, like a traditional card terminal"). iPhone XS or later, iOS 16 or later.
- **Errors:** `{ status, title, detail, field?, _links }`; `401` for a bad key, `422` for a refused request, `429` with `Retry-After` when rate limited.

**What the documentation leaves open** (answered in Task 11 against the real test mode, or in Task 12 with the iPhone):

1. Whether a payment that waits on the terminal can be cancelled through the API (spec §15). The code handles both answers.
2. Which status the terminal's outcomes give (customer cancels on the terminal, card declined, nobody pays) and after how long an unpaid payment ends. The code maps by final status and never guesses.
3. Whether `redirectUrl` may be a `localhost` address in development.
4. What the test terminal is called, and what choices Mollie's test page offers besides paid, canceled and failed.
5. Whether a phone with the Tap app appears in the terminals list (the `brand: "Tap"` value suggests it does), whether the app must be open, and which cards it takes (spec §15).
6. Whether Mollie must approve Point of sale on the account (spec §15).

## Global Constraints

- Everything in the fase 1 plan's Global Constraints still holds: Dutch UI copy, English `snake_case` error codes, integer cents, `Europe/Amsterdam` business dates, a sale id is accepted once, cart operations never wait on the network, cash works offline, 44 px touch targets, house style tokens.
- The Mollie API key is a Worker secret named `MOLLIE_API_KEY`. It is never written in the repository, in chat, in a test, in a log line or in anything sent to the iPad. Locally it lives in the git-ignored `.dev.vars`, which the penningmeester fills in himself. Tests use the made-up keys `test_fake` and `test_e2e` against a fake Mollie.
- A sale is `paid` only after the Worker has read status `paid` from Mollie in that same request. Nothing the iPad or a webhook caller sends can make a sale paid.
- Pin needs a connection. Without one the Pin button is off with the reason shown, and cash goes on as in fase 1.
- A paid sale cannot be taken back on the iPad (decision of 21 November 2026). No reversal control appears anywhere on the kassa.
- The kassa screen holds only what the beheerder needs to take a payment (the penningmeester on 21 November 2026: the reversal button was "te gevaarlijk", the undo pop-up "verwarrend voor gebruiker"). No undo offers, no extra confirmations, and nothing that opens by itself over a sale in progress. The pin window holds what spec §8 names (the amount, the instruction, the outcome, the three choices after a refusal) plus `Annuleren` from spec §11. Anything more on the iPad needs the penningmeester's yes first; corrections go through him in beheer.
- Leave `r2_buckets` and `triggers` in `wrangler.jsonc`, `worker/backup.ts` and the section `Reservekopie` as they are: the weekly copy belongs to another session.
- Cloudflare free plan: about 10 ms CPU and 50 database calls per request. A status poll uses at most four database calls and one call to Mollie.
- Work on branch `claude/nervous-roentgen-4ab9ef`, which holds `fase-1` up to `1b258b6` (the button Omzet on the kassa, the weekly copy, Wis alles without a message). Commit after every task, locally. Never push. No deploy, no merge into `fase-1` or `main`, nothing against the live database without the penningmeester's explicit yes. Before asking to deploy, merge the newest `fase-1` (or `main`, once it holds fase 1) into this branch.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Worker tests call `resetData()` in `beforeEach`. No test talks to the real Mollie.

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a pinning test in the task named.

1. **The poll and the webhook settle the same payment at the same moment.** The sale is counted once and the stock goes down once. Tasks 3 and 4.
2. **Mollie's answer to the start request is lost** (timeout, bad wifi at Cloudflare's end). No second payment goes to the terminal: the same one is picked up with the same `Idempotency-Key`, and a payment whose id the kassa never learned is still booked when Mollie's webhook reports it. Tasks 3 and 4.
3. **The kassa is closed, reloaded or runs out of battery while a pin payment is running.** The receipt comes back parked and gets its outcome. Tasks 6 and 8.
4. **A double tap** on Pin, on Opnieuw proberen or on Toch contant starts one payment, cancels nothing and pays nothing by accident. Tasks 7 and 10.
5. **The key changes from test to live.** A terminal chosen with the test key is not used for real payments: pin is "not set up" until a terminal is chosen again, and the TEST bar goes away only with a live key. Task 2.

## File Structure

```
migrations/0004_pin.sql            pin columns on sales, indexes
shared/types.ts                    + PinOutcome, PinStatus, PinMode, PinState, PinTerminal, PinSettings,
                                     AdminPinAttempt, PinAttention; Catalog.pin, AdminSale.possiblyDouble, Summary.pinAttention
shared/schemas.ts                  + pinSaleInput; cashSaleInput.insteadOfSaleId
worker/env.ts                      + MOLLIE_API_KEY, MOLLIE_API_BASE
worker/lib/mollie.ts               the only code that talks to Mollie
worker/db/pin-settings.ts          the chosen terminal, what beheer sees of Mollie
worker/db/pin.ts                   start, status, cancel, settle, webhook notice, refresh of open payments
worker/routes/admin-pin.ts         GET /api/admin/pin, POST /api/admin/pin/terminal
worker/routes/kassa-pin.ts         POST /api/kassa/pin, GET /api/kassa/pin/:id, POST /api/kassa/pin/:id/cancel
worker/routes/mollie-webhook.ts    POST /api/mollie/webhook
test/fake-mollie.ts                a Mollie that lives in memory (Worker tests and e2e)
test/mollie.test.ts  pin-settings.test.ts  pin.test.ts  pin-webhook.test.ts  pin-reports.test.ts
src/lib/api.ts                     + timeoutMs
src/kassa/store/db.ts              version 2: store `pin`
src/kassa/store/pin.ts             follows one payment; parked receipts
src/kassa/pin-text.ts              Dutch wording for every outcome and reason
src/kassa/PinDialog.tsx            waiting, failed, unknown
src/kassa/TestBar.tsx              the TEST bar
src/kassa/ParkedPins.tsx           in the footer: "wacht op bevestiging" and "niet gelukt", with their list
src/kassa/KassaScreen.tsx  KassaPage.tsx  cash.ts      wiring
src/beheer/SettingsPage.tsx  SalesPage.tsx  DashboardPage.tsx
e2e/global-setup.ts  e2e/pin.spec.ts  e2e/setup.ts   .dev.vars.e2e   playwright.config.ts
README.md                          pin for the beheerder and the penningmeester
```

Route files only parse, authorise and respond; rules live in `worker/db/*`. `KassaScreen` stays presentational: it gets a `pin` prop and is tested without storage or network.

---

### Task 1: The Mollie client and a fake Mollie

**Files:**
- Create: `worker/lib/mollie.ts`, `test/fake-mollie.ts`, `test/mollie.test.ts`
- Modify: `worker/env.ts`, `test/env.d.ts`, `vitest.worker.config.ts`, `test/helpers.ts`, `shared/types.ts`, `.dev.vars.example`

**Interfaces:**
- Produces in `shared/types.ts`:
  ```ts
  export type PinMode = "test" | "live";
  /** How a pin payment ended. `start_failed`: the terminal was never asked, or the kassa gave up asking. */
  export type PinOutcome = "paid" | "declined" | "canceled" | "expired" | "start_failed";
  export type PinTerminal = { id: string; description: string; status: string; brand: string | null; model: string | null; serialNumber: string | null };
  ```
- Produces in `worker/env.ts`: `Env` gains `MOLLIE_API_KEY?: string; MOLLIE_API_BASE?: string` next to `DB`, `SETUP_TOKEN` and `BACKUPS?`.
- Produces in `worker/lib/mollie.ts`:
  ```ts
  export const MOLLIE_API = "https://api.mollie.com/v2";
  /** refused, unauthorized, not_found: Mollie said no, nothing happened. unreachable: no usable answer, anything may have happened. */
  export type MollieFailure = "unauthorized" | "refused" | "not_found" | "unreachable";
  export type MollieResult<T> = { ok: true; data: T } | { ok: false; failure: MollieFailure; status: number };
  export type MolliePayment = { id: string; status: string; reason: string | null; saleId: string | null; testUrl: string | null };
  export type NewPayment = { saleId: string; amountCents: number; terminalId: string; origin: string };
  export type Mollie = {
    mode: PinMode;
    createPayment(input: NewPayment): Promise<MollieResult<MolliePayment>>;
    getPayment(id: string): Promise<MollieResult<MolliePayment>>;
    cancelPayment(id: string): Promise<MollieResult<MolliePayment>>;
    listTerminals(): Promise<MollieResult<PinTerminal[]>>;
  };
  /** The client for the key in this environment, or null when there is no key. */
  export function mollieFor(env: Env): Mollie | null;
  /** What a Mollie payment status means for the sale; null while the payment is still running. */
  export function pinOutcome(mollieStatus: string): PinOutcome | null;
  ```
- Produces in `test/fake-mollie.ts` (no Vitest or Node imports: it also runs under Playwright):
  ```ts
  export type FakePayment = { id: string; status: string; reason: string | null; terminalId: string; amount: string; description: string; metadata: unknown; idempotencyKey: string | null };
  export type FakeMollie = {
    /** Answers a request the way Mollie's API does, plus the test page and the control routes below. */
    handle(request: Request): Promise<Response>;
    payments: FakePayment[];
    /** Every API request so far (not the control routes). */
    requests: { method: string; path: string; idempotencyKey: string | null; body: any }[];
    terminals: PinTerminal[];
    /** Whether DELETE cancels an open payment (true) or answers 422 (false). Starts true. */
    cancelable: boolean;
    /** Ends a payment the way the terminal does. */
    finish(id: string, status: "paid" | "failed" | "canceled" | "expired", reason?: string): void;
    /** The next `times` API requests get this instead of their answer: an HTTP status, "timeout" (nothing happens, the call rejects), or "lost" (the request is carried out, then the call rejects). */
    failNext(what: number | "timeout" | "lost", times?: number): void;
    reset(): void;
  };
  export function createFakeMollie(opts: { key: string; origin: string }): FakeMollie;
  ```
  Fake behaviour: `401` with Mollie's error body unless `Authorization` is `Bearer <key>`; `GET /v2/terminals` lists `terminals` (starts with one: `{ id: "term_test", description: "Testterminal", status: "active", brand: "Tap", model: "Tap", serialNumber: null }`); `POST /v2/payments` answers `422` for another method than `pointofsale` or an unknown `terminalId`, replays the first payment for a repeated `Idempotency-Key`, otherwise makes `tr_fake1`, `tr_fake2`, … with status `open`, `mode: "test"`, the metadata echoed and `_links.changePaymentState.href = <origin>/test/<id>`; a payment for a terminal that still has an open payment is made `failed` with `statusReason.code = "terminal_busy"`; `GET /v2/payments/:id` (404 when unknown); `DELETE /v2/payments/:id` cancels an open payment when `cancelable`, else `422`. For the end-to-end tests: `GET /test/:id` is an HTML page with one button per outcome (`Betaald`, `Geweigerd`, `Geannuleerd`, `Verlopen`, each a form posting to `/test/:id/paid|failed|canceled|expired`), `POST /control/reset`, `POST /control/finish` with JSON `{ status, reason? }` ends the newest open payment (409 when none), `POST /control/cancelable` with `{ value }`.
- Produces in `test/helpers.ts`:
  ```ts
  /** Sends every `fetch` to Mollie in this test file to a fresh fake. Call at the top of a test file. */
  export function useFakeMollie(): { current: FakeMollie };   // beforeEach: new fake (key "test_fake", origin "https://fake.mollie.test") + vi.stubGlobal("fetch"); afterEach: vi.unstubAllGlobals()
  ```
  and `api()` gains `init.form?: Record<string, string>` (sent form-encoded) and `init.env?: Partial<Env>` (laid over the test environment for that call).

- [ ] **Step 1: Test environment.** `vitest.worker.config.ts`: add `MOLLIE_API_KEY: "test_fake"` to the miniflare bindings. `test/env.d.ts`: add `MOLLIE_API_KEY?: string; MOLLIE_API_BASE?: string`. `.dev.vars.example`: add the two lines `# De testsleutel van Mollie (begint met test_). Zelf invullen in .dev.vars; nooit in een bericht of in de code.` and `MOLLIE_API_KEY=`.

- [ ] **Step 2: Write the failing tests** in `test/mollie.test.ts`. `const mollie = useFakeMollie(); const client = () => mollieFor({ ...env, MOLLIE_API_KEY: "test_fake" })!; const saleId = "0b0f6f0e-6f0c-4f6e-9d0a-3d1c0f6e2a11";`

  ```ts
  it("asks the terminal for a payment the way Mollie documents it", async () => {
    const made = await client().createPayment({ saleId, amountCents: 360, terminalId: "term_test", origin: "https://kassa.example" });
    expect(made).toEqual({ ok: true, data: { id: "tr_fake1", status: "open", reason: null, saleId, testUrl: "https://fake.mollie.test/test/tr_fake1" } });
    const sent = mollie.current.requests[0]!;
    expect(sent).toMatchObject({ method: "POST", path: "/v2/payments", idempotencyKey: saleId });
    expect(sent.body).toEqual({
      amount: { currency: "EUR", value: "3.60" },
      description: "Kassa bon 0b0f6f0e",
      method: "pointofsale",
      terminalId: "term_test",
      redirectUrl: "https://kassa.example/",
      webhookUrl: "https://kassa.example/api/mollie/webhook",
      metadata: { saleId },
    });
  });
  it("leaves the webhook out where Mollie cannot reach it", async () => {
    await client().createPayment({ saleId, amountCents: 60, terminalId: "term_test", origin: "http://localhost:5173" });
    expect(mollie.current.requests[0]!.body).toMatchObject({ amount: { currency: "EUR", value: "0.60" }, redirectUrl: "http://localhost:5173/" });
    expect("webhookUrl" in mollie.current.requests[0]!.body).toBe(false);
  });
  it("writes every amount as euros with two decimals", …)   // 1 → "0.01", 1000 → "10.00", 123456 → "1234.56"
  it("tells a refusal from no answer", async () => {
    const tryWith = async (what: number | "timeout") => { mollie.current.failNext(what); return client().getPayment("tr_x"); };
    expect(await tryWith(401)).toMatchObject({ ok: false, failure: "unauthorized" });
    expect(await tryWith(422)).toMatchObject({ ok: false, failure: "refused" });
    expect(await tryWith(404)).toMatchObject({ ok: false, failure: "not_found" });
    for (const what of [409, 429, 500, 503, "timeout"] as const) expect(await tryWith(what)).toMatchObject({ ok: false, failure: "unreachable" });
  });
  it("reads a finished payment with Mollie's reason", …)   // finish(id, "failed", "insufficient_funds") → { status: "failed", reason: "insufficient_funds", testUrl: … }
  it("cancels a payment, and reports a refusal to cancel", …)   // cancelable true → status "canceled"; false → { ok: false, failure: "refused", status: 422 }
  it("lists the terminals", …)   // toEqual({ ok: true, data: [the test terminal] })
  it("maps Mollie's statuses to outcomes", () => {
    expect(["paid", "failed", "canceled", "expired"].map(pinOutcome)).toEqual(["paid", "declined", "canceled", "expired"]);
    expect(["open", "pending", "authorized", "something_new"].map(pinOutcome)).toEqual([null, null, null, null]);
  });
  it("has no client without a key, and takes the mode from the key", …)   // undefined and "" → null; "test_x" → mode "test"; "live_x" → mode "live"
  it("only a local address can stand in for Mollie", async () => {
    // A fetch spy records the URLs asked for.
    … mollieFor({ ...env, MOLLIE_API_KEY: "test_fake", MOLLIE_API_BASE: "https://elsewhere.example/v2" })!.listTerminals() → URL starts with "https://api.mollie.com/v2/"
    … MOLLIE_API_BASE: "http://localhost:4174/v2" → URL starts with "http://localhost:4174/v2/"
  });
  it("gives no test link for a live payment", …)   // key "live_fake": the fake answers mode "live" without changePaymentState → testUrl null
  ```

- [ ] **Step 3: Run them.** `npm run test:worker -- test/mollie.test.ts`. Expected: FAIL, `worker/lib/mollie.ts` does not exist.

- [ ] **Step 4: Write `test/fake-mollie.ts`, `useFakeMollie` and `worker/lib/mollie.ts`.** In the client: every call uses `fetch` with `AbortSignal.timeout(8000)`. Failure by answer: thrown or timed out → `unreachable` (status 0); `401` → `unauthorized`; `404` → `not_found`; `409`, `429` and `500` and up → `unreachable`; any other `4xx` → `refused`; a `2xx` body that is not a payment → `unreachable`. `mode` is `"test"` when the key starts with `test_`, otherwise `"live"`. `MOLLIE_API_BASE` is used only when `isLocalHost` (from `shared/local-host.ts`) is true for its host. `reason` is `statusReason.code`; `saleId` is `metadata.saleId` when it is a string; `testUrl` is `_links.changePaymentState.href` in test mode only. `listTerminals` asks for `/terminals?limit=250`. `webhookUrl` is sent only when `origin` starts with `https://` and its host is not local. The fake accepts the keys `test_…` and `live_…` that equal its own `key`, or any key when constructed with `key: "*"`.

- [ ] **Step 5: Run them.** `npm run test:worker -- test/mollie.test.ts`. Expected: PASS. Then `npm run typecheck`. Expected: no errors.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: a Mollie client for terminal payments, and a fake Mollie for the tests"`

---

### Task 2: Choosing the terminal, and telling the kassa whether pin is ready

**Files:**
- Create: `worker/db/pin-settings.ts`, `worker/routes/admin-pin.ts`, `test/pin-settings.test.ts`
- Modify: `worker/app.ts`, `worker/db/products.ts` (`getCatalog`), `worker/routes/kassa.ts`, `shared/types.ts`, `test/helpers.ts`, `test/growth.test.ts`, `src/test-utils.tsx` (the test catalog)

**Interfaces:**
- Consumes: `Mollie`, `mollieFor`, `PinMode`, `PinTerminal` (Task 1).
- Produces in `shared/types.ts`:
  ```ts
  /** What the kassa needs to know about pin: `mode` null means no Mollie key; `ready` means a terminal is chosen for this key. */
  export type PinState = { mode: PinMode | null; ready: boolean };
  export type Catalog = { fetchedAt: string; categories: Category[]; products: CatalogProduct[]; openOrders: OpenOrder[]; pin: PinState };
  export type PinSettings = { mode: PinMode | null; terminalId: string | null; terminals: PinTerminal[]; problem: "no_key" | "unauthorized" | "unreachable" | null };
  ```
- Produces in `worker/db/pin-settings.ts`:
  ```ts
  export class PinError extends Error { constructor(public code: string, public status: number) }
  /** The terminal chosen with a key of this mode, or null. A terminal chosen in test mode does not exist in live mode. */
  export async function chosenTerminal(db: D1Database, mode: PinMode): Promise<string | null>;
  /** Stores the choice after checking it against Mollie's own list; null clears it. Throws PinError: unknown_terminal 409, terminal_not_active 409, unauthorized 503, unreachable 503. */
  export async function chooseTerminal(db: D1Database, mollie: Mollie, terminalId: string | null): Promise<void>;
  export async function pinSettings(db: D1Database, mollie: Mollie | null): Promise<PinSettings>;
  ```
  Stored as two rows of `settings`, written in one batch: `mollie_terminal_id`, `mollie_terminal_mode`.
- Produces: `getCatalog(db: D1Database, now: Date, mode: PinMode | null): Promise<Catalog>`: the settings read joins the existing batch (still one round trip); `pin.ready` is true when `mode` is not null and the stored mode equals it.
- Produces routes, behind `requireAdmin`: `GET /api/admin/pin` → `PinSettings`; `POST /api/admin/pin/terminal` with `{ terminalId: string | null }` → `{ ok: true }`, `400 invalid`, `503 no_key`, or the `PinError`.
- Produces in `test/helpers.ts`: `export async function chooseTestTerminal(): Promise<void>` (logs in as admin and posts `term_test`).

- [ ] **Step 1: Write the failing tests** in `test/pin-settings.test.ts` (`const mollie = useFakeMollie()`, `resetData()` in `beforeEach`, `const { cookie } = await asAdmin()`, `const { token } = await asDevice()`; `catalogPin = async (envOver?) => (await (await api("/api/kassa/catalog", { token, env: envOver })).json<Catalog>()).pin`):

  ```ts
  it("shows Mollie's terminals and stores the one that is chosen", async () => {
    mollie.current.terminals.push({ id: "term_kiosk", description: "Kiosk", status: "active", brand: "PAX", model: "A920", serialNumber: "123" });
    const before = await (await api("/api/admin/pin", { cookie })).json<PinSettings>();
    expect(before).toEqual({ mode: "test", terminalId: null, terminals: mollie.current.terminals, problem: null });
    expect(await catalogPin()).toEqual({ mode: "test", ready: false });
    expect((await api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId: "term_kiosk" } })).status).toBe(200);
    expect((await (await api("/api/admin/pin", { cookie })).json<PinSettings>()).terminalId).toBe("term_kiosk");
    expect(await catalogPin()).toEqual({ mode: "test", ready: true });
    await api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId: null } });
    expect(await catalogPin()).toEqual({ mode: "test", ready: false });
  });
  it("refuses a terminal Mollie does not list and one that is not active", …)
    // "term_nope" → 409 { error: "unknown_terminal" }; a listed terminal with status "pending" → 409 { error: "terminal_not_active" }; { terminalId: 5 } → 400 { error: "invalid" }; nothing stored
  it("says what is wrong when Mollie cannot be asked", …)
    // env { MOLLIE_API_KEY: undefined } → GET { mode: null, terminalId: null, terminals: [], problem: "no_key" }, POST 503 no_key, catalog pin { mode: null, ready: false }
    // failNext(401) → problem "unauthorized"; failNext(500) → problem "unreachable"; in both the chosen terminalId is still reported
  it("does not use a test terminal for real payments (Review Focus 5)", async () => {
    await chooseTestTerminal();
    expect(await catalogPin({ MOLLIE_API_KEY: "live_fake" })).toEqual({ mode: "live", ready: false });
    expect(await chosenTerminal(env.DB, "live")).toBeNull();
    expect(await chosenTerminal(env.DB, "test")).toBe("term_test");
  });
  it("keeps the chosen terminal when the trial data is wiped", …)   // POST /api/admin/wipe-trial { confirm: "WISSEN" } → catalog pin still ready
  it("keeps the terminal choice behind the beheer login", …)   // both routes 401 without a cookie; a kassa token is not enough
  it("fetches the catalog in one database round trip, pin included", …)   // meteredDb: getCatalog(db, now, "test") → calls() === 1
  ```

- [ ] **Step 2: Run them.** `npm run test:worker -- test/pin-settings.test.ts`. Expected: FAIL (404 on `/api/admin/pin`, no `pin` in the catalog).

- [ ] **Step 3: Implement** `worker/db/pin-settings.ts`, `worker/routes/admin-pin.ts`, the `getCatalog` change (the kassa route passes `mollieFor(c.env)?.mode ?? null`), and mount `adminPin` in `worker/app.ts` after `requireAdmin`. Update the callers of `getCatalog` in `test/growth.test.ts` (pass `"test"`), and add `pin: { mode: "live", ready: true }` to the `catalog` in `src/test-utils.tsx`.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 5: Commit.** `git commit -am "feat: beheer chooses the Mollie terminal; the kassa learns whether pin is ready"` (add the new files first).

---

### Task 3: Starting, following and cancelling a pin payment on the server

**Files:**
- Create: `migrations/0004_pin.sql`, `worker/db/pin.ts`, `worker/routes/kassa-pin.ts`, `test/pin.test.ts`
- Modify: `shared/schemas.ts`, `shared/types.ts`, `worker/db/sales.ts`, `worker/app.ts`, `test/helpers.ts`, `test/schema.test.ts`

**Interfaces:**
- Consumes: `Mollie`, `MolliePayment`, `pinOutcome` (Task 1); `chosenTerminal`, `PinError` (Task 2).
- Produces `migrations/0004_pin.sql`:
  ```sql
  -- Pin payments via Mollie. A pin sale is a row of sales with method 'pin': 'pending' from the moment the
  -- kassa asks for it until the server has read Mollie's final word, then 'paid' or 'failed'.
  ALTER TABLE sales ADD COLUMN mollie_payment_id TEXT;
  ALTER TABLE sales ADD COLUMN mollie_mode TEXT CHECK (mollie_mode IN ('test','live'));
  ALTER TABLE sales ADD COLUMN pin_outcome TEXT CHECK (pin_outcome IN ('paid','declined','canceled','expired','start_failed'));
  -- Mollie's statusReason code, or the kassa's own: unauthorized, refused, not_found, no_answer, before_start.
  ALTER TABLE sales ADD COLUMN pin_reason TEXT;
  ALTER TABLE sales ADD COLUMN settled_at TEXT;
  -- On a cash sale: the pin sale of the same receipt that had not (or not yet) gone through when cash was taken.
  ALTER TABLE sales ADD COLUMN instead_of_sale_id TEXT REFERENCES sales(id);

  CREATE UNIQUE INDEX sales_by_mollie_payment ON sales(mollie_payment_id) WHERE mollie_payment_id IS NOT NULL;
  CREATE INDEX sales_pending ON sales(sold_at) WHERE status = 'pending';
  CREATE INDEX sales_instead_of ON sales(instead_of_sale_id) WHERE instead_of_sale_id IS NOT NULL;
  ```
- Produces in `shared/schemas.ts`:
  ```ts
  // What the kassa sends to start a pin payment. Mollie takes at most € 10.000 on a terminal.
  export const pinSaleInput = z.object({
    id: z.uuid(),
    soldAt: z.iso.datetime(),
    totalCents: z.number().int().min(1).max(1_000_000),
    lines: z.array(saleLineInput).min(1).max(100),
  });
  export type PinSaleInput = z.infer<typeof pinSaleInput>;
  ```
- Produces in `shared/types.ts`:
  ```ts
  /** Where a pin payment stands. `outcome` null: still running. `sent`: the terminal has been asked. `testUrl`: test mode only, Mollie's page to choose the ending. */
  export type PinStatus = { id: string; outcome: PinOutcome | null; reason: string | null; sent: boolean; testUrl: string | null };
  ```
- Produces in `worker/db/sales.ts`: `SaleRow` gains `mollie_payment_id`, `mollie_mode`, `pin_outcome`, `pin_reason`, `settled_at`, `instead_of_sale_id` (all `… | null`); exported for reuse: `storedSoldAt(soldAt: string, now: Date): string`, `loadProducts(db: D1Database): Promise<Map<string, ProductInfo>>`, `lineStatement(db: D1Database, saleId: string, line: SaleLineInput, product: ProductInfo): D1PreparedStatement`. `saleStatements` and `loadKnown` use them; their behaviour does not change.
- Produces in `worker/db/pin.ts`:
  ```ts
  /** While a start request has had no answer, it is sent again (same Idempotency-Key) for this long: the beheerder is still waiting. */
  export const RESEND_MS = 60_000;
  /** A sale Mollie never answered for and never called back about counts as not started after this long. */
  export const GIVE_UP_MS = 15 * 60_000;

  export type PinContext = { db: D1Database; mollie: Mollie | null; origin: string; now: Date };

  /** Stores the receipt as a pending pin sale and asks the terminal. Sending the same id again returns where that payment stands.
   *  Throws PinError: pin_not_configured 409 (no key), no_terminal 409, id_in_use 409 (the id is a cash sale), total_mismatch 422, unknown_product 422. */
  export async function startPin(ctx: PinContext, deviceId: string, input: PinSaleInput): Promise<PinStatus>;
  /** Where the payment stands, after asking Mollie when it is still running. null: there is no pin sale with this id. */
  export async function pinStatus(ctx: PinContext, saleId: string): Promise<PinStatus | null>;
  /** Asks Mollie to cancel. The answer says where the payment stands afterwards: it may still be running. */
  export async function cancelPin(ctx: PinContext, saleId: string): Promise<PinStatus | null>;
  /** Writes what Mollie says about this sale's payment, exactly once, and returns the row as it then is. */
  export async function settleFromMollie(db: D1Database, sale: SaleRow, payment: MolliePayment, now: Date): Promise<SaleRow>;
  ```
- Produces routes in `worker/routes/kassa-pin.ts`, mounted on `/api/kassa` behind `requireDevice`: `POST /pin` (body `pinSaleInput`; `200 PinStatus`, `400 invalid`, or the `PinError`), `GET /pin/:id` (`200 PinStatus`, `404 not_found`), `POST /pin/:id/cancel` (same). Any paired kassa may ask about any pin sale: an iPad that was paired again must still find its parked receipts.
- Produces in `test/helpers.ts`: `pinSale(overrides?: Partial<PinSaleInput>): PinSaleInput` (one Aardbeitje, 110, sold now), `startPinSale(token: string, sale: PinSaleInput): Promise<PinStatus>` (expects 200), `pinStatusOf(token: string, id: string): Promise<PinStatus>` (expects 200).

**Rules `worker/db/pin.ts` implements** (the tests below pin each one):

1. *Start.* Check total and products exactly as `judgeSale` does. Insert the sale (`method 'pin'`, `status 'pending'`, `mollie_mode`, `sold_at` from `storedSoldAt`, `late 0`) with its lines in one batch; no stock movement yet. Then `createPayment`. Answer `ok` → settle with it. `unauthorized`, `refused`, `not_found` → the sale becomes `failed`, `pin_outcome 'start_failed'`, `pin_reason` the failure. `unreachable` → the sale stays `pending` without a payment id. If the insert loses a race for the id, or the id already is a pin sale: answer where it stands, without another call to Mollie.
2. *Settle* (`settleFromMollie`), by `pinOutcome(payment.status)`:
   - `paid`: one batch of two statements, in this order, both guarded by the same condition so that two settlers cannot both write:
     ```sql
     INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at)
     SELECT l.product_id, -l.qty, 'sale', l.sale_id, ?2
     FROM sale_lines l JOIN products p ON p.id = l.product_id JOIN sales s ON s.id = l.sale_id
     WHERE l.sale_id = ?1 AND p.track_stock = 1 AND s.method = 'pin'
       AND (s.status = 'pending' OR (s.status = 'failed' AND s.mollie_payment_id IS NULL))
       AND (s.mollie_payment_id IS NULL OR s.mollie_payment_id = ?3)
     ORDER BY l.id;

     UPDATE sales SET status = 'paid', pin_outcome = 'paid', pin_reason = NULL, mollie_payment_id = ?3, settled_at = ?2
     WHERE id = ?1 AND method = 'pin'
       AND (status = 'pending' OR (status = 'failed' AND mollie_payment_id IS NULL))
       AND (mollie_payment_id IS NULL OR mollie_payment_id = ?3);
     ```
     The second half of the condition is the one exception to "final is final": a sale the kassa gave up on without ever learning a payment id is still booked when Mollie says it was paid.
   - `declined`, `canceled`, `expired`: `UPDATE … SET status = 'failed', pin_outcome, pin_reason = payment.reason, mollie_payment_id = COALESCE(mollie_payment_id, ?), settled_at WHERE id = ? AND status = 'pending'`.
   - still running: store the payment id if the row has none; nothing else.
   - A `paid` sale is never changed again.
3. *Status.* A settled sale answers from the row, without asking Mollie. Pending with a payment id → `getPayment`, settle; when Mollie gives no usable answer, answer what the row says. Pending without a payment id → younger than `RESEND_MS` (by `received_at`): `createPayment` again as in rule 1; older than `GIVE_UP_MS`: `failed`, `start_failed`, reason `no_answer`; in between: unchanged. `testUrl` comes from the payment read in this request and only while the sale is running.
4. *Cancel.* Settled → answer from the row. Pending with a payment id → `cancelPayment`; `ok` → settle with the answer; anything else → behave as *Status* (the payment may be running, or just finished). Pending without a payment id → `failed`, `pin_outcome 'canceled'`, reason `before_start`; nothing is sent to Mollie, then or later.
5. With `ctx.mollie` null, `startPin` throws `pin_not_configured`; status and cancel answer from the row.

- [ ] **Step 1: Write the failing tests** in `test/pin.test.ts`. Setup: `const mollie = useFakeMollie()`; `beforeEach`: `resetData()`, `({ token, deviceId } = await asDevice())`, `await chooseTestTerminal()`. Helpers in the file: `row(id)`, `count(sql)`, `movements()` (`SELECT product_id, delta, kind, ref_id FROM stock_movements`), `day()` (the day report of today), `creates()` (`mollie.current.requests.filter((r) => r.method === "POST" && r.path === "/v2/payments")`), `ctx(now = new Date())` (`{ db: env.DB, mollie: mollieFor(env), origin: "https://kassa.example", now }`).

  ```ts
  it("stores the receipt as pending and asks the terminal", async () => {
    const sale = pinSale({ soldAt: new Date().toISOString() });
    expect(await startPinSale(token, sale)).toEqual({ id: sale.id, outcome: null, reason: null, sent: true, testUrl: "https://fake.mollie.test/test/tr_fake1" });
    expect(await row(sale.id)).toMatchObject({ method: "pin", status: "pending", total_cents: 110, device_id: deviceId, mollie_payment_id: "tr_fake1", mollie_mode: "test", pin_outcome: null, late: 0, handover_id: null });
    expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(1);
    expect(await movements()).toEqual([]);
    expect(creates()[0]).toMatchObject({ idempotencyKey: sale.id, body: { amount: { currency: "EUR", value: "1.10" }, terminalId: "term_test", metadata: { saleId: sale.id } } });
    expect((await day()).totals).toEqual({ cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 });
  });
  it("books a paid payment once, lowers the stock then, and stops asking Mollie", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", "paid");
    expect(await pinStatusOf(token, sale.id)).toEqual({ id: sale.id, outcome: "paid", reason: null, sent: true, testUrl: null });
    expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid" });
    expect((await row(sale.id))!.settled_at).toEqual(expect.any(String));
    expect(await movements()).toEqual([{ product_id: "aardbeitje", delta: -1, kind: "sale", ref_id: sale.id }]);
    const asked = mollie.current.requests.length;
    expect((await pinStatusOf(token, sale.id)).outcome).toBe("paid");
    expect(mollie.current.requests.length).toBe(asked);
    expect(await movements()).toHaveLength(1);
    expect((await day()).totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
  });
  it.each([
    ["failed", "insufficient_funds", "declined"],
    ["canceled", undefined, "canceled"],
    ["expired", undefined, "expired"],
  ] as const)("ends a payment Mollie reports as %s as not paid", async (status, reason, outcome) => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", status, reason);
    expect(await pinStatusOf(token, sale.id)).toEqual({ id: sale.id, outcome, reason: reason ?? null, sent: true, testUrl: null });
    expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: outcome });
    expect(await movements()).toEqual([]);
    expect((await day()).totals.totalCents).toBe(0);
  });
  it("settles once when two requests learn the outcome at the same moment (Review Focus 1)", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", "paid");
    const [a, b] = await Promise.all([pinStatusOf(token, sale.id), pinStatusOf(token, sale.id)]);
    expect([a.outcome, b.outcome]).toEqual(["paid", "paid"]);
    expect(await movements()).toHaveLength(1);
    expect((await day()).totals.saleCount).toBe(1);
  });
  it("makes one sale and one payment when the same start is sent again, also at the same moment", async () => {
    const sale = pinSale();
    const [a, b] = await Promise.all([startPinSale(token, sale), startPinSale(token, sale)]);
    expect([a.id, b.id]).toEqual([sale.id, sale.id]);
    expect((await startPinSale(token, sale)).sent).toBe(true);
    expect(mollie.current.payments).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(1);
  });
  it("picks up the same payment when Mollie's answer to the start was lost (Review Focus 2)", async () => {
    const sale = pinSale();
    mollie.current.failNext("lost");
    expect(await startPinSale(token, sale)).toMatchObject({ outcome: null, sent: false });
    expect(mollie.current.payments).toHaveLength(1);            // Mollie did make it: it is on the terminal
    expect((await row(sale.id))!.mollie_payment_id).toBeNull();
    expect(await pinStatusOf(token, sale.id)).toMatchObject({ outcome: null, sent: true });
    expect(mollie.current.payments).toHaveLength(1);            // and no second one was sent
    expect(creates().map((r) => r.idempotencyKey)).toEqual([sale.id, sale.id]);
    expect((await row(sale.id))!.mollie_payment_id).toBe("tr_fake1");
  });
  it("tries the start again while the beheerder waits, when Mollie could not be reached", …)
    // failNext("timeout") → start: sent false, 0 payments; status → sent true, 1 payment
  it("stops sending after a minute and gives up after fifteen", async () => {
    const sale = pinSale();
    mollie.current.failNext("timeout");
    await startPinSale(token, sale);
    const received = Date.parse((await row(sale.id))!.received_at as string);
    expect(await pinStatus(ctx(new Date(received + RESEND_MS + 1)), sale.id)).toMatchObject({ outcome: null, sent: false });
    expect(creates()).toHaveLength(1);
    expect(await pinStatus(ctx(new Date(received + GIVE_UP_MS + 1)), sale.id)).toMatchObject({ outcome: "start_failed", reason: "no_answer" });
    expect(mollie.current.payments).toHaveLength(0);
  });
  it.each([[401, "unauthorized"], [422, "refused"]] as const)("ends at once when Mollie refuses to start (%i)", …)
    // failNext(status) → start answers 200 { outcome: "start_failed", reason, sent: false }; row failed; a later status call sends nothing
  it("cancels at Mollie when that is still possible", …)
    // POST cancel → { outcome: "canceled" }; the fake's payment is "canceled"; row failed
  it("never calls a payment cancelled that Mollie will not cancel", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.cancelable = false;
    const answer = await api(`/api/kassa/pin/${sale.id}/cancel`, { method: "POST", token });
    expect(await answer.json()).toMatchObject({ outcome: null, sent: true });
    expect((await row(sale.id))!.status).toBe("pending");
    mollie.current.finish("tr_fake1", "paid");                 // the customer paid after all
    expect((await pinStatusOf(token, sale.id)).outcome).toBe("paid");
  });
  it("a cancel before the terminal was asked sends nothing, then or later", …)
    // failNext("timeout"); start; cancel → { outcome: "canceled", reason: "before_start", sent: false }; status again → creates() still length 1
  it("refuses a receipt that does not add up or names an unknown product, and writes nothing", …)
    // totalCents 999 → 422 total_mismatch; productId "bestaat-niet" → 422 unknown_product; { nope: true } → 400 invalid; 0 sales, 0 requests to Mollie
  it("says so when pin is not set up", …)
    // no terminal chosen → 409 no_terminal; env { MOLLIE_API_KEY: undefined } → 409 pin_not_configured; a terminal chosen in test mode with a live key → 409 no_terminal; 0 sales
  it("refuses an id that already is a cash sale", …)   // 409 id_in_use; the cash sale is untouched
  it("answers any paired kassa, and nobody else", …)
    // a second device's token → 200 with the same status; no token → 401; an unknown id → 404 not_found
  it("reports a busy terminal as declined with Mollie's reason", …)
    // two starts in a row → the second: { outcome: "declined", reason: "terminal_busy" }
  it("dates the sale on the Amsterdam day it was rung up", …)
    // soldAt "2026-07-31T22:30:00.000Z" → business_date "2026-08-01"; a soldAt three hours ahead is stored as now
  it("stays within the free plan: a poll that settles uses three database calls and one call to Mollie", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", "paid");
    const before = mollie.current.requests.length;
    const metered = meteredDb(env.DB);
    await pinStatus({ ...ctx(), db: metered.db }, sale.id);
    expect(metered.calls()).toBeLessThanOrEqual(3);
    expect(mollie.current.requests.length - before).toBe(1);
    const again = meteredDb(env.DB);
    await pinStatus({ ...ctx(), db: again.db }, sale.id);
    expect(again.calls()).toBe(1);
  });
  ```
  In `test/schema.test.ts` add: the six new columns exist on `sales`, and two rows with the same `mollie_payment_id` are refused.

- [ ] **Step 2: Run them.** `npm run test:worker -- test/pin.test.ts test/schema.test.ts`. Expected: FAIL (no migration, no routes).

- [ ] **Step 3: Implement** the migration, the schema and type additions, the exports from `worker/db/sales.ts`, `worker/db/pin.ts` by the five rules above, `worker/routes/kassa-pin.ts`, and mount it in `worker/app.ts` (`app.route("/api/kassa", kassaPin)` after `requireDevice`). The routes build the context as `{ db: c.env.DB, mollie: mollieFor(c.env), origin: new URL(c.req.url).origin, now: new Date() }`.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS, no errors. Then `npm run db:migrate:local`. Expected: `0004_pin.sql` applied.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: the server starts, follows and cancels a pin payment at Mollie"`

---

### Task 4: Mollie's webhook

**Files:**
- Create: `worker/routes/mollie-webhook.ts`, `test/pin-webhook.test.ts`
- Modify: `worker/db/pin.ts`, `worker/app.ts`, `test/helpers.ts`

**Interfaces:**
- Consumes: `PinContext`, `settleFromMollie` (Task 3).
- Produces in `worker/db/pin.ts`:
  ```ts
  /** Mollie says something changed about this payment. "retry": Mollie could not be asked, it should call again. */
  export async function noticeFromMollie(ctx: PinContext, paymentId: string): Promise<"done" | "retry">;
  ```
  Rules: find the sale by `mollie_payment_id`. Found and `paid`, or `failed` with a payment id → `done`, without asking Mollie. Otherwise `getPayment`: `unreachable` or `unauthorized` → `retry`; `not_found` or `refused` → `done`. With the payment in hand: use the sale found by payment id, or else the pin sale whose id is `payment.saleId` (when that is a UUID) and whose `mollie_payment_id` is null; none → `done`; else `settleFromMollie` → `done`.
- Produces route `POST /api/mollie/webhook`, mounted in `worker/app.ts` before the kassa and beheer routes, without a token or a session: reads the form field `id`; an id that does not match `/^tr_[A-Za-z0-9_]{1,64}$/`, or no Mollie key → `200`; `done` → `200` with body `ok`; `retry` → `503`.
- Produces in `test/helpers.ts`: `webhook(paymentId: string): Promise<Response>` (`api("/api/mollie/webhook", { method: "POST", form: { id: paymentId } })`).

- [ ] **Step 1: Write the failing tests** in `test/pin-webhook.test.ts` (same setup as `test/pin.test.ts`):

  ```ts
  it("books a payment Mollie reports while the iPad is gone", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", "paid");
    const answer = await webhook("tr_fake1");
    expect(answer.status).toBe(200);
    expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid" });
    expect(await movements()).toHaveLength(1);
  });
  it("believes Mollie, not the caller", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    expect((await webhook("tr_fake1")).status).toBe(200);      // the payment is still open at Mollie
    expect((await row(sale.id))!.status).toBe("pending");
    expect((await webhook("tr_bestaatniet")).status).toBe(200);
    expect((await api("/api/mollie/webhook", { method: "POST", form: { id: "'; DROP TABLE sales; --" } })).status).toBe(200);
    expect((await api("/api/mollie/webhook", { method: "POST", json: { id: "tr_fake1", status: "paid" } })).status).toBe(200);
    expect((await row(sale.id))!.status).toBe("pending");
  });
  it("asks Mollie to call again when Mollie itself gives no answer", …)   // failNext(500) → 503; the row is still pending; a second call → 200 and settled
  it("finds the sale by its own id when the answer to the start was lost (Review Focus 2)", async () => {
    const sale = pinSale();
    mollie.current.failNext("lost");
    await startPinSale(token, sale);                            // the kassa never learned "tr_fake1"
    mollie.current.finish("tr_fake1", "paid");
    expect((await webhook("tr_fake1")).status).toBe(200);
    expect(await row(sale.id)).toMatchObject({ status: "paid", mollie_payment_id: "tr_fake1" });
  });
  it("still books a payment the kassa had given up on (Review Focus 2)", async () => {
    const sale = pinSale();
    mollie.current.failNext("lost");
    await startPinSale(token, sale);
    await api(`/api/kassa/pin/${sale.id}/cancel`, { method: "POST", token });   // cancelled before the kassa knew of a payment
    expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "canceled", mollie_payment_id: null });
    mollie.current.finish("tr_fake1", "paid");                  // but it was on the terminal, and the customer paid
    await webhook("tr_fake1");
    expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid", mollie_payment_id: "tr_fake1" });
    expect(await movements()).toHaveLength(1);
  });
  it("leaves a declined payment declined when the same id is reported again, and a paid one paid", …)
    // declined with a payment id + webhook → still failed, Mollie not asked; paid + webhook twice → paid, one stock movement, Mollie not asked
  it("settles once when the poll and the webhook come at the same moment (Review Focus 1)", async () => {
    const sale = pinSale();
    await startPinSale(token, sale);
    mollie.current.finish("tr_fake1", "paid");
    await Promise.all([pinStatusOf(token, sale.id), webhook("tr_fake1"), webhook("tr_fake1")]);
    expect(await movements()).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM sales WHERE status = 'paid'")).toBe(1);
  });
  it("needs no token, no login and no csrf header, and does nothing without a Mollie key", …)
    // called with app.request directly, as Mollie does: no Authorization, no Cookie, no X-Requested-With, body "id=tr_fake1" form-encoded → 200 and settled;
    // env { MOLLIE_API_KEY: undefined } → 200, nothing asked
  ```

- [ ] **Step 2: Run them.** `npm run test:worker -- test/pin-webhook.test.ts`. Expected: FAIL (404).

- [ ] **Step 3: Implement** `noticeFromMollie` and the route.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: Mollie's webhook settles a pin payment when the iPad is not there to ask"`

---

### Task 5: Pin in beheer's figures: possibly paid twice, open and failed attempts

**Files:**
- Create: `test/pin-reports.test.ts`
- Modify: `shared/schemas.ts`, `shared/types.ts`, `worker/db/sales.ts`, `worker/db/reports.ts`, `worker/db/pin.ts`, `worker/routes/admin-sales.ts`, `test/reports.test.ts` (shape of `/api/admin/sales` and of the summary), `src/beheer/SalesPage.test.tsx` and `src/beheer/beheer-auth.test.tsx` (their fixtures gain the new fields), `src/beheer/SalesPage.tsx` and `src/beheer/DashboardPage.tsx` (types only, so the build stays green; the pages get their pin parts in Task 9)

**Interfaces:**
- Consumes: `pinStatus`, `PinContext` (Task 3).
- Produces in `shared/schemas.ts`: `cashSaleInput` gains `insteadOfSaleId: z.uuid().nullable().optional()`: the pin attempt of the same receipt that had not gone through when the beheerder took cash.
- Produces in `shared/types.ts`:
  ```ts
  // on AdminSale:
  /** Cash was taken for a receipt whose pin payment went through after all; shown on both sales until one is reversed. */
  possiblyDouble: boolean;

  /** A pin payment that did not go through (`outcome`), or is still waiting for Mollie (`outcome` null). */
  export type AdminPinAttempt = { id: string; soldAtLocal: string; totalCents: number; outcome: Exclude<PinOutcome, "paid"> | null; reason: string | null; lines: AdminSale["lines"] };
  /** Something about pin the penningmeester should look at, with the day to open. */
  export type PinAttention = { kind: "pending" | "double"; date: string; totalCents: number };
  // on Summary:
  pinAttention: PinAttention[];
  ```
- Produces in `worker/db/sales.ts`: `judgeSale` stores `instead_of_sale_id` when `insteadOfSaleId` names an existing pin sale; any other value is stored as null and the cash sale is accepted all the same (the money is in the cash box). `loadKnown` reads the named sales in its existing queries (no extra round trip).
- Produces in `worker/db/reports.ts`: `listSales` fills `possiblyDouble`; `listPinAttempts(db: D1Database, date: string): Promise<AdminPinAttempt[]>` (pin sales of that business date with status `pending` or `failed`, oldest first); `summary` fills `pinAttention`: at most five `pending` entries (pin sales pending for more than five minutes, oldest first) followed by at most five `double` entries (cash sales with an `instead_of_sale_id` whose pin sale is `paid`, neither of the two reversed).
- Produces in `worker/db/pin.ts`: `refreshPending(ctx: PinContext, date: string, limit: number): Promise<void>`: runs `pinStatus` for at most `limit` pending pin sales of that business date, oldest first.
- Produces: `GET /api/admin/sales?date=` answers `{ sales: AdminSale[]; pinAttempts: AdminPinAttempt[] }` and first calls `refreshPending(ctx, date, 5)`.

`possiblyDouble` for a row `s` of the list (both are `EXISTS` sub-selects in the existing query, so the list stays one batch):
- as the cash sale: `s.instead_of_sale_id` names a sale with `status = 'paid'` that has no counter-entry, and `s` has none either;
- as the pin sale: a `paid` sale without a counter-entry has `instead_of_sale_id = s.id`, and `s` has none either.

- [ ] **Step 1: Write the failing tests** in `test/pin-reports.test.ts` (setup as `test/pin.test.ts`; `paidPin(overrides?)` = start, `finish("paid")`, status; `sales(date)` = the JSON of `/api/admin/sales?date=`; `today` = `businessDate(new Date().toISOString())`):

  ```ts
  it("shows pin next to cash in the day, the month, the sales list and the downloads", async () => {
    await paidPin();                                                                          // Aardbeitje 110
    await postSales(token, [cashSale({ totalCents: 140, lines: [{ productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }] })]);
    const day = await (await api(`/api/admin/reports/day?date=${today}`, { cookie })).json<DayReport>();
    expect(day.totals).toEqual({ cashCents: 140, pinCents: 110, totalCents: 250, saleCount: 2 });
    expect(day.byCategory).toContainEqual({ categoryId: "ijs", categoryName: "IJs", qty: 1, cashCents: 0, pinCents: 110, totalCents: 110 });
    const month = await (await api(`/api/admin/reports/month?month=${today.slice(0, 7)}`, { cookie })).json<MonthReport>();
    expect(month.days).toEqual([{ date: today, cashCents: 140, pinCents: 110, totalCents: 250, saleCount: 2 }]);
    expect((await sales(today)).sales.map((s) => s.method).sort()).toEqual(["cash", "pin"]);
    const csv = await (await api(`/api/admin/reports/month.csv?month=${today.slice(0, 7)}&kind=sales`, { cookie })).text();
    expect(csv).toMatch(/;pin;Aardbeitje;/);
    const summary = await (await api("/api/admin/summary", { cookie })).json<Summary>();
    expect(summary.today).toMatchObject({ cashCents: 140, pinCents: 110 });
    expect(summary.cashExpectedCents).toBe(140);               // pin never passes through the cash box
  });
  it("shows a paid pin sale under pin in the kassa's own Omzet, of the day and of the week", async () => {
    await paidPin();
    await startPinSale(token, pinSale());                                                     // a second one, still waiting: counts nowhere
    const day = await (await api(`/api/kassa/reports/day?date=${today}`, { token })).json<DayReport>();
    expect(day.totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
    const week = await (await api(`/api/kassa/reports/week?date=${today}`, { token })).json<WeekReport>();
    expect(week.totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
    expect(week.days).toEqual([{ date: today, cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 }]);
  });
  it("keeps pin out of the cash box, also across a handover", …)
    // paid pin 110 → cash state expectedCents 0; record an opening and a handover → the pin sale's handover_id stays null, differenceCents 0
  it("reverses a pin sale for the whole amount, as pin, and puts the stock back", …)
    // POST /api/admin/sales/:id/reverse { reason: "terugbetaald via Mollie" } → 201; day totals pinCents 0, cashCents 0; SUM(delta) for aardbeitje 0;
    // the counter-entry row: method "pin", total_cents -110, mollie_payment_id null; cash expected unchanged; nothing was asked of Mollie
  it("refuses to reverse a pin payment that is still open or did not go through", …)   // pending → 409 not_paid; declined → 409 not_paid
  it("marks both sales when cash was taken and the pin payment went through after all", async () => {
    const pin = pinSale();
    await startPinSale(token, pin);                                                           // outcome not known yet
    const cash = cashSale({ insteadOfSaleId: pin.id });
    expect(await postSales(token, [cash])).toEqual([{ id: cash.id, status: "accepted" }]);
    expect((await row(cash.id))!.instead_of_sale_id).toBe(pin.id);
    expect((await sales(today)).sales.map((s) => s.possiblyDouble)).toEqual([false]);         // only the cash sale is a sale so far
    mollie.current.finish("tr_fake1", "paid");
    const list = (await sales(today)).sales;                                                  // opening the day asks Mollie
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.possiblyDouble)).toBe(true);
    expect((await summaryOf()).pinAttention).toEqual([{ kind: "double", date: today, totalCents: 110 }]);
    await api(`/api/admin/sales/${pin.id}/reverse`, { method: "POST", cookie, json: { reason: "terugbetaald via Mollie" } });
    expect((await sales(today)).sales.some((s) => s.possiblyDouble)).toBe(false);
    expect((await summaryOf()).pinAttention).toEqual([]);
  });
  it("books a cash sale whose pin attempt the server does not know, without the link", …)
    // insteadOfSaleId: a random uuid → accepted, instead_of_sale_id null; insteadOfSaleId: the id of a cash sale → accepted, null; no field at all → accepted (an iPad with the old app)
  it("lists what did not go through or is still open apart from the sales", async () => {
    await paidPin();
    const open = pinSale(); await startPinSale(token, open);                                  // tr_fake2 stays open
    …declined: a third attempt answers terminal_busy (the terminal is still busy with the second)
    const answer = await sales(today);
    expect(answer.sales).toHaveLength(1);
    expect(answer.pinAttempts).toMatchObject([
      { id: open.id, totalCents: 110, outcome: null, lines: [{ name: "Aardbeitje", qty: 1 }] },
      { outcome: "declined", reason: "terminal_busy" },
    ]);
  });
  it("asks Mollie about at most five open payments when a day is opened", …)
    // seven pending pin rows inserted straight into the table with payment ids tr_a … tr_g → one GET of the day → exactly five GET /v2/payments/… requests
  it("points the penningmeester at a payment that has waited more than five minutes", …)
    // summary(env.DB, now) with a pending pin sale sold six minutes before now → [{ kind: "pending", date, totalCents: 110 }]; sold one minute before → []
  ```
  Adjust `test/reports.test.ts` and `src/beheer/SalesPage.test.tsx` where they pin the old shape (`{ sales }` gains `pinAttempts: []`, sales gain `possiblyDouble: false`, the summary gains `pinAttention: []`).

- [ ] **Step 2: Run them.** `npm run test:worker -- test/pin-reports.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `summary` runs its two new queries in the batch it already has. `admin-sales.ts` builds a `PinContext` as the kassa routes do.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: beheer shows pin attempts and marks a receipt that may have been paid twice"`

---

### Task 6: The iPad follows a pin payment and parks what it cannot follow

**Files:**
- Create: `src/kassa/store/pin.ts`, `src/kassa/store/pin.test.ts`
- Modify: `src/lib/api.ts`, `src/lib/api.test.ts`, `src/kassa/store/db.ts`

**Interfaces:**
- Consumes: `PinStatus`, `PinOutcome` (Tasks 1 and 3); `pinSaleInput`; `kassaApi`, `getMeta`, `getDb`.
- Produces in `src/lib/api.ts`: `ApiInit` gains `timeoutMs?: number` (default stays 15 000).
- Produces in `src/kassa/store/db.ts`: `VERSION = 2`; the upgrade creates the fase 1 stores when coming from 0 and the store `pin` (`keyPath: "id"`) when coming from below 2. What is in `outbox`, `rejected` and `meta` stays.
- Produces in `src/kassa/store/pin.ts`:
  ```ts
  export const POLL_MS = 1000;             // spec §11: the iPad asks every second
  export const POLL_TIMEOUT_MS = 5000;     // one question may take this long
  export const LOST_MS = 10_000;           // no answer for this long: the outcome is unknown
  export const WAIT_LIMIT_MS = 120_000;    // still running after this long: the outcome is unknown

  /** A receipt being paid by pin, as it is sent to the server. */
  export type PinReceipt = PinSaleInput;
  /**
   * A receipt the kassa is not done with. `parked`: the outcome of its payment is not known yet.
   * `failed`: the payment did not go through and the beheerder has not seen that yet.
   * `cashTaken`: the beheerder rang it up as cash in the meantime.
   */
  export type Parked = PinReceipt & { parked: boolean; failed: boolean; cashTaken: boolean };
  export type PinEnd =
    | { kind: "paid" }
    | { kind: "failed"; outcome: Exclude<PinOutcome, "paid">; reason: string | null }
    | { kind: "unknown" };
  export type PinProgress = { sent: boolean; testUrl: string | null; cancelFailed: boolean };
  export type PinRun = { done: Promise<PinEnd>; cancel(): void };

  /** Starts the payment and follows it to its end. The receipt is kept on the iPad for as long as its outcome is not known. */
  export function runPin(receipt: PinReceipt, onProgress: (progress: PinProgress) => void): PinRun;
  /** The receipts that are parked or failed, oldest first. */
  export async function listParked(): Promise<Parked[]>;
  /** On start: every receipt that is neither parked nor failed belonged to a kassa that was closed while it waited. They are parked. */
  export async function parkLeftovers(): Promise<void>;
  export async function markCashTaken(id: string): Promise<void>;
  /** Asks the server about every parked receipt. `paid`: forgotten. `failed`: kept as failed until `dismissFailed`. */
  export async function resolveParked(): Promise<{ paid: Parked[]; failed: Parked[] }>;
  /** The beheerder has seen that this payment did not go through: the receipt is forgotten. */
  export async function dismissFailed(id: string): Promise<void>;
  ```

**How `runPin` works:**
1. Store the receipt (`parked: false`, `failed: false`, `cashTaken: false`). A failure to store does not stop the payment.
2. Each round, at once and then every `POLL_MS` after the previous answer: until the server has answered once, `POST /api/kassa/pin` with the receipt (the server takes the same id again); after that `GET /api/kassa/pin/<id>` with `timeoutMs: POLL_TIMEOUT_MS`.
3. An answer `200`: with an `outcome` → end (`paid`, or `failed` with that outcome and reason); without → `onProgress({ sent, testUrl, cancelFailed })`.
4. A `4xx` answer to the start (`401` included) → end `failed`, outcome `start_failed`, reason the error code. Nothing was started.
5. Status `0` or `5xx`: no answer. `LOST_MS` after the last answer (or after the start, when there was none) → end `unknown`. `WAIT_LIMIT_MS` after the start and still running → end `unknown`.
6. `cancel()` does nothing before the server has answered once. After that it posts `/api/kassa/pin/<id>/cancel` once: an answer with an outcome ends the run; an answer without one sets `cancelFailed` in the next progress and the rounds go on.
7. At the end: `paid` or `failed` → the receipt is removed from the store; `unknown` → it stays, with `parked: true`.

`resolveParked`, per receipt with `parked: true`, `GET /api/kassa/pin/<id>` (`timeoutMs: POLL_TIMEOUT_MS`): outcome `paid` → removed, in `paid`; another outcome, or `404` (the server never got the start) → not paid; no outcome yet, or no answer → stays parked. A receipt that was not paid is removed when `cashTaken` (the customer has paid, there is nothing to tell); otherwise it stays with `parked: false, failed: true` and is in `failed`. A failed receipt is never asked about again: it stays, also over a restart of the kassa, until `dismissFailed`.

- [ ] **Step 1: Write the failing tests** in `src/kassa/store/pin.test.ts` (`vi.useFakeTimers({ shouldAdvanceTime: true })`, `await setMeta("deviceToken", "tok")`, `const receipt = (): PinReceipt => ({ id: crypto.randomUUID(), soldAt: new Date().toISOString(), totalCents: 110, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }] })`, `const status = (r, over = {}) => ({ id: r.id, outcome: null, reason: null, sent: true, testUrl: null, ...over })`, `const stored = async () => (await getDb()).getAll("pin")`):

  ```ts
  it("follows a payment to paid and forgets the receipt", async () => {
    const r = receipt();
    let asked = 0;
    mockApi({ "POST /api/kassa/pin": status(r), [`/api/kassa/pin/${r.id}`]: () => (++asked < 3 ? status(r) : status(r, { outcome: "paid" })) });
    const progress = vi.fn();
    const run = runPin(r, progress);
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(await run.done).toEqual({ kind: "paid" });
    expect(progress).toHaveBeenCalledWith({ sent: true, testUrl: null, cancelFailed: false });
    expect(calls("POST")).toHaveLength(1);
    expect(calls("POST")[0]!.body).toEqual(r);
    expect(await stored()).toEqual([]);
  });
  it("ends with Mollie's reason when the payment did not go through", …)
    // GET → { outcome: "declined", reason: "insufficient_funds" } → { kind: "failed", outcome: "declined", reason: "insufficient_funds" }; store empty
  it("ends at once when the server refuses the start", …)
    // POST → [409, { error: "no_terminal" }] → { kind: "failed", outcome: "start_failed", reason: "no_terminal" }; no GET; store empty
  it("sends the same start again until the server answers", …)
    // offline for the first two rounds, then mockApi → two or more POSTs with the same body, then GETs; ends paid
  it("parks the receipt after ten seconds without an answer", async () => {
    const r = receipt();
    mockApi({ "POST /api/kassa/pin": status(r), [`/api/kassa/pin/${r.id}`]: status(r) });
    const run = runPin(r, vi.fn());
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    mockOffline();
    await vi.advanceTimersByTimeAsync(LOST_MS + POLL_MS);
    expect(await run.done).toEqual({ kind: "unknown" });
    expect(await listParked()).toMatchObject([{ id: r.id, totalCents: 110, parked: true, cashTaken: false }]);
  });
  it("parks the receipt when the payment is still running after two minutes", …)   // GET keeps answering "running" → after WAIT_LIMIT_MS: unknown, parked
  it("asks the server to cancel, and keeps following when that is refused", …)
    // cancel() → one POST …/cancel answering status(r) → progress { cancelFailed: true }; later GET paid → { kind: "paid" }; a second cancel() sends no second request
  it("ends as cancelled when the server says so", …)   // POST …/cancel → { outcome: "canceled" } → { kind: "failed", outcome: "canceled", reason: null }
  it("does not cancel before the server has answered the start", …)   // offline; cancel() → no request to …/cancel
  it("parks what a closed kassa left behind (Review Focus 3)", async () => {
    const r = receipt();
    mockOffline();
    runPin(r, vi.fn());                                          // the kassa is closed while this runs
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await listParked()).toEqual([]);
    await parkLeftovers();                                       // the next start of the kassa
    expect(await listParked()).toMatchObject([{ id: r.id, parked: true }]);
  });
  it("settles parked receipts when the server knows their outcome", …)
    // four parked: paid, declined, 404 not_found, still running → resolveParked() → { paid: [first], failed: [second, third] };
    // listParked() → second and third with { parked: false, failed: true }, fourth still parked; offline → nothing changes
  it("keeps a payment that did not go through until the beheerder has seen it, also over a restart", …)
    // after the above: resolveParked() again asks only about the fourth; parkLeftovers() leaves the failed ones failed; dismissFailed(second.id) → gone from listParked()
  it("remembers that cash was taken for a parked receipt, and then has nothing to tell when the payment fails", …)
    // markCashTaken(id) → listParked()[0].cashTaken true; the server answers declined → resolveParked() → { paid: [], failed: [] }; listParked() → []
  it("adds the pin store to a kassa from fase 1 without losing what waits", async () => {
    // Build a version 1 database by hand with one outbox item, then open it through getDb().
    …expect([...db.objectStoreNames]).toEqual(["meta", "outbox", "pin", "rejected"]);
    …expect(await pendingCount()).toBe(1);
  });
  ```
  In `src/lib/api.test.ts`: `it("gives up after the time it was given")`: a `fetch` that never answers, `kassaApi(path, "tok", { timeoutMs: 50 })` → `{ ok: false, status: 0, error: "offline" }`.

- [ ] **Step 2: Run them.** `npm run test:client -- src/kassa/store/pin.test.ts src/lib/api.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `timeoutMs`, the database upgrade and `src/kassa/store/pin.ts`.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: the iPad follows a pin payment and parks a receipt whose outcome it cannot learn"`

---

### Task 7: The Pin dialog on the kassa screen

**Files:**
- Create: `src/kassa/PinDialog.tsx`, `src/kassa/pin-text.ts`, `src/kassa/pin-text.test.ts`
- Modify: `src/kassa/KassaScreen.tsx`, `src/kassa/KassaScreen.test.tsx`, `src/kassa/cash.ts`, `src/kassa/cash.test.ts`

**Interfaces:**
- Consumes: `PinReceipt`, `PinEnd`, `PinProgress`, `PinRun` (Task 6, types only: `KassaScreen` never imports the store's functions).
- Produces in `src/kassa/cash.ts`: `cashSaleFor(receipt: { totalCents: number; lines: SaleLineInput[] }, cashGivenCents: number, insteadOfSaleId: string | null): CashSaleInput` (new id, `soldAt` now; `insteadOfSaleId` only present when not null).
- Produces in `src/kassa/pin-text.ts`:
  ```ts
  /** The heading for a payment that did not go through. */
  export function pinTitle(outcome: Exclude<PinOutcome, "paid">): string;
  /** One more sentence when the reason says something the beheerder can act on; otherwise null. */
  export function pinDetail(reason: string | null): string | null;
  ```
  Exact copy. Titles: `declined` → `Betaling geweigerd`; `canceled` → `Betaling geannuleerd`; `expired` → `Betaling verlopen`; `start_failed` → `Pin starten lukt niet`. Details: `insufficient_funds` → `Onvoldoende saldo.`; `invalid_pin` → `Onjuiste pincode.`; `expired_card` → `De pas is verlopen.`; `terminal_busy` → `De betaalterminal is nog bezig met een andere betaling.`; `terminal_unreachable` and `terminal_closed` → `De betaalterminal is niet bereikbaar. Staat hij aan en heeft hij internet?`; `unauthorized` → `Mollie accepteert de sleutel niet. Meld het aan de penningmeester.`; `refused`, `not_found` and `terminal_id_not_found` → `Mollie weigert de betaling te starten. Meld het aan de penningmeester.`; `no_terminal` and `pin_not_configured` → `Pin is nog niet ingesteld. Meld het aan de penningmeester.`; `no_answer` → `Mollie gaf geen antwoord.`; anything else → null.
- Produces on `KassaScreen`:
  ```ts
  /** Pin. Without this prop the Pin button stays off. */
  pin?: {
    /** Why pin cannot be used right now, shown under the pay buttons; null when it can. */
    blocked: string | null;
    start(receipt: PinReceipt, onProgress: (progress: PinProgress) => void): PinRun;
  };
  /** A pin payment went through. The screen is already empty again when this is called. */
  onPinPaid?(receipt: PinReceipt): void;
  ```
- Produces `PinDialog` (presentational):
  ```ts
  export type PinView =
    | { step: "waiting"; sent: boolean; testUrl: string | null; cancelFailed: boolean }
    | { step: "failed"; outcome: Exclude<PinOutcome, "paid">; reason: string | null }
    | { step: "unknown" };
  type Props = { view: PinView | null; totalCents: number; onCancel(): void; onRetry(): void; onCash(): void; onBack(): void; onNext(): void };
  ```

**Behaviour and exact copy:**
- The Pin button is enabled when `pin` is given, `pin.blocked` is null, the receipt is not empty and nothing is being paid. When `pin.blocked` is a string it is shown in a line under the two buttons (`data-testid="pin-blocked"`), and the button's `title` is the same string. The `title` "Pin volgt in fase 2" is gone.
- Tapping Pin makes a `PinReceipt` (new id, `soldAt` now, the receipt's total and lines), calls `pin.start` once and shows the dialog (`dismissable={false}`, `centered`). The receipt stays as it is behind the dialog.
- `waiting`: title `Pin, te betalen`; the amount as in the cash dialog; `Betaling wordt gestart…` until `sent`, then `Houd pas of telefoon tegen de betaalterminal`. One button, `Annuleren`, disabled until `sent`; it calls `cancel()` and the dialog stays. With `cancelFailed`: `Annuleren lukte niet. Kijk op de betaalterminal.` With a `testUrl`: a link `Test: kies de uitkomst bij Mollie` (`target="_blank"`, `rel="noreferrer"`).
- End `paid`: the receipt is cleared, the dialog closes, toast `Pin betaald` (1500 ms), `onPinPaid(receipt)`.
- End `failed`: title from `pinTitle`, the amount, `pinDetail` when there is one, and three buttons in this order: `Opnieuw proberen` (a new `PinReceipt` with a new id for the same receipt, `pin.start` again), `Toch contant` (the pin dialog closes and the cash dialog opens for this receipt; the cash sale that follows carries `insteadOfSaleId` = the id of the last pin attempt), `Terug naar de bon` (the dialog closes, the receipt is untouched).
- End `unknown`: the receipt is cleared at once (the kassa is free). Title `Uitkomst onbekend`; `De verbinding viel weg tijdens het pinnen. Kijk op de betaalterminal of de betaling is gelukt.`; `De bon van € 3,60 is geparkeerd. Zodra er weer verbinding is, haalt de kassa de uitkomst op.` (the amount of this receipt). Buttons: `Volgende klant` (primary; closes) and `Toch contant` (the cash dialog opens for the parked receipt's lines and total; the cash sale carries `insteadOfSaleId`).
- `KassaScreen` keeps what is being paid in cash as `{ totalCents, lines, insteadOfSaleId, fromCart }` instead of the boolean `paying`; a cash sale from the cart clears the cart, one for a parked receipt does not. `finish` uses `cashSaleFor`.
- `PinDialog` is rendered after `CashDialog` in `KassaScreen`, so that the tap shield it leaves behind for 300 ms lies over the cash dialog that opens on `Toch contant`.

- [ ] **Step 1: Write the failing tests.** `src/kassa/pin-text.test.ts`: one table test over every title and detail above, plus `pinDetail("iets_nieuws")` and `pinDetail(null)` → null. `src/kassa/cash.test.ts`: `cashSaleFor` gives a sale `cashSaleInput` accepts, with and without `insteadOfSaleId`. In `src/kassa/KassaScreen.test.tsx` replace `"disables paying on an empty receipt, and pin always"` by the tests below. Helper in the file:

  ```ts
  /** A pin payment the test steers by hand. */
  function fakePin(blocked: string | null = null) {
    const runs: { receipt: PinReceipt; progress(p: Partial<PinProgress>): void; end(e: PinEnd): void; cancel: Mock }[] = [];
    const start = vi.fn((receipt: PinReceipt, onProgress: (p: PinProgress) => void) => {
      let end!: (e: PinEnd) => void;
      const done = new Promise<PinEnd>((resolve) => (end = resolve));
      const cancel = vi.fn();
      runs.push({ receipt, progress: (p) => act(() => onProgress({ sent: true, testUrl: null, cancelFailed: false, ...p })), end: (e) => act(() => end(e)), cancel });
      return { done, cancel };
    });
    return { pin: { blocked, start }, runs, start };
  }
  ```

  ```ts
  it("keeps Pin off on an empty receipt, without the pin prop, and when pin is blocked, with the reason shown", async () => {
    const { rerender } = render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
    await tap(/Koffie/);
    expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
    rerender(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={fakePin("Geen internet: pin kan nu niet. Contant werkt door.").pin} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
    expect(screen.getByTestId("pin-blocked")).toHaveTextContent("Geen internet: pin kan nu niet. Contant werkt door.");
    rerender(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={fakePin().pin} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeEnabled();
    expect(screen.queryByTestId("pin-blocked")).not.toBeInTheDocument();
  });
  it("pays by pin: shows the amount and what to do, and keeps the receipt until Mollie has approved", async () => {
    const onSale = vi.fn(); const onPinPaid = vi.fn(); const { pin, runs } = fakePin();
    render(<KassaScreen catalog={catalog} onSale={onSale} pin={pin} onPinPaid={onPinPaid} />);
    await tap(/Aardbeitje/); await tap(/Koffie/); await tap("Pin");
    const dialog = within(screen.getByRole("dialog", { name: "Pin, te betalen" }));
    expect(dialog.getByText("€ 2,50")).toBeInTheDocument();
    expect(dialog.getByText("Betaling wordt gestart…")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Annuleren" })).toBeDisabled();
    expect(pinSaleInput.parse(runs[0]!.receipt)).toMatchObject({ totalCents: 250, lines: [{ productId: "aardbeitje", qty: 1 }, { productId: "koffie", qty: 1 }] });
    runs[0]!.progress({});
    expect(dialog.getByText("Houd pas of telefoon tegen de betaalterminal")).toBeInTheDocument();
    expect(total()).toHaveTextContent("€ 2,50");                       // the receipt is still there
    runs[0]!.end({ kind: "paid" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Pin betaald")).toBeInTheDocument();
    expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
    expect(onPinPaid).toHaveBeenCalledWith(runs[0]!.receipt);
    expect(onSale).not.toHaveBeenCalled();
  });
  it("starts one payment on a double tap on Pin (Review Focus 4)", …)   // userEvent.dblClick(Pin) → start called once
  it("offers three ways on after a payment that did not go through", async () => {
    …end({ kind: "failed", outcome: "declined", reason: "insufficient_funds" })
    const dialog = within(await screen.findByRole("dialog", { name: "Betaling geweigerd" }));
    expect(dialog.getByText("Onvoldoende saldo.")).toBeInTheDocument();
    expect(dialog.getAllByRole("button").map((b) => b.textContent)).toEqual(["Opnieuw proberen", "Toch contant", "Terug naar de bon"]);
    await tap("Terug naar de bon");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(total()).toHaveTextContent("€ 1,40");
  });
  it.each([["canceled", "Betaling geannuleerd"], ["expired", "Betaling verlopen"], ["start_failed", "Pin starten lukt niet"]] as const)("names a payment that ended as %s", …)
  it("tries again with a new payment for the same receipt", …)
    // failed → "Opnieuw proberen" → start called twice; runs[1].receipt.id ≠ runs[0].receipt.id; same total and lines; the waiting view is back; a double tap on Opnieuw proberen starts one
  it("rings up cash after a failed pin payment and names the pin attempt", …)
    // failed → "Toch contant" → the dialog "Contant, te betalen" with € 1,40 → "Gepast" → onSale once with { totalCents: 140, cashGivenCents: 140, insteadOfSaleId: runs[0].receipt.id }; receipt empty
  it("parks the receipt and frees the screen at once when the outcome is unknown", async () => {
    …end({ kind: "unknown" })
    const dialog = within(await screen.findByRole("dialog", { name: "Uitkomst onbekend" }));
    expect(dialog.getByText("De verbinding viel weg tijdens het pinnen. Kijk op de betaalterminal of de betaling is gelukt.")).toBeInTheDocument();
    expect(dialog.getByText("De bon van € 1,40 is geparkeerd. Zodra er weer verbinding is, haalt de kassa de uitkomst op.")).toBeInTheDocument();
    expect(total()).toHaveTextContent("€ 0,00");
    await tap("Volgende klant");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSale).not.toHaveBeenCalled(); expect(onPinPaid).not.toHaveBeenCalled();
  });
  it("rings up the parked receipt as cash when the beheerder chooses that", …)
    // unknown → "Toch contant" → the cash dialog shows € 1,40 → "€ 5" → "Klaar" → onSale with { totalCents: 140, cashGivenCents: 500, insteadOfSaleId: runs[0].receipt.id, lines: [{ productId: "koffie", qty: 1 }] }
  it("asks to cancel and keeps waiting for the real outcome", …)
    // progress({}) → tap "Annuleren" → runs[0].cancel called once; the dialog is still "Pin, te betalen"; progress({ cancelFailed: true }) → "Annuleren lukte niet. Kijk op de betaalterminal."
  it("shows Mollie's test link only when there is one", …)
    // progress({ testUrl: "https://www.mollie.com/checkout/test-mode?x" }) → link "Test: kies de uitkomst bij Mollie" with that href, target "_blank"; progress({}) → no link
  it("offers no way to take a paid sale back", …)   // after "paid": no button whose name matches /terugdraai/i
  ```

- [ ] **Step 2: Run them.** `npm run test:client -- src/kassa`. Expected: FAIL.

- [ ] **Step 3: Implement** `pin-text.ts`, `cashSaleFor`, `PinDialog.tsx` and the changes in `KassaScreen.tsx`. Buttons in the failed and unknown views are at least 64 px high (`Button size="lg"`), stacked full width so three fit.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: the Pin button works: waiting, paid, not paid and outcome unknown on the kassa screen"`

---

### Task 8: The kassa page: TEST bar, why pin is off, parked receipts

**Files:**
- Create: `src/kassa/TestBar.tsx`, `src/kassa/ParkedPins.tsx`
- Modify: `src/kassa/KassaPage.tsx`, `src/kassa/KassaPage.test.tsx`, `src/test-utils.tsx` (`mockApi` keys ending in `/*`)

**Interfaces:**
- Consumes: `runPin`, `listParked`, `parkLeftovers`, `markCashTaken`, `resolveParked`, `dismissFailed`, `Parked` (Task 6); `KassaScreen`'s `pin` and `onPinPaid` (Task 7); `cashSaleFor` (Task 7); `Catalog.pin` (Task 2).
- Produces `TestBar` (no props): a full-width bar above everything else on the kassa, `role="status"`, background `#F5E7BF`, text `#5E4500`, a bold `TEST` and `Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.`
- Produces `ParkedPins`:
  ```ts
  type Props = {
    /** The receipts that are parked or failed, oldest first. */
    receipts: Parked[];
    onCash(receipt: Parked, cashGivenCents: number): void;
    /** The beheerder has seen that this payment did not go through. */
    onSeen(id: string): void;
  };
  ```

**Behaviour and exact copy:**
- On start, before the screen shows: `parkLeftovers()`, then `listParked()`.
- `pin.blocked`, first that applies: not online → `Geen internet: pin kan nu niet. Contant werkt door.`; not paired → `Kassa is ontkoppeld: pin kan nu niet.`; `catalog.pin` missing (a catalog cached by fase 1) or not `ready` → `Pin is nog niet ingesteld.`; else null.
- `TestBar` is shown when `catalog.pin?.mode === "test"`, above the delivery bar.
- `pin.start` is `runPin`; when a run ends, the parked list is read again. `onPinPaid`: `noteSold(receipt.lines)`, the count on the tiles is refreshed and the sync is kicked (which fetches the catalog with the new stock).
- A cash sale with an `insteadOfSaleId` (from the screen or from the parked list) also calls `markCashTaken(insteadOfSaleId)`.
- While anything is parked: `resolveParked()` every 5 seconds, and at once when the browser reports `online`; then the list is read again. For each receipt in `paid`: `noteSold`, and the short confirmation `Pinbetaling van € 3,60 is gelukt` (a toast, like `Pin betaald`). For a receipt that was not paid nothing opens by itself: it shows in the footer, as below.
- The footer keeps its fase 1 layout: the status badge on the left, the button `Omzet` on the right. `ParkedPins` sits with the status badge (both in one wrapping row), and shows nothing when there is nothing:
  - with parked receipts, a button `1 pinbetaling wacht op bevestiging` / `2 pinbetalingen wachten op bevestiging` (the look of the `Omzet` button);
  - with failed receipts, a button `Pinbetaling van € 3,60 niet gelukt` for one, `2 pinbetalingen niet gelukt` for more (the red look of the "afgekeurd" button). This is spec §8's "melding met het bedrag": it stays until the beheerder has seen it, and it never lies over a sale in progress.
- Either button opens the dialog `Pinbetalingen` (wide), built like the fase 1 dialog `Afgekeurde verkopen`: one block per receipt, the failed ones first, `Sluiten` at the bottom.
  - Failed: `Niet gelukt · Pin van 14:32 · € 3,60` (time in Amsterdam), its lines as `2× Aardbeitje, 1× Koffie`, `Deze pinbetaling is niet gelukt en is niet geboekt. Staat de klant er nog? Reken dan opnieuw af.`, and the button `Gezien` (`onSeen`). A block that was dealt with keeps its place, greyed, while the dialog is open, so that the second tap of a double tap cannot land on the next one; the dialog closes when the last one is dealt with.
  - Parked: `Wacht op bevestiging · Pin van 14:32 · € 3,60`, its lines, `Kijk op de betaalterminal of de betaling is gelukt. Zodra er verbinding is, haalt de kassa de uitkomst op.`, and the button `Toch contant`, or the text `Contant afgerekend` once cash was taken. `Toch contant` opens a `CashDialog` for that receipt's total; when paid, `onCash(receipt, cashGivenCents)`.

- [ ] **Step 1: Write the failing tests** in `src/kassa/KassaPage.test.tsx` (helpers there: `paired()` stores the token and the test catalog; add `const pinStatus = (id: string, over = {}) => ({ id, outcome: null, reason: null, sent: true, testUrl: null, ...over })`, `const idOf = (req: { url: string }) => req.url.split("/")[4]!` and `const startedPin = () => calls("POST").find((c) => c.url === "/api/kassa/pin")!.body as { id: string }`). The id of a pin payment is made at the tap, so these tests need a route for "any path under": `mockApi` in `src/test-utils.tsx` gains that. A key ending in `/*` answers every path below it; an exact key still wins, and a key with a method wins over one without:

  ```ts
  it("shows the TEST bar in Mollie's test mode only", async () => {
    await setMeta("deviceToken", "tok");
    await saveCatalog({ ...catalog, pin: { mode: "test", ready: true } });
    mockOffline();
    const first = renderAt("/");
    expect(await screen.findByText("TEST")).toBeInTheDocument();
    expect(screen.getByText("Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.")).toBeInTheDocument();
    first.unmount();
    await saveCatalog(catalog);                                   // mode "live"
    renderAt("/");
    await screen.findByRole("button", { name: /Aardbeitje/ });
    expect(screen.queryByText("TEST")).not.toBeInTheDocument();
  });
  it("keeps Pin off without a connection and says why, while cash goes on", …)
    // mockOffline → tap Aardbeitje → Pin disabled, "Geen internet: pin kan nu niet. Contant werkt door."; Contant → Gepast → "1 verkoop wacht op verzending"
  it("keeps Pin off until a terminal is chosen, and on an iPad that still has a fase 1 catalog", …)
    // pin { mode: "test", ready: false } → "Pin is nog niet ingesteld."; a stored catalog without `pin` → the same line, and the screen works
  it("books nothing in the outbox for a paid pin sale and counts the stock down on the tile", async () => {
    await setMeta("deviceToken", "tok"); await saveCatalog(lowStock);
    mockApi({ "/api/kassa/catalog": lowStock, "POST /api/kassa/pin": (req) => pinStatus(req.body.id), "/api/kassa/pin/*": (req) => pinStatus(idOf(req), { outcome: "paid" }) });
    renderAt("/");
    await tap(/Aardbeitje/); await tap("Pin");
    expect(await screen.findByText("Pin betaald", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText("nog 2")).toBeInTheDocument();
    expect(await pendingCount()).toBe(0);
  });
  it("parks the receipt when the connection drops, takes the next customer, and settles it when the connection is back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    …start a pin payment that keeps running; mockOffline(); await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(await screen.findByRole("dialog", { name: "Uitkomst onbekend" })).toBeInTheDocument();
    await tap("Volgende klant");
    expect(await screen.findByRole("button", { name: "1 pinbetaling wacht op bevestiging" })).toBeInTheDocument();
    await tap(/Koffie/); await tap("Contant"); await tap("Gepast");      // the next customer, in cash, offline
    await waitFor(async () => expect(await pendingCount()).toBe(1));
    mockApi({ …GET status of the parked id → paid, "POST /api/kassa/sales": acceptAll, "/api/kassa/catalog": catalog });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByText("Pinbetaling van € 1,10 is gelukt")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/wacht op bevestiging/)).not.toBeInTheDocument());
  });
  it("tells the beheerder with the amount when a parked payment did not go through, without opening anything by itself", async () => {
    …a parked receipt of € 1,10; the server answers declined; the round of five seconds passes
    expect(await screen.findByRole("button", { name: "Pinbetaling van € 1,10 niet gelukt" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/wacht op bevestiging/)).not.toBeInTheDocument();
    await tap(/Koffie/);                                           // the kassa is not held up
    expect(screen.getByTestId("total")).toHaveTextContent("€ 1,40");
    await tap("Pinbetaling van € 1,10 niet gelukt");
    const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
    expect(dialog.getByText(/^Niet gelukt · Pin van \d\d:\d\d · € 1,10$/)).toBeInTheDocument();
    expect(dialog.getByText("1× Aardbeitje")).toBeInTheDocument();
    expect(dialog.getByText("Deze pinbetaling is niet gelukt en is niet geboekt. Staat de klant er nog? Reken dan opnieuw af.")).toBeInTheDocument();
    await user().click(dialog.getByRole("button", { name: "Gezien" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /niet gelukt/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent("€ 1,40");   // the receipt in progress is untouched
  });
  it("still shows a failed payment after the kassa was closed and opened again, until it has been seen", …)
    // a stored receipt with { parked: false, failed: true } → renderAt("/") offline → the button "Pinbetaling van € 3,60 niet gelukt"; two of them → "2 pinbetalingen niet gelukt"
  it("rings up a parked receipt as cash, and then says nothing when the pin payment fails", …)
    // "1 pinbetaling wacht op bevestiging" → dialog "Pinbetalingen" → "Toch contant" → "Gepast" → the outbox holds { totalCents: 110, insteadOfSaleId: <parked id> }; the block shows "Contant afgerekend";
    // the server then answers declined → no button /niet gelukt/, no dialog; the waiting button is gone
  it("confirms a parked payment that went through after cash was taken", …)
    // as above but the server answers paid → toast "Pinbetaling van € 1,10 is gelukt"; the waiting button is gone (beheer marks the two sales, Task 5)
  it("keeps Omzet where it was, with the pin buttons beside the status", …)
    // one parked and one failed receipt stored → the footer holds, in this order, "Online", the two pin buttons, "Omzet"; "Omzet" still opens the dialog "Omzet"
  it("brings back a receipt that was waiting when the kassa was closed (Review Focus 3)", async () => {
    await paired();
    await (await getDb()).put("pin", { id: crypto.randomUUID(), soldAt: "2026-07-30T12:32:00.000Z", totalCents: 360, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 }, { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }], parked: false, failed: false, cashTaken: false });
    mockOffline();
    renderAt("/");
    await tap("1 pinbetaling wacht op bevestiging");
    const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
    expect(dialog.getByText("Wacht op bevestiging · Pin van 14:32 · € 3,60")).toBeInTheDocument();
    expect(dialog.getByText("2× Aardbeitje, 1× Koffie")).toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Run them.** `npm run test:client -- src/kassa/KassaPage.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** `TestBar.tsx`, `ParkedPins.tsx` and the wiring in `KassaPage.tsx`.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: the kassa shows TEST in test mode, says why pin is off and keeps parked receipts until their outcome is known"`

---

### Task 9: Beheer: choose the terminal, see pin attempts and what needs a look

**Files:**
- Modify: `src/beheer/SettingsPage.tsx`, `src/beheer/SettingsPage.test.tsx`, `src/beheer/SalesPage.tsx`, `src/beheer/SalesPage.test.tsx`, `src/beheer/DashboardPage.tsx`, `src/beheer/beheer-auth.test.tsx` (where the dashboard's tests live, with their `summary` fixture)

**Interfaces:**
- Consumes: `PinSettings`, `PinTerminal`, `AdminPinAttempt`, `PinAttention`, `AdminSale.possiblyDouble`; `GET /api/admin/pin`, `POST /api/admin/pin/terminal`, `GET /api/admin/sales` (`{ sales, pinAttempts }`), `GET /api/admin/summary`.

**Behaviour and exact copy:**
- **Instellingen**, a section `Pin via Mollie`, between `Kassa koppelen` and `Wachtwoord wijzigen`:
  - `mode: "test"`: `Testmodus: betalingen zijn nagespeeld, er wordt geen geld afgeschreven.` `mode: "live"`: `Echte betalingen.`
  - `problem: "no_key"`: `De sleutel van Mollie is nog niet ingesteld. In het handboek staat hoe de penningmeester dat doet.` `"unauthorized"`: `Mollie accepteert de sleutel niet. Controleer de sleutel.` `"unreachable"`: `Mollie is niet bereikbaar. Probeer het opnieuw.` with the button `Opnieuw proberen`.
  - No problem and no terminals: `Mollie geeft geen betaalterminal terug. Zet in het Mollie-dashboard de betaalmethode Point of sale aan; in de testmodus verschijnt hier dan vanzelf een testterminal.`
  - Otherwise a radio group `Betaalterminal`: one option per terminal, labelled with its description (or its id when the description is empty), under it brand, model and serial number as far as known, and `(niet actief)` for a terminal whose status is not `active`, which cannot be selected. The chosen one is selected and carries the badge `Gekozen`. Button `Opslaan` (off while nothing changed) posts `{ terminalId }`; then `Betaalterminal opgeslagen.` (`role="status"`). `unknown_terminal` → `Deze terminal staat niet meer in de lijst van Mollie.` (and the list is fetched again); `terminal_not_active` → `Deze terminal is niet actief.`; no connection → `Geen verbinding. Probeer het opnieuw.`
  - When a terminal list is shown but none is chosen: `Kies een betaalterminal. Tot die tijd is de knop Pin op de kassa uit.`
- **Verkopen:**
  - A sale with `possiblyDouble` carries the badge `Mogelijk dubbel betaald` (red-brown, like `Tegenboeking`) with the `title` `Er is contant afgerekend en de pinbetaling is daarna toch gelukt. Draai één van de twee terug.`
  - Under the list, only when there are any, a region `Pin: niet gelukt of nog open` with the note `Deze pinbetalingen tellen niet mee in de omzet.` and one row per attempt: the time, the amount, the lines, and a label: outcome null → `Wacht op bevestiging`; `declined` → `Geweigerd`; `canceled` → `Geannuleerd`; `expired` → `Verlopen`; `start_failed` → `Niet gestart`. No button.
  - `Geen verkopen op deze dag.` is shown only when both lists are empty.
  - `explain` gains `not_paid` → `Deze pinbetaling is niet gelukt en kan niet worden teruggedraaid.`
  - The reversal dialog for a pin sale already says to refund in the Mollie dashboard first; it gains the sentence `Terugdraaien kan alleen voor het hele bedrag.`
- **Overzicht:** when `pinAttention` is not empty, a card `Pin: let op` as the first card, one link per entry to `/beheer/verkopen?datum=<date>`: `Pinbetaling van € 3,60 wacht op bevestiging (21-11-2026)` or `Mogelijk dubbel betaald: € 3,60 (21-11-2026)`.

- [ ] **Step 1: Write the failing tests.**

  `src/beheer/SettingsPage.test.tsx` (the existing tests mock the other sections' routes; add `"/api/admin/pin"` to their common mock with `{ mode: "test", terminalId: null, terminals: [], problem: null }`):
  ```ts
  const terminals = [
    { id: "term_test", description: "Testterminal", status: "active", brand: "Tap", model: "Tap", serialNumber: null },
    { id: "term_oud", description: "Oude terminal", status: "inactive", brand: "PAX", model: "A920", serialNumber: "123" },
  ];
  it("lets the penningmeester choose the Mollie terminal from Mollie's own list", async () => {
    let chosen: string | null = null;
    mockApi({
      "/api/admin/pin": () => ({ mode: "test", terminalId: chosen, terminals, problem: null }),
      "POST /api/admin/pin/terminal": (req) => { chosen = req.body.terminalId; return { ok: true }; },
    });
    renderAt("/beheer/instellingen");
    const section = within(await screen.findByRole("region", { name: "Pin via Mollie" }));
    expect(await section.findByText("Testmodus: betalingen zijn nagespeeld, er wordt geen geld afgeschreven.")).toBeInTheDocument();
    expect(section.getByText("Kies een betaalterminal. Tot die tijd is de knop Pin op de kassa uit.")).toBeInTheDocument();
    expect(section.getByRole("radio", { name: /Oude terminal.*niet actief/ })).toBeDisabled();
    expect(section.getByRole("button", { name: "Opslaan" })).toBeDisabled();
    await user().click(section.getByRole("radio", { name: /Testterminal/ }));
    await user().click(section.getByRole("button", { name: "Opslaan" }));
    expect(await section.findByText("Betaalterminal opgeslagen.")).toBeInTheDocument();
    expect(calls("POST").at(-1)).toMatchObject({ url: "/api/admin/pin/terminal", body: { terminalId: "term_test" } });
    expect(await section.findByText("Gekozen")).toBeInTheDocument();
  });
  it.each([
    ["no_key", "De sleutel van Mollie is nog niet ingesteld. In het handboek staat hoe de penningmeester dat doet."],
    ["unauthorized", "Mollie accepteert de sleutel niet. Controleer de sleutel."],
    ["unreachable", "Mollie is niet bereikbaar. Probeer het opnieuw."],
  ])("explains %s", …)
  it("says what to do when Mollie lists no terminal", …)
  it("says real payments with a live key", …)   // mode "live" → "Echte betalingen."
  it("explains a terminal that is gone from Mollie's list", …)   // POST → [409, { error: "unknown_terminal" }] → the message, and GET /api/admin/pin asked again
  ```
  `src/beheer/SalesPage.test.tsx`:
  ```ts
  it("marks a receipt that may have been paid twice", …)   // two sales with possiblyDouble true → two badges "Mogelijk dubbel betaald"; a sale with false → none
  it("shows pin attempts that did not go through apart from the sales, without a way to reverse them", async () => {
    mockApi({ "/api/admin/sales": { sales: [], pinAttempts: [
      { id: "a", soldAtLocal: "14:32", totalCents: 360, outcome: null, reason: null, lines: [{ name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 }] },
      { id: "b", soldAtLocal: "14:40", totalCents: 110, outcome: "declined", reason: "insufficient_funds", lines: [] },
      { id: "c", soldAtLocal: "14:41", totalCents: 110, outcome: "canceled", reason: null, lines: [] },
    ] } });
    renderAt("/beheer/verkopen?datum=2026-07-30");
    const region = within(await screen.findByRole("region", { name: "Pin: niet gelukt of nog open" }));
    expect(region.getByText("Wacht op bevestiging")).toBeInTheDocument();
    expect(region.getByText("Geweigerd")).toBeInTheDocument();
    expect(region.getByText("Geannuleerd")).toBeInTheDocument();
    expect(region.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Geen verkopen op deze dag.")).not.toBeInTheDocument();
  });
  it("says a pin sale is reversed for the whole amount, after refunding at Mollie", …)
    // a pin sale → "Terugdraaien" → the dialog holds "Betaal het bedrag eerst terug in het Mollie-dashboard. De kassa doet dat niet." and "Terugdraaien kan alleen voor het hele bedrag."
  it("explains that a failed pin payment cannot be reversed", …)   // POST → [409, { error: "not_paid" }]
  ```
  Dashboard: `it("points at pin payments that need a look")`: `pinAttention: [{ kind: "pending", date: "2026-07-30", totalCents: 360 }, { kind: "double", date: "2026-07-29", totalCents: 110 }]` → region or card `Pin: let op` with the links `Pinbetaling van € 3,60 wacht op bevestiging (30-07-2026)` (href `/beheer/verkopen?datum=2026-07-30`) and `Mogelijk dubbel betaald: € 1,10 (29-07-2026)`; with `[]` no such card.

- [ ] **Step 2: Run them.** `npm run test:client -- src/beheer`. Expected: FAIL.

- [ ] **Step 3: Implement** the three pages.

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: beheer chooses the terminal, lists pin attempts and points at what needs a look"`

---

### Task 10: End to end against a fake Mollie, and the handbook

**Files:**
- Create: `e2e/global-setup.ts`, `e2e/pin.spec.ts`, `.dev.vars.e2e`
- Modify: `playwright.config.ts`, `e2e/setup.ts`, `.gitignore`, `README.md`, `docs/superpowers/specs/2026-11-20-kassa-design.md` (§14 and §15 only)

**Interfaces:**
- Consumes: `createFakeMollie` (Task 1); everything built so far.
- Produces `.dev.vars.e2e` (committed; made-up values only, so the end-to-end run never touches the penningmeester's own `.dev.vars` or the real Mollie):
  ```
  SETUP_TOKEN=dev-setup-token
  MOLLIE_API_KEY=test_e2e
  MOLLIE_API_BASE=http://localhost:4174/v2
  ```
  `.gitignore` gains `!.dev.vars.e2e`. Wrangler prefers `.dev.vars.<name>` over `.dev.vars` when `CLOUDFLARE_ENV=<name>` is set, and the build copies the values into `dist/` for `vite preview`.
- Produces in `playwright.config.ts`: `globalSetup: "./e2e/global-setup.ts"`; the build and preview commands of `webServer` run with `CLOUDFLARE_ENV=e2e` in front of `KASSA_STATE=…`.
- Produces `e2e/global-setup.ts`: starts a `node:http` server on port 4174 that hands every request to `createFakeMollie({ key: "test_e2e", origin: "http://localhost:4174" }).handle`, and returns a function that closes it.
- Produces in `e2e/setup.ts`:
  ```ts
  export const MOLLIE = "http://localhost:4174";
  /** Empties the fake Mollie and chooses its test terminal in beheer. */
  export async function usePin(request: APIRequestContext, beheer: Beheer): Promise<void>;
  /** Ends the payment that is waiting on the terminal. */
  export async function atTerminal(request: APIRequestContext, status: "paid" | "failed" | "canceled" | "expired", reason?: string): Promise<void>;
  ```
  and `expectToday` accepts `pinCents` next to `cashCents`.

- [ ] **Step 1: Write the end-to-end tests** in `e2e/pin.spec.ts` (each starts with `prepare`, `usePin`, `pair`; `pinDialog = (page, name) => page.getByRole("dialog", { name })`):

  ```ts
  test("test mode: the TEST bar shows, and a payment approved on Mollie's test page is paid on the iPad and in beheer", async ({ page, request }) => {
    …await expect(page.getByText("TEST", { exact: true })).toBeVisible();
    await tile(page, /Aardbeitje/).click(); await tile(page, /Koffie/).click(); await tap(page, "Pin");
    await expect(pinDialog(page, "Pin, te betalen").getByText("Houd pas of telefoon tegen de betaalterminal")).toBeVisible();
    await expect(receipt(page).getByText("Koffie")).toBeVisible();               // the receipt stays until Mollie approves
    const [testPage] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Test: kies de uitkomst bij Mollie" }).click()]);
    await testPage.getByRole("button", { name: "Betaald" }).click();
    await expect(page.getByText("Pin betaald")).toBeVisible();
    await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
    await expectToday(beheer, { pinCents: 250, cashCents: 0, saleCount: 1 });
    expect((await beheer.get<{ expectedCents: number }>("/api/admin/cash")).expectedCents).toBe(0);
    await tap(page, "Omzet");                                                    // the beheerder's own revenue screen shows it as pin
    await expect(page.getByRole("dialog", { name: "Omzet" }).getByText(/pin €\s2,50/)).toBeVisible();
  });
  test("a declined payment: three choices, nothing in the overview, and trying again pays", …)
    // atTerminal "failed", "insufficient_funds" → dialog "Betaling geweigerd" with "Onvoldoende saldo."; expectToday all zero;
    // "Opnieuw proberen" → atTerminal "paid" → "Pin betaald"; expectToday { pinCents: 140, saleCount: 1 }; beheer's day lists one attempt with outcome "declined"
  test("a payment cancelled on the iPad: back to the receipt, nothing in the overview", …)
    // "Annuleren" → dialog "Betaling geannuleerd" → "Terug naar de bon" → the receipt still shows Koffie; expectToday zero; the attempt is listed as "canceled"
  test("a payment cancelled on the terminal, and one that expired", …)   // atTerminal "canceled" → "Betaling geannuleerd"; "Opnieuw proberen"; atTerminal "expired" → "Betaling verlopen"
  test("cancelling that Mollie refuses keeps waiting, and the payment that follows is booked", …)
    // POST ${MOLLIE}/control/cancelable { value: false }; "Annuleren" → "Annuleren lukte niet. Kijk op de betaalterminal."; atTerminal "paid" → "Pin betaald"; pinCents 140
  test("cash after a declined payment books cash only", …)   // "Toch contant" → "Gepast" → { cashCents: 140, pinCents: 0, saleCount: 1 }
  test("a double tap on Toch contant does not press anything in the cash dialog (Review Focus 4)", …)
    // declined → dblclick "Toch contant" → the dialog "Contant, te betalen" is visible with "Wat geeft de klant?"; expectToday zero
  test("a double tap on Pin and on Opnieuw proberen starts one payment each (Review Focus 4)", …)
    // dblclick Pin → the fake has one payment; declined; dblclick "Opnieuw proberen" → two payments in all, the second still open (not cancelled by the second tap)
  test("the connection drops while paying: the receipt is parked, the kassa goes on, and the outcome arrives when the connection is back", async ({ page, context, request }) => {
    …await tile(page, /Koffie/).click(); await tap(page, "Pin");
    await expect(page.getByText("Houd pas of telefoon tegen de betaalterminal")).toBeVisible();
    await context.setOffline(true);
    await expect(pinDialog(page, "Uitkomst onbekend")).toBeVisible({ timeout: 20_000 });
    await tap(page, "Volgende klant");
    await expect(page.getByRole("button", { name: "1 pinbetaling wacht op bevestiging" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeDisabled();
    await expect(page.getByText("Geen internet: pin kan nu niet. Contant werkt door.")).toBeVisible();
    await tile(page, /Thee/).click(); await tap(page, "Contant"); await tap(page, "Gepast");      // the next customer
    await atTerminal(request, "paid");                                                           // meanwhile the customer did pay
    await context.setOffline(false);
    await expect(page.getByText(/wacht op bevestiging/)).toBeHidden({ timeout: 40_000 });
    await expectToday(beheer, { pinCents: 140, saleCount: 2 }, 40_000);
  });
  test("a parked payment that failed is reported with its amount", …)
    // as above, but atTerminal "failed" → after the connection is back the footer shows the button "Pinbetaling van € 1,40 niet gelukt" and no dialog has opened;
    // a product can be tapped meanwhile; the button → dialog "Pinbetalingen" → "Gezien" → the button is gone; nothing in the overview
  test("cash for a parked receipt and a pin payment that went through after all: both are marked in beheer", …)
    // parked → the waiting button → dialog "Pinbetalingen" → "Toch contant" → "Gepast" → atTerminal "paid" → back online → beheer's day: two sales, both possiblyDouble true; summary.pinAttention has kind "double"
  test("a kassa that is reloaded while paying finds its receipt parked (Review Focus 3)", …)
    // Pin → waiting → page.reload() → the chip "1 pinbetaling wacht op bevestiging"; atTerminal "paid" → the chip goes; pinCents 140
  test("the penningmeester chooses the terminal in beheer, and only then Pin works", async ({ page, context, request }) => {
    // Without usePin: clear the choice first (POST /api/admin/pin/terminal { terminalId: null }), pair, tap a product → Pin is off, "Pin is nog niet ingesteld."
    // Log in in the browser at /beheer/login with the e2e password, open Instellingen, choose "Testterminal", Opslaan → "Betaalterminal opgeslagen."
    // Back on the kassa (page.goto("/")) Pin becomes enabled within 40 s.
  });
  test("the pin dialog fits the iPad without scrolling, in every state", …)   // waiting, failed and unknown: every button in the viewport, each at least 44 px high
  ```
  `e2e/setup.ts` exports the e2e password for the browser login. Add to the existing fits-on-the-iPad test in `e2e/kassa.spec.ts`: the line under the pay buttons (`pin-blocked`) and the TEST bar are inside the viewport and nothing scrolls with both showing; and with one parked and one failed receipt the footer still shows `Omzet` in the viewport and nothing scrolls.

- [ ] **Step 2: Run them.** `npm run e2e`. Expected: the new tests run against the fake and PASS together with the fase 1 tests. Check once that the built `dist/**/.dev.vars` holds `test_e2e` and not a real key: `grep -rl "MOLLIE_API_KEY" dist | xargs grep -c "test_e2e"`. A failing test here is a bug in Tasks 1 to 9: fix it there, with a unit test that pins it.

- [ ] **Step 3: Update the handbook** (`README.md`, Dutch, same voice as the fase 1 text). Replace the fase 1 sentence about the grey Pin button, and add:
  - **Dagelijks gebruik → Pin.** Tik op Pin; de klant houdt pas of telefoon tegen de terminal; de bon blijft staan tot de betaling is goedgekeurd. Wat er kan gebeuren: betaald; geweigerd, geannuleerd of verlopen met de drie keuzes; `Annuleren`; uitkomst onbekend en de knop `… wacht op bevestiging`, met wanneer `Toch contant` verstandig is (alleen als de terminal de betaling niet heeft goedgekeurd); de rode knop `Pinbetaling van € … niet gelukt` onderin en wat `Gezien` doet. Ook: pin staat in het scherm `Omzet` naast contant.
  - **De balk TEST** en wat hij betekent.
  - **Voor de penningmeester → Pin.** Instellingen → Pin via Mollie; pin in Overzicht, Rapporten en Verkopen; pin telt nooit mee in het kluisje; de kolom Pin naast de uitbetalingen van Mollie; een pinverkoop terugbetalen (eerst in het Mollie-dashboard, altijd het hele bedrag, daarna Terugdraaien met een reden); `Mogelijk dubbel betaald` en wat je dan doet; `Pin: niet gelukt of nog open`.
  - **Pin instellen (eenmalig, de penningmeester zelf)**, genummerd: (1) Mollie-dashboard: betaalmethode Point of sale aanzetten; (2) testsleutel kopiëren uit Mollie (Developers → API-sleutels; begint met `test_`); (3) in de terminal `npx wrangler secret put MOLLIE_API_KEY --name kassa-burcht-ter-cleeff` en de sleutel plakken bij de vraag; nooit in een bericht, een mail of de code; (4) beheer → Instellingen → de testterminal kiezen; (5) proefbetalingen doen met de link `Test: kies de uitkomst bij Mollie`.
  - **Van test naar echt (de penningmeester zelf):** de Mollie Tap-app op de iPhone; de live-sleutel met dezelfde opdracht; de terminal opnieuw kiezen (een testterminal geldt niet voor echte betalingen); controleren dat de balk TEST weg is; één echte betaling van € 0,60 (Entreegeld); nakijken in de kassa en in het Mollie-dashboard; terugbetalen in Mollie en terugdraaien in beheer als proef van die route. Terug naar test: de testsleutel opnieuw zetten.
  - **Als er iets misgaat:** Pin is grijs (de drie redenen); `Pin starten lukt niet`; de terminal reageert niet; `De betaalterminal is nog bezig met een andere betaling`; een klant zegt betaald te hebben maar de kassa zegt van niet (kijk in het Mollie-dashboard; de kassa boekt alleen wat Mollie bevestigt).
  - **Voor de bouwer:** `MOLLIE_API_KEY` in `.dev.vars`; lokaal is er geen webhook (Mollie bereikt `localhost` niet) en haalt de kassa de uitkomst zelf op; `npm run e2e` gebruikt `.dev.vars.e2e` en een nagebootste Mollie op poort 4174; de migratie `0004_pin.sql`.

- [ ] **Step 4: Record in the spec** what fase 2 decided, in the spec's own Dutch. §14: een nieuwe poging is een nieuwe verkoop en mislukte pogingen blijven bewaard en zichtbaar; de voorraad gaat omlaag op het moment dat de betaling is goedgekeurd; de kassa wacht 10 seconden zonder antwoord en hoogstens 2 minuten in totaal voordat een bon wordt geparkeerd; elke gekoppelde kassa mag de uitkomst van een pinbetaling opvragen; een terminal gekozen met de testsleutel geldt niet voor de live-sleutel. §15: per open vraag wat Mollie's documentatie op 21 november 2026 zegt (see the top of this plan) and what is still to be answered by testing.

- [ ] **Step 5: Run everything.** `npm test && npm run typecheck && npm run e2e`. Expected: all PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "test: pin end to end against a fake Mollie; docs: pin in the handbook"`

---

### Task 11: The run against Mollie's real test mode

This task needs the penningmeester: only he can turn on Point of sale in the Mollie dashboard and put the test key in place. Nothing here is deployed.

**Files:**
- Modify: whatever the run shows to be wrong (with a test that pins it first), `docs/superpowers/specs/2026-11-20-kassa-design.md` §15, `README.md`

- [ ] **Step 1: Ask the penningmeester, in Dutch, for his two steps.** (1) In the Mollie dashboard: turn on the payment method Point of sale. (2) Open the file `.dev.vars` in this worktree (create it as a copy of `.dev.vars.example` first, with the line `MOLLIE_API_KEY=` empty) and type the test key after `MOLLIE_API_KEY=`; save. He does not paste the key in chat. Wait for his word that it is done.

- [ ] **Step 2: Check the key is a test key without showing it.** `grep -c '^MOLLIE_API_KEY=test_' .dev.vars`. Expected: `1`. With `0`: stop and tell him the key is missing or is not a test key; do not go on with a live key.

- [ ] **Step 3: Start the kassa locally** (`npm run db:migrate:local`, then the dev server from `.claude/launch.json`), set up beheer with the local setup code, pair a browser as the kassa.

- [ ] **Step 4: Walk the run and write down what Mollie really does.** In beheer → Instellingen: the test terminal is listed; choose it. On the kassa: the TEST bar shows. Then, each with Entreegeld (€ 0,60), using Mollie's own test page behind `Test: kies de uitkomst bij Mollie`:
  - a paid payment → `Pin betaald`; beheer: today pin € 0,60, kluisje unchanged;
  - a failed (declined) payment → `Betaling geweigerd`, three choices; nothing added in beheer; the attempt listed as `Geweigerd`;
  - a cancelled payment, once from Mollie's test page and once with `Annuleren` on the kassa → `Betaling geannuleerd`; nothing added;
  - a payment left alone → what happens, and after how long;
  - reverse the paid sale in beheer → pin back to € 0,00.

  For each open question at the top of this plan (1 to 4), note the answer: can a waiting payment be cancelled through the API; which status and `statusReason` each ending gives; is a `localhost` `redirectUrl` accepted; what the test terminal is called and which endings the test page offers. Also confirm in the dev server's log that a repeated start with the same `Idempotency-Key` returned the same payment (send the same start twice with `curl` against the local kassa, using the paired kassa's token).

- [ ] **Step 5: Fix what differs.** For every difference between Mollie's real behaviour and the fake: first change `test/fake-mollie.ts` and add or change the test that pins the real behaviour, see it fail, then change the code. Run `npm test && npm run typecheck && npm run e2e`. Expected: all PASS.

- [ ] **Step 6: Record the answers** in spec §15 and, where the beheerder or penningmeester notices them, in `README.md`. Commit: `git add -A && git commit -m "fix: what the run against Mollie's test mode showed; docs: the answers to the open pin questions"`

- [ ] **Step 7: Report to the penningmeester in Dutch:** what was tried, what each payment led to on the kassa and in beheer, what is still open (the questions only the iPhone can answer), and what going live in test mode takes (Task 12). Use superpowers:verification-before-completion before claiming anything works.

---

### Task 12: Onto the live address in test mode, then the real € 0,60 (each step needs the penningmeester's yes, or is his own)

Nothing in this task happens without his explicit yes for that step.

- [ ] **Step 1: Bring in what changed meanwhile.** `git merge fase-1` (or `main`, once it holds fase 1) into this branch; `npm install && npm test && npm run typecheck && npm run e2e`. Expected: all PASS. Tell him what came in.

- [ ] **Step 2 (his own): the test key as a Worker secret.** He runs `npx wrangler secret put MOLLIE_API_KEY --name kassa-burcht-ter-cleeff` and pastes the test key at the prompt.

- [ ] **Step 3 (after his yes): the database and the Worker.** `npx wrangler d1 migrations apply kassa --remote`, then `npm run deploy`. The migration only adds columns and indexes; fase 1 data stays. Check `https://…workers.dev/api/health` and that the kassa on the iPad shows the TEST bar after it has fetched the new version.

- [ ] **Step 4: The webhook, which only the live address can show.** With the penningmeester: start a pin payment on the iPad, close the kassa app while it waits, choose `paid` on Mollie's test page, and see in beheer that the sale is there. Then open the kassa: the parked receipt disappears by itself.

- [ ] **Step 5 (his own, later): the real payment.** As the handbook's "Van test naar echt" describes: the Mollie Tap app on his iPhone, the live key with the same `wrangler secret put`, choose the terminal again, the TEST bar is gone, one payment of € 0,60, check the kassa and the Mollie dashboard. Note the answers to the last open questions of spec §15 (where the iPhone's terminal id comes from, whether the app must be open, which cards it takes, whether Mollie had to approve Point of sale).

- [ ] **Step 6: Close the branch** with superpowers:finishing-a-development-branch: he decides whether this branch is merged into `fase-1` or `main`.
