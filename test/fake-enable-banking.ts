// An Enable Banking that lives in memory: the part of its API the boekhouding uses, answering the way the
// reference describes (read 23 November 2026). The Worker tests reach it through a stubbed `fetch`.
// It checks every request's JWT against the public half of the test key. No Vitest or Node imports.

type Failure = number | "timeout";

export type FakeTransaction = Record<string, unknown>;

export type FakeEnableBanking = {
  handle(request: Request): Promise<Response>;
  /** Every API request so far, with the JWT's decoded parts (never the token itself). */
  requests: { method: string; path: string; query: Record<string, string>; body: any; jwt: { header: any; claims: any } | null }[];
  /** What GET /aspsps answers with, as ASPSP records. */
  aspsps: { name: string; country: string; psu_types: string[]; maximum_consent_validity: number }[];
  /** What /accounts/:uid/transactions pages through (2 per page). Includes one pending line. */
  transactions: FakeTransaction[];
  balances: Record<string, unknown>[];
  /** From now on every call answers with this status (401) and `error` (EXPIRED_SESSION). */
  expireSession(status?: number, error?: string): void;
  /** The next `times` API requests get this: an HTTP status with an `error` code, or "timeout" (the call rejects). */
  failNext(what: Failure, error?: string, times?: number): void;
  reset(): void;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, error: string, message: string) => json({ message, code: status, error, detail: null }, status);

function fromBase64Url(part: string): Uint8Array {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));

const tx = (n: number, over: FakeTransaction): FakeTransaction => ({
  entry_reference: `ref-${n}`,
  transaction_id: null,
  status: "BOOK",
  booking_date: "2027-03-0" + n,
  value_date: "2027-03-0" + n,
  currency: "EUR",
  ...over,
});

