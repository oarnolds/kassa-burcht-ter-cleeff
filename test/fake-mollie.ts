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

type Failure = number | "timeout" | "lost";

export type FakeMollie = {
  /** Answers a request the way Mollie's API does, plus the test page and the control routes below. */
  handle(request: Request): Promise<Response>;
  payments: FakePayment[];
  /** Every API request so far (not the control routes). */
  requests: { method: string; path: string; idempotencyKey: string | null; authorization: string | null; body: any }[];
  terminals: PinTerminal[];
  /** Whether DELETE cancels an open payment (true) or answers 422 (false). Starts true. */
  cancelable: boolean;
  /** Ends a payment the way the terminal does. */
  finish(id: string, status: "paid" | "failed" | "canceled" | "expired", reason?: string): void;
  /**
   * The next `times` API requests get this instead of their answer: an HTTP status, "timeout" (nothing
   * happens, the call rejects), or "lost" (the request is carried out, then the call rejects).
   */
  failNext(what: Failure, times?: number): void;
  reset(): void;
};

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

  const fake: FakeMollie = {
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
    fake.requests.push({ method, path, idempotencyKey, authorization, body });

    const failure = failures.shift();
    if (failure === "timeout") throw new Error("fake mollie: no answer");
    if (typeof failure === "number") return problem(failure, "Error", `fake mollie: answered ${failure}`);
    const answer = route(method, path, authorization, idempotencyKey, body);
    if (failure === "lost") throw new Error("fake mollie: the answer was lost");
    return answer;
  }

  function route(method: string, path: string, authorization: string | null, idempotencyKey: string | null, body: any): Response {
    const key = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
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
