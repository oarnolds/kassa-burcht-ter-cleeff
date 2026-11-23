// A Mollie that lives in memory: the part of its API the kassa uses, answering the way the documentation
// describes (read 21 November 2026). The Worker tests reach it through a stubbed `fetch`, the end-to-end
// tests through a small HTTP server. No Vitest or Node imports: it runs in both.

import type { PinTerminal } from "../shared/types";

export type FakePayment = {
  id: string;
  status: string;
  reason: string | null;
  terminalId: string;
  amount: string;
  description: string;
  metadata: unknown;
  idempotencyKey: string | null;
  mode: "test" | "live";
};

/** "garbled": a 200 that cannot be read. "pass": this request is answered normally (to fail a later one). */
type Failure = number | "timeout" | "lost" | "garbled" | "pass";

/** The organisation token the fake accepts for the read-only routes (never the kassa's key, and vice versa). */
export const FAKE_ORG_TOKEN = "org_fake";

type Amount = { currency: string; value: string };
const eur = (value: string): Amount => ({ currency: "EUR", value });

export type FakeOrgPayment = { id: string; method: string; amount: string; description: string; status: string; createdAt: string; paidAt: string | null; settlementId: string | null };
export type FakeRefund = { id: string; paymentId: string; amount: string; description: string | null; createdAt: string };
export type FakeChargeback = { id: string; paymentId: string; amount: string; createdAt: string };
export type FakeSettlement = {
  id: string;
  reference: string | null;
  status: string;
  settledAt: string | null;
  amount: string;
  /** Gross cost values per year and month, e.g. { "2027": { "01": ["1.88"] } }. */
  costs: Record<string, Record<string, string[]>>;
};

export type FakeMollie = {
  /** Answers a request the way Mollie's API does, plus the test page and the control routes below. */
  handle(request: Request): Promise<Response>;
  payments: FakePayment[];
  /** Every API request so far (not the control routes). */
  requests: { method: string; path: string; query: Record<string, string>; idempotencyKey: string | null; authorization: string | null; body: any }[];
  terminals: PinTerminal[];
  /** Whether DELETE cancels an open payment (true) or answers 422 (false). Starts true. */
  cancelable: boolean;

  // ---- the organisation's read-only routes (Bearer org_fake) ----
  /** The one profile `GET /v2/profiles` lists; null for an organisation without one. */
  profileId: string | null;
  /** Items per page, whatever `limit` asks; null follows `limit`. Pages link on with `_links.next`. */
  pageSize: number | null;
  /** The origin `_links.next.href` names; null is the fake's own. A foreign one proves the client never follows it. */
  nextOrigin: string | null;
  /** Whether the next link drops `profileId` from its query, as the real one may. */
  dropProfileOnNext: boolean;
  /** Whether the settlements list carries `periods` (else only `GET /v2/settlements/{id}` does). */
  periodsInList: boolean;
  /** Payments of any method, as `GET /v2/payments` lists them (newest first by `createdAt`). */
  orgPayments: FakeOrgPayment[];
  refunds: FakeRefund[];
  chargebacks: FakeChargeback[];
  /** Served in the order they were added: Mollie documents no order for settlements. */
  settlements: FakeSettlement[];
  balance: { available: string; pending: string };
  addPayment(input: Partial<FakeOrgPayment> & { method: string; amount: string; createdAt: string }): FakeOrgPayment;
  addRefund(input: Partial<FakeRefund> & { paymentId: string; amount: string; createdAt: string }): FakeRefund;
  addChargeback(input: Partial<FakeChargeback> & { paymentId: string; amount: string; createdAt: string }): FakeChargeback;
  addSettlement(input: Partial<FakeSettlement> & { amount: string }): FakeSettlement;
  /** Ends a payment the way the terminal does. */
  finish(id: string, status: "paid" | "failed" | "canceled" | "expired", reason?: string): void;
  /**
   * The next `times` API requests get this instead of their answer: an HTTP status, "timeout" (nothing
   * happens, the call rejects), or "lost" (the request is carried out, then the call rejects).
   */
  failNext(what: Failure, times?: number): void;
  reset(): void;
};

