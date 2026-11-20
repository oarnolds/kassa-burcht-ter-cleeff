import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { businessDate } from "../shared/time";

// The setup code of local development (.dev.vars) and a password that exists only in the end-to-end database.
const SETUP_TOKEN = "dev-setup-token";
const PASSWORD = "e2e-wachtwoord-123";

const write = { "X-Requested-With": "kassa" };

/** What beheer may do, as the penningmeester: every call carries the session cookie. */
export type Beheer = {
  cookie: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, data?: unknown): Promise<T>;
};

/**
 * Makes sure there is an admin, logs in, wipes the trial data so that every test starts empty,
 * and makes a pairing code for the kassa.
 */
export async function prepare(request: APIRequestContext): Promise<{ code: string; cookie: string; beheer: Beheer }> {
  const setup = await request.post("/api/admin/setup", { headers: write, data: { setupToken: SETUP_TOKEN, password: PASSWORD } });
  // 409: an earlier test has set the password already.
  expect([201, 409], `setup answered ${setup.status()}`).toContain(setup.status());

  const login = await request.post("/api/admin/login", { headers: write, data: { password: PASSWORD } });
  expect(login.status(), "login").toBe(200);
  const cookie = (login.headers()["set-cookie"] ?? "").split(";")[0] ?? "";
  expect(cookie, "session cookie").toContain("kassa_admin=");

  const beheer: Beheer = {
    cookie,
    async get<T>(path: string) {
      const answer = await request.get(path, { headers: { Cookie: cookie } });
      expect(answer.ok(), `GET ${path} answered ${answer.status()}`).toBe(true);
      return (await answer.json()) as T;
    },
    async post<T>(path: string, data?: unknown) {
      const answer = await request.post(path, { headers: { ...write, Cookie: cookie }, data });
      expect(answer.ok(), `POST ${path} answered ${answer.status()}`).toBe(true);
      return (await answer.json()) as T;
    },
  };

  await beheer.post("/api/admin/wipe-trial", { confirm: "WISSEN" });
  const { code } = await beheer.post<{ code: string }>("/api/admin/pairing-codes");
  return { code, cookie, beheer };
}

/** Ties this browser to the kassa, the way the beheerder does it once on the iPad. */
export async function pair(page: Page, code: string): Promise<void> {
  await page.goto("/koppelen");
  await page.getByLabel("Koppelcode").fill(code);
  await page.getByRole("button", { name: "Koppelen" }).click();
  await expect(page.locator("[data-product-tile]").first()).toBeVisible();
}

/** The Amsterdam date of now, as the reports count their days. */
export function today(): string {
  return businessDate(new Date().toISOString());
}

type Day = { totals: { cashCents: number; saleCount: number } };

/** What beheer has for today. A sale travels in the background, so ask until it is there (or give up). */
export async function expectToday(beheer: Beheer, totals: { cashCents: number; saleCount: number }, timeout = 15_000): Promise<void> {
  await expect
    .poll(async () => (await beheer.get<Day>(`/api/admin/reports/day?date=${today()}`)).totals, { timeout })
    .toMatchObject(totals);
}
