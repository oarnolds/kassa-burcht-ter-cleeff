// Helpers for the client tests: a fake server, rendering inside the app's providers, and a few shortcuts.

import { cleanup, render as rtlRender, screen, within, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, vi } from "vitest";
import type { Catalog } from "../shared/types";
import { AppRoutes } from "./routes";
import { ToastHost } from "./ui/Toast";

type Request = { method: string; url: string; body: any };
type Reply = unknown;
type Route = Reply | ((req: Request) => Reply);

let routes: Record<string, Route> = {};
let seen: { method: string; url: string; body: unknown }[] = [];
let offline = false;

/** A pair `[status, body]`, as opposed to a body answered with 200. */
function isPair(reply: Reply): reply is [number, unknown] {
  return Array.isArray(reply) && reply.length === 2 && typeof reply[0] === "number";
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input), "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  seen.push({ method, url: url.pathname + url.search, body });
  if (offline) throw new TypeError("Load failed");
  const route = routes[`${method} ${url.pathname}`] ?? routes[url.pathname];
  if (route === undefined) return Response.json({ error: "not_found" }, { status: 404 });
  const reply = typeof route === "function" ? (route as (req: Request) => Reply)({ method, url: url.pathname + url.search, body }) : route;
  return isPair(reply) ? Response.json(reply[1], { status: reply[0] }) : Response.json(reply);
}

function install(): void {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
}

/**
 * Stubs the server. A key is a pathname, optionally with a method in front (`"POST /api/pair"`); a key with
 * a method wins. A value is a JSON body (answered with 200), a pair `[status, body]`, or a function of the
 * request returning either. A later call adds to the earlier routes. Anything else answers 404.
 */
export function mockApi(more: Record<string, Route>): void {
  routes = { ...routes, ...more };
  offline = false;
  install();
}

/** Every request fails the way it does without a connection. */
export function mockOffline(): void {
  offline = true;
  install();
}

export function mockLoggedIn(): void {
  mockApi({ "/api/admin/status": { configured: true }, "/api/admin/me": { authenticated: true } });
}

/** The requests seen so far, optionally of one method. */
export function calls(method?: string): { method: string; url: string; body: unknown }[] {
  return method ? seen.filter((call) => call.method === method) : [...seen];
}

function Providers({ children, path = "/" }: { children: ReactNode; path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ToastHost>{children}</ToastHost>
    </MemoryRouter>
  );
}

/** Testing Library's render, inside the router and the toast host. */
export function render(ui: ReactElement): RenderResult {
  return rtlRender(ui, { wrapper: Providers });
}

/** Renders the app's own pages at a path. */
export function renderAt(path: string): RenderResult {
  return rtlRender(<AppRoutes />, { wrapper: ({ children }) => <Providers path={path}>{children}</Providers> });
}

/** A user whose clicks and keys also work while the test uses fake timers. */
export function user(): UserEvent {
  return userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {});
}

/** Clicks the one button with this accessible name, waiting a moment for it to appear. */
export async function tap(name: string | RegExp): Promise<void> {
  await user().click(await screen.findByRole("button", { name }));
}

/** Queries inside the table row whose name contains `row`, in the region named `section`. */
export function rowIn(section: string, row: string): ReturnType<typeof within> {
  const region = screen.getByRole("region", { name: section });
  const rows = within(region)
    .getAllByRole("row")
    .filter((candidate) => candidate.textContent?.includes(row));
  if (rows.length !== 1) throw new Error(`expected one row with "${row}" in "${section}", found ${rows.length}`);
  return within(rows[0]!);
}

/** What the kassa gets from the server in the screen tests. */
export const catalog: Catalog = {
  fetchedAt: "2026-07-30T10:00:00.000Z",
  categories: [
    { id: "ijs", name: "IJs", color: "rose", sort: 1 },
    { id: "warm", name: "Warme dranken", color: "brown", sort: 3 },
    { id: "statiegeld", name: "Statiegeld", color: "grey", sort: 6 },
  ],
  products: [
    { id: "aardbeitje", name: "Aardbeitje", priceCents: 110, categoryId: "ijs", sort: 1, quantityPad: false, trackStock: true, stock: 20, reorderAt: null },
    { id: "koffie", name: "Koffie", priceCents: 140, categoryId: "warm", sort: 16, quantityPad: false, trackStock: false, stock: null, reorderAt: null },
    { id: "statiegeld", name: "Statiegeld", priceCents: 15, categoryId: "statiegeld", sort: 22, quantityPad: true, trackStock: false, stock: null, reorderAt: null },
  ],
  openOrders: [],
  pin: { mode: "live", ready: true },
};

/** Removes the kassa's database on this "iPad". */
export function deleteKassaDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("kassa");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function kassaDatabaseExists(): Promise<boolean> {
  return (await indexedDB.databases()).some((database) => database.name === "kassa");
}

// Every test starts from nothing: no page, no routes, no recorded calls, real timers, an empty database.
afterEach(async () => {
  // Take the page down first, so its background work stops before the ground under it is cleared.
  cleanup();
  vi.useRealTimers();
  if (await kassaDatabaseExists()) {
    // Storage work that was under way gets a moment to finish before the database goes.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await deleteKassaDatabase();
  }
  routes = {};
  seen = [];
  offline = false;
  vi.unstubAllGlobals();
  localStorage.clear();
});