const ORG_PATHS = ["/v2/profiles", "/v2/payments", "/v2/refunds", "/v2/chargebacks", "/v2/settlements", "/v2/balances/primary"];
const TEST_TERMINAL: PinTerminal = { id: "term_test", description: "Testterminal", status: "active", brand: "Tap", model: "Tap", serialNumber: null };
const ENDINGS = { paid: "Betaald", failed: "Geweigerd", canceled: "Geannuleerd", expired: "Verlopen" } as const;
type Ending = keyof typeof ENDINGS;
const isEnding = (value: unknown): value is Ending => typeof value === "string" && value in ENDINGS;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/hal+json", ...headers } });
const html = (body: string, status = 200) =>
  new Response(`<!doctype html><html lang="nl"><meta charset="utf-8"><title>Mollie (nagebootst)</title><body>${body}</body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
const problem = (status: number, title: string, detail: string, field?: string) =>
  json({ status, title, detail, ...(field ? { field } : {}), _links: { documentation: { href: "https://docs.mollie.com/", type: "text/html" } } }, status);

/**
 * `key` is the API key the fake accepts, or "*" for any. Either way a key that starts with `live_` gets
 * live answers (no test link), any other key test answers.
 */
export function createFakeMollie(opts: { key: string; origin: string }): FakeMollie {
  let failures: Failure[] = [];
  let made = 0;
  let orgMade = 0;

  const fake: FakeMollie = {
    profileId: "pfl_fake",
    pageSize: null,
    nextOrigin: null,
    dropProfileOnNext: false,
    periodsInList: true,
    orgPayments: [],
    refunds: [],
    chargebacks: [],
    settlements: [],
    balance: { available: "0.00", pending: "0.00" },
    addPayment(input) {
      const payment: FakeOrgPayment = {
        id: `tr_org${++orgMade}`,
        description: "Test",
        status: "paid",
        paidAt: null,
        settlementId: null,
        ...input,
      };
      fake.orgPayments.push(payment);
      return payment;
    },
    addRefund(input) {
      const refund: FakeRefund = { id: `re_org${++orgMade}`, description: null, ...input };
      fake.refunds.push(refund);
      return refund;
    },
    addChargeback(input) {
      const chargeback: FakeChargeback = { id: `chb_org${++orgMade}`, ...input };
      fake.chargebacks.push(chargeback);
      return chargeback;
    },
    addSettlement(input) {
      const settlement: FakeSettlement = { id: `stl_org${++orgMade}`, reference: null, status: "paidout", settledAt: null, costs: {}, ...input };
      fake.settlements.push(settlement);
      return settlement;
    },
    payments: [],
    requests: [],
    terminals: [{ ...TEST_TERMINAL }],
    cancelable: true,
    finish(id, status, reason) {
      const payment = fake.payments.find((candidate) => candidate.id === id);
      if (!payment) throw new Error(`fake mollie: no payment ${id}`);
      payment.status = status;
      payment.reason = reason ?? null;
    },
    failNext(what, times = 1) {
      for (let i = 0; i < times; i++) failures.push(what);
    },
    reset() {
      fake.payments = [];
      fake.requests = [];
      fake.terminals = [{ ...TEST_TERMINAL }];
      fake.cancelable = true;
      failures = [];
      made = 0;
      orgMade = 0;
      fake.profileId = "pfl_fake";
      fake.pageSize = null;
      fake.nextOrigin = null;
      fake.dropProfileOnNext = false;
      fake.periodsInList = true;
      fake.orgPayments = [];
      fake.refunds = [];
      fake.chargebacks = [];
      fake.settlements = [];
      fake.balance = { available: "0.00", pending: "0.00" };
    },
    async handle(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith("/control/")) return control(request, path);
      if (path.startsWith("/test/")) return testPage(request, path);
      return api(request, path);
    },
  };

  const view = (payment: FakePayment) => ({
    resource: "payment",
    id: payment.id,
    mode: payment.mode,
    status: payment.status,
    method: "pointofsale",
    amount: { value: payment.amount, currency: "EUR" },
    description: payment.description,
    metadata: payment.metadata,
    details: { terminalId: payment.terminalId },
    isCancelable: payment.status === "open" && fake.cancelable,
    ...(payment.reason ? { statusReason: { code: payment.reason, message: payment.reason } } : {}),
    _links: {
      self: { href: `${opts.origin}/v2/payments/${payment.id}`, type: "application/hal+json" },
      // Mollie's hosted page to choose how a test payment ends; there is none for a real payment.
      ...(payment.mode === "test" && payment.status === "open"
        ? { changePaymentState: { href: `${opts.origin}/test/${payment.id}`, type: "text/html" } }
        : {}),
    },
  });

  async function api(request: Request, path: string): Promise<Response> {
    const method = request.method.toUpperCase();
    const authorization = request.headers.get("Authorization");
    const idempotencyKey = request.headers.get("Idempotency-Key");
    const body = method === "POST" ? await request.json().catch(() => null) : null;
    fake.requests.push({ method, path, query: Object.fromEntries(new URL(request.url).searchParams), idempotencyKey, authorization, body });

    const failure = failures.shift();
    if (failure === "timeout") throw new Error("fake mollie: no answer");
    // Like a careless server, a failing answer repeats the credential it was sent: the client must not pass that on.
    const echo = authorization ?? "";
    if (typeof failure === "number") return problem(failure, `Error for ${echo}`, `fake mollie: answered ${failure} to ${echo}`);
    if (failure === "garbled") return json({ title: `Odd answer for ${echo}`, detail: echo, availableAmount: null, _embedded: { payments: "?" } });
    const answer = route(method, path, authorization, idempotencyKey, body, new URL(request.url));
    if (failure === "lost") throw new Error("fake mollie: the answer was lost");
    return answer;
  }

  function route(method: string, path: string, authorization: string | null, idempotencyKey: string | null, body: any, url: URL): Response {
    const key = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (method === "GET" && (ORG_PATHS.includes(path) || /^\/v2\/settlements\/[^/]+$/.test(path))) {
      // These routes belong to the organisation token; the kassa's key gets 401, as it would at Mollie.
      if (key !== FAKE_ORG_TOKEN) return problem(401, "Unauthorized Request", "Missing authentication, or failed to authenticate");
      return orgRoute(path, url);
    }
    const known = opts.key === "*" ? /^(test|live)_\w+$/.test(key) : key === opts.key;
    if (!known) return problem(401, "Unauthorized Request", "Missing authentication, or failed to authenticate");
    const mode = key.startsWith("live_") ? "live" : "test";

    if (method === "GET" && path === "/v2/terminals") {
      const terminals = fake.terminals.map((terminal) => ({ resource: "terminal", ...terminal, currency: "EUR", mode }));
      return json({ count: terminals.length, _embedded: { terminals }, _links: {} });
    }

    if (method === "POST" && path === "/v2/payments") {
      const replayed = idempotencyKey ? fake.payments.find((payment) => payment.idempotencyKey === idempotencyKey) : undefined;
      if (replayed) return json(view(replayed), 201, { "Idempotent-Replayed": "true" });
      if (body?.method !== "pointofsale") return problem(422, "Unprocessable Entity", "The payment method is not supported", "method");
      if (!fake.terminals.some((terminal) => terminal.id === body.terminalId)) {
        return problem(422, "Unprocessable Entity", "The terminal does not exist", "terminalId");
      }
      if (typeof body.amount?.value !== "string" || body.amount.currency !== "EUR" || typeof body.description !== "string") {
        return problem(422, "Unprocessable Entity", "The amount or the description is missing", "amount");
      }
      // A terminal takes one payment at a time.
      const busy = fake.payments.some((payment) => payment.terminalId === body.terminalId && payment.status === "open");
      const payment: FakePayment = {
        id: `tr_fake${++made}`,
        status: busy ? "failed" : "open",
        reason: busy ? "terminal_busy" : null,
        terminalId: body.terminalId,
        amount: body.amount.value,
        description: body.description,
        metadata: body.metadata ?? null,
        idempotencyKey,
        mode,
      };
      fake.payments.push(payment);
      return json(view(payment), 201);
    }

    const id = /^\/v2\/payments\/([^/]+)$/.exec(path)?.[1];
    const payment = id ? fake.payments.find((candidate) => candidate.id === id) : undefined;
    if (id && !payment) return problem(404, "Not Found", "No payment exists with this token");
    if (payment && method === "GET") return json(view(payment));
    if (payment && method === "DELETE") {
      if (payment.status !== "open" || !fake.cancelable) return problem(422, "Unprocessable Entity", "The payment cannot be cancelled");
      payment.status = "canceled";
      return json(view(payment));
    }
    return problem(404, "Not Found", "The fake Mollie does not know this route");
  }

  // A page of `items`: `from` is the id to start at, `limit` or `pageSize` the size, `_links.next` the rest.
  function page(url: URL, items: { id: string }[], key: string, view: (item: any) => unknown): Response {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 250);
    const size = fake.pageSize ?? limit;
    const from = url.searchParams.get("from");
    const start = from ? items.findIndex((item) => item.id === from) : 0;
    if (start < 0) return problem(404, "Not Found", "No such item to start from", "from");
    const slice = items.slice(start, start + size);
    const rest = items[start + size];
    let next: { href: string; type: string } | null = null;
    if (rest) {
      const href = new URL(url);
      href.searchParams.set("from", rest.id);
      href.searchParams.set("limit", String(size));
      if (fake.dropProfileOnNext) href.searchParams.delete("profileId");
      next = { href: `${fake.nextOrigin ?? opts.origin}${href.pathname}${href.search}`, type: "application/hal+json" };
    }
    return json({ count: slice.length, _embedded: { [key]: slice.map(view) }, _links: { self: { href: url.toString(), type: "application/hal+json" }, next } });
  }

  function orgRoute(path: string, url: URL): Response {
    if (path === "/v2/profiles") {
      const profiles = fake.profileId ? [{ resource: "profile", id: fake.profileId, name: "Speeltuin" }] : [];
      return page(url, profiles, "profiles", (profile) => profile);
    }
    if (path === "/v2/balances/primary") {
      return json({ resource: "balance", id: "bal_fake", currency: "EUR", availableAmount: eur(fake.balance.available), pendingAmount: eur(fake.balance.pending) });
    }
    const detail = /^\/v2\/settlements\/([^/]+)$/.exec(path)?.[1];
    if (detail) {
      const found = fake.settlements.find((settlement) => settlement.id === detail);
      return found ? json(settlementView(found, true)) : problem(404, "Not Found", "No settlement exists with this token");
    }
    if (path === "/v2/settlements") {
      return page(url, fake.settlements, "settlements", (settlement: FakeSettlement) => settlementView(settlement, fake.periodsInList));
    }
    return orgListRoute(path, url);
  }

  function settlementView(settlement: FakeSettlement, withPeriods: boolean) {
    return ({
        resource: "settlement",
        id: settlement.id,
        reference: settlement.reference,
        status: settlement.status,
        settledAt: settlement.settledAt,
        amount: eur(settlement.amount),
        ...(withPeriods ? { periods: Object.fromEntries(
          Object.entries(settlement.costs).map(([year, months]) => [
            year,
            Object.fromEntries(
              Object.entries(months).map(([month, values]) => [
                month,
                { revenue: [], costs: values.map((value) => ({ description: "Kosten", method: "ideal", count: 1, rate: { fixed: null, percentage: null }, amountNet: eur(value), amountVat: eur("0.00"), amountGross: eur(value) })) },
              ]),
            ),
          ]),
        ) } : {}),
    });
  }

  function orgListRoute(path: string, url: URL): Response {
    // Payments, refunds and chargebacks: an organisation token must name the profile.
    if (url.searchParams.get("profileId") !== fake.profileId || !fake.profileId) {
      return problem(422, "Unprocessable Entity", "The profileId parameter is required for organization-level credentials", "profileId");
    }
    const newestFirst = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (path === "/v2/payments") {
      return page(url, newestFirst(fake.orgPayments), "payments", (payment: FakeOrgPayment) => ({
        resource: "payment",
        id: payment.id,
        method: payment.method,
        amount: eur(payment.amount),
        description: payment.description,
        status: payment.status,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
        settlementId: payment.settlementId,
      }));
    }
    if (path === "/v2/refunds") {
      return page(url, newestFirst(fake.refunds), "refunds", (refund: FakeRefund) => ({ resource: "refund", id: refund.id, paymentId: refund.paymentId, amount: eur(refund.amount), description: refund.description, createdAt: refund.createdAt, status: "refunded" }));
    }
    return page(url, newestFirst(fake.chargebacks), "chargebacks", (chargeback: FakeChargeback) => ({ resource: "chargeback", id: chargeback.id, paymentId: chargeback.paymentId, amount: eur(chargeback.amount), createdAt: chargeback.createdAt }));
  }

  // The page behind `changePaymentState`: one button per ending, as Mollie's own test page offers.
  async function testPage(request: Request, path: string): Promise<Response> {
    const [, , id, ending] = path.split("/");
    const payment = fake.payments.find((candidate) => candidate.id === id);
    if (!payment) return html("<h1>Onbekende betaling</h1>", 404);
    if (request.method === "POST" && isEnding(ending)) {
      if (payment.status === "open") fake.finish(payment.id, ending);
      return html(`<h1>Uitkomst gekozen</h1><p>${ENDINGS[payment.status as Ending] ?? payment.status}</p>`);
    }
    const buttons = Object.entries(ENDINGS)
      .map(([status, label]) => `<form method="post" action="/test/${payment.id}/${status}"><button type="submit">${label}</button></form>`)
      .join("");
    return html(`<h1>Testbetaling van € ${payment.amount.replace(".", ",")}</h1><p>Kies de uitkomst.</p>${buttons}`);
  }

  // For the end-to-end tests: steer the fake from outside its process.
  async function control(request: Request, path: string): Promise<Response> {
    if (request.method === "GET" && path === "/control/payments") return json({ payments: fake.payments });
    if (request.method !== "POST") return problem(404, "Not Found", "The fake Mollie does not know this route");
    const body = (await request.json().catch(() => null)) as { status?: unknown; reason?: unknown; value?: unknown } | null;
    if (path === "/control/reset") {
      fake.reset();
      return json({ ok: true });
    }
    if (path === "/control/cancelable") {
      fake.cancelable = body?.value !== false;
      return json({ ok: true });
    }
    if (path === "/control/finish" && isEnding(body?.status)) {
      const open = fake.payments.filter((payment) => payment.status === "open").at(-1);
      if (!open) return problem(409, "Conflict", "No payment is waiting on the terminal");
      fake.finish(open.id, body.status, typeof body.reason === "string" ? body.reason : undefined);
      return json({ ok: true, id: open.id });
    }
    return problem(404, "Not Found", "The fake Mollie does not know this route");
  }

  return fake;
}