function freshTransactions(): FakeTransaction[] {
  return [
    tx(1, {
      transaction_amount: { currency: "EUR", amount: "12.50" },
      credit_debit_indicator: "CRDT",
      debtor: { name: "Jansen" },
      debtor_account: { iban: "nl91 abna 0417 1643 00" },
      creditor: { name: "Speeltuin" },
      creditor_account: { iban: "NL02INGB0000000001" },
      remittance_information: ["Contributie", "  maart "],
    }),
    tx(2, {
      transaction_amount: { currency: "EUR", amount: "100.05" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Bakker BV" },
      creditor_account: { iban: "NL86INGB0002445588" },
      debtor: { name: "Speeltuin" },
      debtor_account: { iban: "NL02INGB0000000001" },
      remittance_information: ["Factuur 12"],
    }),
    // Pending: must be ignored by the client.
    tx(3, {
      status: "PDNG",
      transaction_amount: { currency: "EUR", amount: "9.99" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "Nog onzeker" },
      remittance_information: ["wacht"],
    }),
    // No entry_reference: the transaction_id is the reference.
    tx(4, {
      entry_reference: null,
      transaction_id: "tid-4",
      transaction_amount: { currency: "EUR", amount: "0.5" },
      credit_debit_indicator: "CRDT",
      remittance_information: [],
    }),
    tx(5, {
      transaction_amount: { currency: "EUR", amount: "20" },
      credit_debit_indicator: "DBIT",
      remittance_information: ["Kantoor"],
    }),
    tx(6, {
      transaction_amount: { currency: "EUR", amount: "7.00" },
      credit_debit_indicator: "CRDT",
      debtor: { name: "Pietersen" },
    }),
  ];
}

const freshAspsps = () => [
  { name: "ABN AMRO", country: "NL", psu_types: ["personal", "business"], maximum_consent_validity: 7776000 },
  { name: "ING", country: "NL", psu_types: ["personal", "business"], maximum_consent_validity: 15552000 + 3600 },
];

const freshBalances = () => [
  { name: "Boekhoudkundig", balance_amount: { currency: "EUR", amount: "1234.56" }, balance_type: "ITBD", last_change_date_time: "2027-03-05T10:00:00Z", reference_date: null },
  { name: "Eindsaldo", balance_amount: { currency: "EUR", amount: "1000.00" }, balance_type: "CLBD", last_change_date_time: "2027-03-04T23:00:00Z", reference_date: "2027-03-04" },
];

/** `appId` is the application id the JWT's kid must carry; `publicKey` the public half of the test key. */
export function createFakeEnableBanking(opts: { appId: string; publicKey: CryptoKey; origin: string }): FakeEnableBanking {
  let failures: { what: Failure; error: string }[] = [];
  let expired: { status: number; error: string } | null = null;

  const fake: FakeEnableBanking = {
    requests: [],
    aspsps: freshAspsps(),
    transactions: freshTransactions(),
    balances: freshBalances(),
    expireSession(status = 401, error = "EXPIRED_SESSION") {
      expired = { status, error };
    },
    failNext(what, error = "ERROR", times = 1) {
      for (let i = 0; i < times; i++) failures.push({ what, error });
    },
    reset() {
      fake.requests = [];
      fake.aspsps = freshAspsps();
      fake.transactions = freshTransactions();
      fake.balances = freshBalances();
      failures = [];
      expired = null;
    },
    async handle(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const body = method === "POST" ? await request.json().catch(() => null) : null;
      const jwt = await checkJwt(request.headers.get("Authorization"));
      fake.requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, jwt: jwt === "bad" ? null : jwt });

      const failure = failures.shift();
      if (failure?.what === "timeout") throw new Error("fake enable banking: no answer");
      if (failure) return problem(failure.what as number, failure.error, `fake enable banking: answered ${failure.what}`);
      if (jwt === "bad") return problem(401, "UNAUTHORIZED", "Invalid or missing token");
      if (expired) return problem(expired.status, expired.error, "The session is gone");
      return route(method, url, body);
    },
  };

  async function checkJwt(authorization: string | null): Promise<{ header: any; claims: any } | "bad"> {
    try {
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const [h, c, s] = token.split(".");
      if (!h || !c || !s) return "bad";
      const header = decodeJson(h);
      const claims = decodeJson(c);
      const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, opts.publicKey, fromBase64Url(s), new TextEncoder().encode(`${h}.${c}`));
      const nowSeconds = Date.now() / 1000;
      const good =
        valid &&
        header.alg === "RS256" &&
        header.typ === "JWT" &&
        header.kid === opts.appId &&
        claims.iss === "enablebanking.com" &&
        claims.aud === "api.enablebanking.com" &&
        Number.isInteger(claims.iat) &&
        Number.isInteger(claims.exp) &&
        claims.exp > nowSeconds - 5 &&
        claims.exp - claims.iat <= 86400;
      return good ? { header, claims } : "bad";
    } catch {
      return "bad";
    }
  }

  function route(method: string, url: URL, body: any): Response {
    const path = url.pathname;
    if (method === "GET" && path === "/aspsps") {
      const country = url.searchParams.get("country");
      return json({ aspsps: fake.aspsps.filter((a) => !country || a.country === country) });
    }
    if (method === "POST" && path === "/auth") {
      const validUntil = body?.access?.valid_until;
      const ok =
        typeof validUntil === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(validUntil) &&
        body?.aspsp?.name === "ING" &&
        body?.aspsp?.country === "NL" &&
        body?.psu_type === "business" &&
        typeof body?.state === "string" &&
        typeof body?.redirect_url === "string";
      if (!ok) return problem(422, "VALIDATION_ERROR", "The request body is not valid");
      return json({ url: `https://fake.enablebanking.test/auth?state=${encodeURIComponent(body.state)}`, authorization_id: "auth-1", psu_id_hash: "hash" });
    }
    if (method === "POST" && path === "/sessions") {
      if (typeof body?.code !== "string" || body.code === "") return problem(422, "VALIDATION_ERROR", "code is missing");
      if (body.code === "bad-code") return problem(422, "AUTHORIZATION_ERROR", "The code is not valid");
      return json({
        session_id: "session-1",
        accounts: [
          { uid: "acc-1", account_id: { iban: "NL02INGB0000000001" } },
          { uid: "acc-2", account_id: null },
        ],
        aspsp: { name: "ING", country: "NL" },
        psu_type: "business",
        access: { valid_until: "2027-06-01T12:00:00+00:00" },
      });
    }
    const account = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(path);
    if (method === "GET" && account) {
      if (!["acc-1", "acc-2"].includes(account[1]!)) return problem(404, "NOT_FOUND", "No such account");
      if (account[2] === "balances") return json({ balances: fake.balances });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date_from") ?? "")) return problem(422, "VALIDATION_ERROR", "date_from is missing");
      const offset = Number(url.searchParams.get("continuation_key") ?? "0");
      const page = fake.transactions.slice(offset, offset + 2);
      const next = offset + 2 < fake.transactions.length ? String(offset + 2) : null;
      return json({ transactions: page, continuation_key: next });
    }
    return problem(404, "NOT_FOUND", "The fake Enable Banking does not know this route");
  }

  return fake;
}
