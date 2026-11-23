# Boekhouding in de kassa-app: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A double-entry bookkeeping inside beheer that books the kassa, the kluisje, the banks (ING via Enable Banking or CAMT.053 files), Mollie and the speeltoestellen by itself, and closes a year into an export the kascommissie can read without the app.

**Architecture:** New tables in the same D1 database, new routes under `/api/admin/boekhouding/*` behind `requireAdmin`, new pages under `/beheer/boekhouding`. Every booking is an entry whose lines sum to zero (debit positive, credit negative). Entries made by the app carry a `source` and `source_ref` and are kept in step with their source by a nightly job (cron `0 2 * * *`) and a button; the penningmeester's own entries keep a history of every change. The boekhouding reads the kassa's tables and never writes them; heavy work (reading bank files, building Excel, PDF and zip) happens in the browser.

**Tech Stack:** As fase 1 and 2 (TypeScript, React 19, Hono, D1, zod 4, Vitest with `@cloudflare/vitest-plugin`, Testing Library, Playwright). New: an R2 bucket for attachments; WebCrypto RS256 for Enable Banking's JWT; `DOMParser` in the browser for CAMT.053; in beheer only, lazily loaded, one Excel-writing library and `fflate` for zip (the builder picks the Excel library, spec §20).

**Spec:** `docs/superpowers/specs/2026-11-23-boekhouding-design.md` (Dutch, approved 23 November 2026). For the conventions this builds on: `docs/superpowers/specs/2026-11-20-kassa-design.md`, `docs/superpowers/plans/2026-11-20-kassa-fase-1.md`, `docs/superpowers/plans/2026-11-21-kassa-fase-2-pin.md`.

**Scope:** Spec §17 steps 1 to 6 and the handbook. Going online, the R2 bucket, the secrets and the live checks of spec §19 are prepared in Task 22 and each needs the penningmeester's yes or is his own step.

## Global Constraints

- Everything in the fase 1 and fase 2 plans' Global Constraints about copy and data still holds: Dutch UI copy, English `snake_case` error codes, integer cents, `Europe/Amsterdam` business dates (`shared/time.ts`), 44 px touch targets, house style tokens.
- The boekhouding reads `sales`, `sale_lines`, `handovers`, `categories` and `settings` and never writes them. Nothing under `/api/kassa/*`, `/api/pair`, `/api/mollie/webhook` or `src/kassa/*` changes, and the existing tests pass unchanged. Nothing changes on the iPad.
- Every entry's lines sum to 0 (debit positive, credit negative). Checked in `worker/db/ledger.ts` on every write, never only in the browser.
- Nothing in a closed year changes. Nothing is deleted: an entry is emptied (its history stays), an attachment is hidden (its file stays in R2), a bank line stays.
- Entries with a source other than `manual` and `bank` are written only by their own sync, never through the edit route.
- Secrets: `ENABLE_BANKING_PRIVATE_KEY` (PEM), `ENABLE_BANKING_APP_ID`, `MOLLIE_ORG_TOKEN`. Worker secrets the penningmeester sets himself; never in the repository, in chat, in a test, in a log line or in a response. Tests generate a throwaway RSA key at runtime and use made-up tokens (`org_fake`).
- No test talks to the real Enable Banking or Mollie: `fetch` is stubbed to a fake in every test file that could reach them.
- Cloudflare free plan: about 10 ms CPU, 50 database calls (a batch is one) and 50 external calls per request or cron run. A sync writes in batches; work that does not fit is left for the next run, oldest first.
- Crons: keep `0 3 * * MON` (weekly copy) exactly as it is; add `0 2 * * *` (nightly). In Cloudflare's cron syntax day 1 is Sunday.
- The ledger starts on 1 January 2027 (`LEDGER_START = "2027-01-01"`). Bank lines, kassa days and Mollie payments before that date are not booked.
- Work on branch `claude/keen-mclaren-e7d5f1` (holds `main` at `0325dfd` plus the spec). Commit after every task, locally. Never push. No deploy, no merge into `main`, no remote migration, no R2 bucket, no secret without the penningmeester's explicit yes.
- Every commit message ends with the `Co-Authored-By:` line the executing session prescribes.
- Worker tests call `resetData()` in `beforeEach`; it empties the new tables and replays the seed migrations.

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a pinning test in the task named.

1. **The same transaction arrives twice by different roads** (an overlapping file, a file after Enable Banking, two equal "kasstorting" transfers on one day). Lines that are really two stay two; one line seen twice is one, even when Enable Banking and the file word the description differently. Task 5.
2. **A line, kassa sale, handover or Mollie payment dated in a closed year arrives after closing.** The closed year does not change; a bank line waits with "valt in afgesloten jaar"; kassa and Mollie differences land on 1 January of the first open year. Tasks 5, 10 and 15.
3. **The nightly job and "Nu bijwerken" run at the same time, or the cron is retried.** One entry per kassa day, handover, Mollie day and payout; no line twice. Tasks 10, 11 and 16.
4. **The ING return page is opened twice (refresh, back button) or with a stale or foreign `state`.** The second use is refused, no second session is made, and the first connection stays. Task 13.
5. **A Mollie payout line on ING whose payout is not known yet, or whose amount differs from the payout.** It waits or stays open with the reason; the app never guesses an amount. Task 16.

## File Structure

```
migrations/0005_ledger.sql                 accounts, years, entries, lines, history, attachments, money accounts,
                                           bank lines, bank balances, category accounts, comparison figures, year events
migrations/0006_ledger_seed.sql            the 44 accounts, year 2027, money accounts, kassa categories
migrations/0007_bank_consent.sql           Enable Banking consents
migrations/0008_mollie_ledger.sql          Mollie payments, payouts, rules
migrations/0009_mollie_rules_seed.sql      the three starting rules
migrations/0010_assets.sql                 speeltoestellen
shared/ledger-types.ts                     types shared by Worker and beheer
shared/accounts.ts                         the account list with the former e-Boekhouden numbers
shared/camt.ts                             parseCamt053 (browser)
shared/asset-paste.ts                      parseAssetPaste: "Vaste activa 2026" copied from e-Boekhouden (browser)
shared/depreciation.ts                     depreciationFor
worker/db/ledger.ts                        entries: create, replace, empty, sourced upsert, history, year guard, balances
worker/db/opening.ts                       opening balance, expectedCashAt
worker/db/attachments.ts                   attachments in R2
worker/db/bank.ts                          import, dedupe, balances, typed lines, suggestions, booking, auto rules
worker/db/ledger-reports.ts                balance, result, account lines, comparison figures, overview
worker/db/kassa-ledger.ts                  kassa days and handovers
worker/db/bank-consent.ts                  ING via Enable Banking: connect, return, fetch
worker/db/mollie-ledger.ts                 Mollie payments, rules, payouts, comparison
worker/db/assets.ts                        speeltoestellen, depreciation and disposal entries
worker/db/year.ts                          checks, close, reopen, export
worker/lib/enable-banking.ts               the only code that talks to Enable Banking
worker/lib/mollie-read.ts                  Mollie with the organisation token (read only)
worker/nightly.ts                          the nightly job
worker/routes/admin-ledger.ts              accounts, settings, entries, attachments, opening, comparison, reports, overview, sync
worker/routes/admin-ledger-bank.ts         bank lines, import, ING
worker/routes/admin-ledger-mollie.ts       rules, month comparison
worker/routes/admin-ledger-assets.ts       speeltoestellen, depreciation
worker/routes/admin-ledger-year.ts         checks, close, reopen, export
worker/app.ts  worker/index.ts  worker/env.ts  worker/db/maintenance.ts   wiring, cron dispatch, backup
wrangler.jsonc  wrangler.test.jsonc  vitest.worker.config.ts  test/env.d.ts  test/helpers.ts
test/fake-enable-banking.ts  test/fake-mollie.ts (extended)  test/ledger*.test.ts …
src/beheer/boekhouding/*.tsx               the pages; src/beheer/BeheerLayout.tsx and src/routes.tsx wiring
e2e/boekhouding.spec.ts
README.md                                  the handbook
```

Route files only parse, authorise and respond; rules live in `worker/db/*`. All routes are mounted in `worker/app.ts` after `app.use("/api/admin/*", requireAdmin)`.

---

## Stap 1: de basis

### Task 1: Ledger tables, the account list and the rules for an entry

**Files:**
- Create: `migrations/0005_ledger.sql`, `migrations/0006_ledger_seed.sql`, `shared/ledger-types.ts`, `shared/accounts.ts`, `worker/db/ledger.ts`, `test/ledger.test.ts`
- Modify: `test/helpers.ts` (`TABLES`, seeds replayed by `resetData`)

**Interfaces:**
- Produces in `shared/ledger-types.ts`:
  ```ts
  export type AccountKind = "asset" | "liability" | "equity" | "expense" | "income";
  export type LedgerAccount = { code: string; name: string; kind: AccountKind; money: boolean; hidden: boolean; formerly: string[] };
  export type EntrySource = "manual" | "opening" | "bank" | "kassa_day" | "kassa_late" | "handover" | "mollie_other" | "mollie_settlement" | "depreciation" | "disposal" | "closing";
  export type EntryLine = { accountCode: string; amountCents: number; note: string | null; assetId: string | null };
  export type Attachment = { id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string };
  export type Entry = { id: string; year: number; number: number; date: string; description: string; source: EntrySource; sourceRef: string | null; lines: EntryLine[]; attachments: Attachment[]; editable: boolean; changed: boolean };
  export type EntryChange = { at: string; before: { date: string; description: string; lines: EntryLine[] } | null; after: { date: string; description: string; lines: EntryLine[] } };
  export const LEDGER_START = "2027-01-01";
  ```
- Produces in `shared/accounts.ts`: `export const ACCOUNTS: readonly LedgerAccount[]` — the 44 accounts of spec §8 in its order, with `formerly` holding the e-Boekhouden numbers merged into each (for 4302: `["4302", "4303"]`; for 8000: `["8000", "8001", "8002", "8003"]`; for 1300: `["1300", "1500", "1590"]`; …). `money: true` for 1000, 1010, 1011, 1020, 1021, 1030. Kinds: 0130/0135/1000–1300 asset (0135 is an asset account with a credit balance), 1400 equity, 1700 liability, 4xxx expense, 8xxx income. A test checks that `0006_ledger_seed.sql` inserts exactly these codes and names.
- Produces in `worker/db/ledger.ts`:
  ```ts
  export class LedgerError extends Error { constructor(public code: string, public status: 400 | 404 | 409) }
  export type NewEntry = { date: string; description: string; source: EntrySource; sourceRef?: string | null; lines: EntryLine[] };
  export async function createEntry(db: D1Database, input: NewEntry, now: Date): Promise<Entry>;
  /** By the penningmeester: only `manual` and `bank` entries, history kept. */
  export async function editEntry(db: D1Database, id: string, input: Pick<NewEntry, "date" | "description" | "lines">, now: Date): Promise<Entry>;
  export async function emptyEntry(db: D1Database, id: string, now: Date): Promise<Entry>;
  /** By a sync: creates the entry for (source, sourceRef) or replaces its lines; no history; nothing when unchanged. */
  export async function upsertSourced(db: D1Database, input: NewEntry & { sourceRef: string }, now: Date): Promise<Entry>;
  /** The same as statements, so a sync can write many entries in one batch. */
  export function upsertSourcedStatements(db: D1Database, input: NewEntry & { sourceRef: string }, existing: { id: string } | null, now: Date): D1PreparedStatement[];
  export async function getEntry(db: D1Database, id: string): Promise<Entry | null>;
  export async function listEntries(db: D1Database, filter: { year: number; accountCode?: string; from?: string; to?: string; text?: string; amountCents?: number }): Promise<Entry[]>;
  export async function entryHistory(db: D1Database, id: string): Promise<EntryChange[]>;
  export async function yearStatus(db: D1Database, year: number): Promise<"open" | "closed" | null>;
  /** Sum of all lines per account with date <= `upTo`. */
  export async function balancesOn(db: D1Database, upTo: string): Promise<Map<string, number>>;
  ```
- Tables (0005): `ledger_accounts(code PK, name, kind, money, hidden, sort, formerly)`, `ledger_years(year PK, status open|closed, closed_at, close_note)`, `ledger_entries(id PK, year, number, date, description, source, source_ref, created_at, updated_at, UNIQUE(year, number), UNIQUE(source, source_ref))`, `ledger_lines(id PK AUTOINCREMENT, entry_id, account_code, amount_cents, note, asset_id)` with index on `(account_code)` and `(entry_id)`, `ledger_history(id, entry_id, at, before_json, after_json)`, `ledger_year_events(id, year, at, kind closed|reopened, note)`. Seed (0006): accounts, `ledger_years (2027, 'open')`.

- [ ] **Step 1: Write the failing tests** in `test/ledger.test.ts` (`beforeEach(resetData)`):
  ```ts
  it("knows the 44 accounts of the spec, with what they replace", …)          // GET from db: codes equal ACCOUNTS.map(a => a.code); 8000.formerly = ["8000","8001","8002","8003"]
  it("refuses an entry whose lines do not sum to zero", …)                   // lines +1000 / -999 → LedgerError "unbalanced" 400; nothing written
  it("numbers entries per year, one after the other", …)                     // three entries in 2027 → numbers 1, 2, 3
  it("refuses a date in a closed year, or before the ledger starts", …)      // 2026-12-31 → "year_unknown"; close 2027 by hand in the test → "year_closed" 409
  it("refuses an unknown account, and a hidden one for the penningmeester", …) // "9999" → "account_unknown"; hidden 4507 on a manual entry → "account_hidden"
  it("lets a sync book on a hidden account", …)                              // upsertSourced with hidden 8011 → ok
  it("keeps the history of an edit", …)                                      // editEntry → entryHistory has before and after; entry.changed true
  it("empties an entry instead of deleting it", …)                           // emptyEntry → lines [], number kept, history has the old lines
  it("does not let the penningmeester edit what a sync wrote", …)            // source kassa_day → editEntry "not_editable" 409
  it("writes one entry per source and reference, also when called twice at once", …) // Promise.all of two upsertSourced → one entry, lines of the last
  it("adds up balances up to a date", …)                                     // balancesOn("2027-01-31") ignores a February entry
  ```
- [ ] **Step 2: Run them.** `npm run test:worker -- test/ledger.test.ts`. Expected: FAIL, `worker/db/ledger.ts` does not exist.
- [ ] **Step 3: Write the migrations, `shared/*` and `worker/db/ledger.ts`.** The number is assigned inside the insert (`SELECT COALESCE(MAX(number), 0) + 1 … WHERE year = ?`), so two writers never share one. `upsertSourced` relies on `UNIQUE(source, source_ref)` (`INSERT … ON CONFLICT DO NOTHING`, then replace the lines of whichever row exists). `editable` is true for `manual` and `bank` in an open year. Extend `TABLES` in `test/helpers.ts` (children first: `ledger_lines`, `ledger_history`, …) and let `resetData` replay every migration whose name ends in `_seed.sql`.
- [ ] **Step 4: Run them.** `npm run test:worker`. Expected: PASS, including every existing test. Then `npm run typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "feat(boekhouding): ledger tables, the 44 accounts and the rules for an entry"`

---

### Task 2: Opening balance and the cash box on a date

**Files:**
- Create: `worker/db/opening.ts`, `test/opening.test.ts`

**Interfaces:**
- Consumes: `createEntry`, `upsertSourced`, `balancesOn` (Task 1); the cash rules of `worker/db/cash.ts` (read only).
- Produces:
  ```ts
  export type Opening = { year: number; lines: { accountCode: string; amountCents: number }[]; equityCents: number; eBoekhoudenEquityCents: number | null; expectedCashCents: number };
  /** The opening entry of `year` (source "opening", ref = year, dated `${year}-01-01`), with 1400 worked out. */
  export async function getOpening(db: D1Database, year: number, now: Date): Promise<Opening>;
  export async function setOpening(db: D1Database, year: number, input: { lines: { accountCode: string; amountCents: number }[]; eBoekhoudenEquityCents: number | null }, now: Date): Promise<Opening>;
  /** What the kassa says belonged in the kluisje at `atIso`: the last `left_cents` before it plus paid cash sales since that handover, sold up to `atIso`. */
  export async function expectedCashAt(db: D1Database, atIso: string): Promise<number>;
  ```
  Amounts are typed as the balance shows them: positive for an asset, positive for a liability; `setOpening` turns them into lines (assets debit, liabilities and 0135 credit) and adds 1400 as the line that makes the sum zero. `eBoekhoudenEquityCents` is kept in `settings` (`ledger_opening_eb_equity_{year}`) only to show the difference.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("works out equity so the opening balance always closes", …)       // 1010 2.173.676, 1020 9.344.653, 1700 50.000 → 1400 line = -(sum of assets − liabilities); entry sums to 0
  it("shows the difference with equity in e-Boekhouden", …)            // eBoekhoudenEquityCents 24.662.912 → returned as given, equityCents differs
  it("replaces the opening balance when typed again", …)               // second setOpening → one opening entry, new lines
  it("refuses an income or expense account in the opening balance", …) // 8011 → "not_balance_account" 400
  it("tells what belonged in the kluisje at a moment", …)              // opening 50,00 left; cash 2,20 before, 1,10 after the moment → 52,20
  ```
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** in `worker/db/opening.ts`. Balance accounts are kinds `asset`, `liability`, `equity`; 1400 itself may not be typed.
- [ ] **Step 4: Run them.** `npm run test:worker -- test/opening.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): opening balance with equity worked out`

---

### Task 3: Attachments

**Files:**
- Create: `worker/db/attachments.ts`, `test/attachments.test.ts`
- Modify: `worker/env.ts` (`ATTACHMENTS?: R2Bucket`), `test/env.d.ts`, `wrangler.jsonc` and `wrangler.test.jsonc` (`r2_buckets` gains `{ "binding": "ATTACHMENTS", "bucket_name": "boekhouding-bijlagen" }`; the `BACKUPS` entry stays as it is)

**Interfaces:**
- Produces:
  ```ts
  export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
  export async function addAttachment(env: Env, entryId: string, file: { filename: string; contentType: string; body: ReadableStream | ArrayBuffer; sizeBytes: number }, now: Date): Promise<Attachment>;
  export async function readAttachment(env: Env, id: string): Promise<{ attachment: Attachment; body: ReadableStream } | null>;
  export async function hideAttachment(env: Env, id: string, now: Date): Promise<void>;
  ```
  R2 key `bijlagen/{year}/{entryId}/{attachmentId}`; table `ledger_attachments(id, entry_id, r2_key, filename, content_type, size_bytes, uploaded_at, hidden_at)` is in `0005_ledger.sql` (add it there; the migration is not online yet).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("keeps a PDF with its entry and hands it back", …)            // getEntry(...).attachments has it; readAttachment body equals what was sent
  it("refuses a file that is too large or of another type", …)     // 10 MB + 1 → "too_large"; text/html → "wrong_type"
  it("hides an attachment but keeps the file", …)                  // hideAttachment → not in entry.attachments; object still in the bucket; history line "bijlage verborgen"
  it("refuses changes in a closed year", …)                        // "year_closed"
  it("says the attachments are off without a bucket", …)           // env without ATTACHMENTS → "attachments_off" 503
  ```
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The file name is cleaned to letters, digits, `-`, `_`, `.` and at most 100 characters.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): attachments in their own R2 bucket, never deleted`

---

### Task 4: Reading a CAMT.053 bank file in the browser

**Files:**
- Create: `shared/camt.ts`, `shared/camt.test.ts`, `shared/fixtures/camt-ing-spaar.xml`, `shared/fixtures/camt-ing-betaal.xml` (made up, shaped like the real file)

**Interfaces:**
- Produces:
  ```ts
  export type CamtLine = { bookingDate: string; amountCents: number; description: string; counterpartyName: string | null; counterpartyIban: string | null; bankRef: string | null };
  export type CamtStatement = { account: string; opening: { date: string; cents: number } | null; closing: { date: string; cents: number } | null; lines: CamtLine[] };
  export class CamtError extends Error {}   // message "not_camt053" | "unreadable"
  export function parseCamt053(xml: string): CamtStatement[];
  ```
  Facts from the penningmeester's real file (spec §10): namespace `urn:iso:std:iso:20022:tech:xsd:camt.053.001.02` (accept any `camt.053.001.*`); account in `Acct/Id/IBAN` or `Acct/Id/Othr/Id`; balances `Bal` with `Tp/CdOrPrtry/Cd` `OPBD` (fallback `PRCD`) and `CLBD`; each `Ntry` has `Amt`, `CdtDbtInd` (`DBIT` makes it negative), `BookgDt/Dt`, and may lack any reference. Description: all `RmtInf/Ustrd` joined by a space, else `AddtlNtryInf`. Counterparty: `RltdPties/Dbtr` for a credit, `RltdPties/Cdtr` for a debit (`Nm`, `…Acct/Id/IBAN`). `bankRef`: `AcctSvcrRef` of the entry or its `TxDtls/Refs`, else `NtryRef`, else null.

- [ ] **Step 1: Make the fixtures.** `camt-ing-spaar.xml`: copy the structure of the real savings file (one statement, `Othr/Id` `V00000000`, PRCD and OPBD € 10.883,45 on 2025-12-31 / 2026-01-01, CLBD € 11.027,47, one credit "Rente" € 144,02 on 2026-01-01 without reference). `camt-ing-betaal.xml`: IBAN `NL00INGB0000000000`, a credit from "Gemeente Haarlem" with IBAN and `AcctSvcrRef`, a debit to "Goodoo BV", and two equal credits "kasstorting" € 40,00 on the same day.
- [ ] **Step 2: Write the failing tests:**
  ```ts
  it("reads the savings file as the bank wrote it", …)  // [{ account: "V00000000", opening: { date: "2026-01-01", cents: 1088345 }, closing: { date: "2026-11-22", cents: 1102747 }, lines: [{ bookingDate: "2026-01-01", amountCents: 14402, description: "Rente", counterpartyName: null, counterpartyIban: null, bankRef: null }] }]
  it("takes the other party from the right side", …)     // credit → Dbtr; debit → Cdtr, amount negative
  it("keeps two equal lines on one day as two", …)        // both kasstorting lines present
  it("refuses XML that is not a bank statement", …)       // "<a/>" → CamtError "not_camt053"
  ```
- [ ] **Step 3: Run them.** `npm run test:client -- shared/camt.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** with `DOMParser` and `getElementsByTagNameNS("*", …)`. Amounts are parsed from the decimal string into cents without floating point.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(boekhouding): read CAMT.053 bank files in the browser`

---

### Task 5: Bank lines in: import, doubles, balances, typed lines

**Files:**
- Create: `worker/db/bank.ts` (import part), `worker/routes/admin-ledger-bank.ts`, `test/bank-import.test.ts`
- Modify: `migrations/0005_ledger.sql` (tables below), `migrations/0006_ledger_seed.sql` (money accounts), `worker/app.ts`

**Interfaces:**
- Tables: `money_accounts(account_code PK, identifier, source file|enable_banking|kassa|mollie)` seeded 1000 kassa, 1010 file, 1011 file, 1020 file, 1021 file, 1030 mollie; `bank_lines(id PK, account_code, booking_date, amount_cents, counterparty_name, counterparty_iban, description, bank_ref, content_key, origin file|enable_banking|typed|mollie, status open|booked|waiting, waiting_for, entry_id, imported_at)` with `UNIQUE(account_code, bank_ref)` where not null and `UNIQUE(content_key)`; `bank_balances(account_code, date, balance_cents, origin, PRIMARY KEY(account_code, date))`.
- Produces in `shared/ledger-types.ts`:
  ```ts
  export type MoneySource = "file" | "enable_banking" | "kassa" | "mollie";
  export type MoneyAccount = { accountCode: string; name: string; identifier: string | null; source: MoneySource; ledgerCents: number; bank: { date: string; balanceCents: number } | null; differenceCents: number | null };
  export type BankLine = { id: string; accountCode: string; date: string; amountCents: number; counterpartyName: string | null; counterpartyIban: string | null; description: string; status: "open" | "booked" | "waiting"; waitingFor: "mollie" | null; note: string | null; entryId: string | null; suggestion: string | null; inClosedYear: boolean };
  export type ImportResult = { added: number; known: number; beforeStart: number; autoBooked: number };
  ```
- Produces in `worker/db/bank.ts`:
  ```ts
  export async function importLines(db: D1Database, accountCode: string, lines: CamtLine[], origin: "file" | "enable_banking" | "typed" | "mollie", now: Date): Promise<ImportResult>;
  export async function recordBalance(db: D1Database, accountCode: string, balance: { date: string; cents: number }, origin: string): Promise<void>;
  export async function moneyAccounts(db: D1Database): Promise<MoneyAccount[]>;
  export async function setMoneyAccount(db: D1Database, code: string, input: { identifier?: string | null; source?: MoneySource }): Promise<MoneyAccount>;
  ```
- Routes: `GET /api/admin/boekhouding/money-accounts`, `PATCH /money-accounts/:code`, `POST /bank/import` `{ accountCode, statement: CamtStatement }` (refused with `wrong_account` 409 when `statement.account` ≠ the identifier, ignoring spaces and case; imports the lines, records the closing balance (and the opening balance when it is on or after 31 December 2026), then runs `autoBook` from Task 6 once it exists), `POST /bank/lines` (typed: `{ accountCode, date, amountCents, description, counterpartyName? }`).
- **Doubles** (Review Focus 1): the content key is `sha256(accountCode | bookingDate | amountCents | counterpartyIban ?? "" | occurrence)`, where `occurrence` counts lines with the same first four parts within this import. The description is left out on purpose: Enable Banking and a file may word it differently. A line is known when its `bank_ref` or its content key is already there.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("reads a line once, also from a second, overlapping file", …)            // import twice → added 1 then known 1
  it("keeps two equal lines on one day as two, and still once each", …)       // two kasstorting € 40 → added 2; again → known 2
  it("recognises a line from Enable Banking in a file without a reference", …)// enable_banking with bankRef + other wording, then file without → known 1
  it("skips lines before the ledger starts", …)                               // 2026-12-30 → beforeStart 1, nothing stored
  it("marks a line in a closed year", …)                                      // close 2027, import 2027-12-31 line → stored, inClosedYear true
  it("refuses a file of another account", …)                                  // 1011 has V00000000, statement IBAN → 409 wrong_account
  it("compares the ledger with the bank's balance on the same date", …)       // opening 1011 € 10.883,45 + rente line booked, closing balance → differenceCents 0; unbooked → -14402
  it("lets the penningmeester type a line by hand", …)                        // POST /bank/lines → open line, origin typed
  ```
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** One batch per import for the lookups and one for the inserts (chunks of at most 50 statements per batch call are fine; stay within 50 calls). `moneyAccounts` computes `ledgerCents` with `balancesOn` on the date of the newest bank balance.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): bank lines from files and by hand, read once, with the balance check`

---

### Task 6: Te boeken: suggestions, booking, splitting, own transfers and kasstorting

**Files:**
- Modify: `worker/db/bank.ts`, `worker/routes/admin-ledger-bank.ts`
- Create: `test/bank-book.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function openLines(db: D1Database, filter: { accountCode?: string }): Promise<BankLine[]>;   // status open or waiting, oldest first, with `suggestion`
  /** Books a line: the money account gets the line's amount, `split` the other side (sums to minus the amount). */
  export async function bookLine(db: D1Database, lineId: string, input: { split: { accountCode: string; amountCents: number; assetId?: string | null }[]; description?: string }, now: Date): Promise<Entry>;
  /** Run after every import: own transfers and kasstorting book themselves. Returns how many. */
  export async function autoBook(db: D1Database, now: Date): Promise<number>;
  ```
  Routes: `GET /bank/lines?account=`, `POST /bank/lines/:id/book`. The entry has source `bank`, ref = line id, date = booking date; booking it again (after an edit of the entry) goes through `editEntry`.
  - Suggestion: the account on the other side of the newest booked line with the same counterparty IBAN, else the same counterparty name; only when that entry had one other line.
  - Own transfer: counterparty IBAN or identifier equals the identifier of another money account → booked against 1080.
  - Kasstorting (spec §10): a credit on 1010 whose description contains `kasstorting` (any case) → booked against 1080.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("books a line on the account chosen, and closes it", …)        // Gemeente Haarlem +6.091,47 → 8020; entry 1010 +609147 / 8020 -609147; status booked
  it("splits one line over two accounts", …)                        // -412,80 → 4501 300,00 and 4514 112,80
  it("refuses a split that does not add up", …)                     // "unbalanced"
  it("suggests what was chosen last time for the same party", …)    // second Goodoo line → suggestion "4501"
  it("books a transfer between own accounts against 1080, both sides", …) // 1010 → 1011 and the 1011 line → both booked, 1080 back to 0
  it("books a kasstorting against 1080 by itself", …)               // "Kasstorting juli" +54,70 on 1010 → booked, entry 1010/1080
  it("refuses to book a line in a closed year", …)                  // "year_closed"
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): book bank lines, with suggestions, splits and the transfers that book themselves`

---

### Task 7: Reports, comparison figures and the overview

**Files:**
- Create: `worker/db/ledger-reports.ts`, `worker/routes/admin-ledger.ts` (accounts, category accounts, entries, attachments, opening, comparison, reports, overview), `test/ledger-reports.test.ts`
- Modify: `migrations/0005_ledger.sql` (`comparison_figures(year, account_code, amount_cents, PRIMARY KEY(year, account_code))`, `category_accounts(category_id PK, account_code)`), `0006_ledger_seed.sql` (`entree` → 8012, `ijs`, `koud`, `warm`, `snacks`, `statiegeld` → 8011), `worker/app.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BalanceReport = { date: string; rows: { code: string; name: string; kind: AccountKind; cents: number }[]; assetsCents: number; liabilitiesAndEquityCents: number; resultCents: number };
  export type ResultReport = { from: string; to: string; rows: { code: string; name: string; kind: "income" | "expense"; cents: number; previousCents: number | null }[]; resultCents: number; previousResultCents: number | null };
  export type AccountLines = { code: string; openingCents: number; lines: { entryId: string; number: number; date: string; description: string; amountCents: number; runningCents: number }[] };
  export type LedgerOverview = { openLines: number; waitingLines: number; moneyAccounts: MoneyAccount[]; resultYearCents: number; cashDifferenceCents: number; consent: { validUntil: string; daysLeft: number } | null; mollieDifferenceCents: number | null; lastNightly: NightlyReport | null };
  export async function balanceReport(db: D1Database, date: string): Promise<BalanceReport>;
  export async function resultReport(db: D1Database, from: string, to: string): Promise<ResultReport>;   // `closing` entries left out; previous = same period a year earlier, or comparison_figures when that year is 2026
  export async function accountLines(db: D1Database, code: string, from: string, to: string): Promise<AccountLines>;
  export async function setComparison(db: D1Database, year: number, figures: { accountCode: string; amountCents: number }[]): Promise<void>;
  export async function overview(db: D1Database, now: Date): Promise<LedgerOverview>;
  ```
  Define `NightlyReport` (shape in Task 11) in `shared/ledger-types.ts` now; `lastNightly`, `consent` and `mollieDifferenceCents` stay `null` until Tasks 11, 13 and 16 fill them in. Income is shown positive, costs positive; `resultCents` = income − costs.
  Routes: `GET/POST/PATCH /accounts…`, `GET/PUT /category-accounts`, `GET/POST /entries`, `PUT /entries/:id`, `POST /entries/:id/empty`, `GET /entries/:id/history`, `POST /entries/:id/attachments` (raw body; `Content-Type`, `X-Filename`), `GET /attachments/:id`, `POST /attachments/:id/hide`, `GET/PUT /opening?year=`, `GET/PUT /comparison?year=`, `GET /reports/balance?date=`, `GET /reports/result?from=&to=`, `GET /reports/account/:code?from=&to=`, `GET /overview`. All under `/api/admin/boekhouding`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("closes the balance, with the result of the year on it", …)          // opening + a sale booked → assets = liabilities + equity + result
  it("shows the result next to 2026 from the typed comparison figures", …)// comparison 8030 = 118.440 → previousCents 118440
  it("shows the result next to the same months a year earlier", …)        // entries in 2027 and 2028
  it("leaves the closing entry out of the result", …)                     // a closing entry → resultCents unchanged
  it("lists an account's lines with a running balance", …)
  it("answers every boekhouding route only after logging in", …)          // no cookie → 401; write without X-Requested-With → 403
  it("reads no more rows for a report as the years go by", …)             // meteredDb: result report of one month after 2.000 entries in other months stays under 100 rows read
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). An index `ledger_entries(year, date)` and `ledger_lines(account_code)` keep the last test green.
- [ ] **Step 5: Commit.** `feat(boekhouding): balance, result with comparison, account lines and the routes`

---

### Task 8: Beheer, part 1: menu, Instellingen, Beginbalans, Vergelijkingscijfers

**Files:**
- Create: `src/beheer/boekhouding/LedgerLayout.tsx`, `SettingsLedgerPage.tsx`, `OpeningPage.tsx`, `ComparisonPage.tsx`, `src/beheer/boekhouding/ledger-api.ts`, tests next to each (`*.test.tsx`)
- Modify: `src/beheer/BeheerLayout.tsx` (`pages` gains `["/beheer/boekhouding", "Boekhouding"]` before `Instellingen`), `src/routes.tsx`

**Interfaces:**
- Routes in `src/routes.tsx`: `/beheer/boekhouding` (layout with its own tab bar: Overzicht, Te boeken, Boekingen, Rapporten, Mollie, Toestellen, Jaar, Instellingen), child paths `te-boeken`, `boekingen`, `boekingen/:id`, `rapporten`, `mollie`, `toestellen`, `jaar`, `jaar/:year/afdruk`, `instellingen`, `beginbalans`, `vergelijking`. Pages of later tasks are placeholders until their task.
- `ledger-api.ts`: one typed function per route of Task 7 over `adminApi`.
- Copy (exact): tab "Boekhouding"; Instellingen sections "Rekeningen", "Geldrekeningen", "Omzet van de kassa"; per money account the choice "Automatisch via Enable Banking" / "Bankbestand uploaden of met de hand" and the field "Kenmerk (IBAN of spaarnummer)"; Beginbalans heading "Beginbalans 1 januari 2027", line "Eigen vermogen (uitgerekend)", field "Eigen vermogen in e-Boekhouden (ter vergelijking)", the kluisje hint "Volgens de kassa hoort er op 31 december € … in het kluisje."; Vergelijkingscijfers heading "Cijfers 2026", per row the old numbers ("was 4302 en 4303").

- [ ] **Step 1: Write the failing tests** (Testing Library, `mockApi` as in `CashPage.test.tsx`):
  ```ts
  it("adds Boekhouding to the beheer menu", …)
  it("hides and renames an account, and adds one", …)                 // PATCH /accounts/4507 { hidden: true }; POST /accounts
  it("switches a money account between Enable Banking and files", …)  // PATCH /money-accounts/1010 { source: "file" }
  it("shows which kassa category goes to which account", …)           // Entree → 8012 Entree
  it("works out equity while typing the opening balance", …)          // typing 1010 updates "Eigen vermogen (uitgerekend)"
  it("shows the old numbers next to the comparison figures", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). `npm run test:client`.
- [ ] **Step 5: Commit.** `feat(boekhouding): beheer menu, settings, opening balance and 2026 figures`

---

### Task 9: Beheer, part 2: Te boeken, Boekingen, Rapporten, Overzicht

**Files:**
- Create: `src/beheer/boekhouding/OverviewPage.tsx`, `ToBookPage.tsx`, `EntriesPage.tsx`, `EntryPage.tsx`, `ReportsLedgerPage.tsx`, `AttachmentButton.tsx`, tests next to each
- Modify: `src/beheer/DashboardPage.tsx` (one line "Boekhouding: … te boeken" or "Saldo wijkt af bij …" linking to `/beheer/boekhouding`, only when there is something)

**Interfaces:**
- Consumes: `parseCamt053` (Task 4), the routes of Tasks 5–7.
- Te boeken: per money account an upload button "Bankbestand inlezen" (file input `accept=".xml"`; the browser parses and posts `{ accountCode, statement }` per statement; a `wrong_account` answer shows "Dit bestand hoort bij een andere rekening (…)."), a button "Regel intypen", then the list as in spec §10 (date, party, description, amount, account select pre-filled with the suggestion, "Boeken", "Bijlage", "Verdelen"). A waiting line shows "wacht op Mollie"; a line in a closed year "valt in afgesloten jaar {jaar}" and no Boeken button. After an upload: "{added} nieuw, {known} al bekend, {autoBooked} vanzelf geboekt."
- Boekingen: search by date range, account, amount and text; "Nieuwe boeking" with lines that must sum to zero before "Opslaan" is enabled ("Debet en credit zijn niet gelijk: verschil € …"); an entry page with "Wijzigen" and "Leegmaken" for editable entries, the history ("Gewijzigd op …: eerst …"), attachments with "Bijlage toevoegen" (`accept="application/pdf,image/jpeg,image/png"`, also the camera on a phone) and "Verbergen".
- Rapporten: Balans on a date, Winst en verlies over a period with the column of the year before, a click on a row opens the account's lines.
- Overzicht: the `LedgerOverview` of Task 7; a button "Nu bijwerken" comes in Task 11.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("reads a bank file in the browser and sends its lines", …)              // upload fixture → POST /bank/import body.statement.lines.length 1
  it("says when a file belongs to another account", …)
  it("books a line with the suggested account in one tap", …)                // Boeken → POST /bank/lines/:id/book { split: [{ accountCode: "4501", amountCents: 41280 }] }
  it("splits a line and refuses a split that does not add up", …)
  it("keeps Opslaan off until debit and credit are equal", …)
  it("shows what an entry was before it was changed", …)
  it("adds a photo of a receipt to an entry", …)                             // POST /entries/:id/attachments with Content-Type image/jpeg
  it("opens an account's lines from the result", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): beheer pages to book, search, report and attach`

---

## Stap 2: de kassa

### Task 10: Kassa days and handovers in the ledger

**Files:**
- Create: `worker/db/kassa-ledger.ts`, `test/kassa-ledger.test.ts`

**Interfaces:**
- Consumes: `upsertSourcedStatements` (Task 1), `category_accounts` (Task 7), the kassa tables (read only), `settings.in_use_since`.
- Produces:
  ```ts
  export type KassaSyncResult = { days: number; late: number; handovers: number; left: number };
  /** Brings the kassa's paid sales and handovers into the ledger; at most `maxItems` per run, oldest first. */
  export async function syncKassa(db: D1Database, now: Date, maxItems?: number): Promise<KassaSyncResult>;   // default 40
  ```
  - Which days: business dates from `max(in_use_since, LEDGER_START)` with a paid sale received after `settings.ledger_kassa_synced_at`, or with no `kassa_day` entry yet. The marker moves only to the newest `received_at` actually handled.
  - Day entry (source `kassa_day`, ref = date, description "Kassa {d-m-jjjj}"): debit 1000 the cash total, debit 1030 the pin total, credit per category account the line totals (reversals included, as in `worker/db/reports.ts`). A category without a row in `category_accounts` goes to 8011. A day that nets to zero gets an empty entry.
  - A date in a closed year (Review Focus 2): entry source `kassa_late`, ref = date, dated 1 January of the first open year, description "Nagekomen kassaverkoop {d-m-jjjj}", lines = the kassa's totals for that date minus the lines already booked for it.
  - Handover (kind `handover`, `counted_at` from the ingebruikname): source `handover`, ref = handover id, dated the Amsterdam date of `counted_at` (1 January of the first open year when that date is in a closed year), description "Afdracht kluisje" plus the note: credit 1000 `expected − left`, debit 1080 `received`, debit 4515 `difference` (credit when negative). `opening` handovers are not booked.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("books a day of the kassa per kind, cash to Kas and pin to Mollie", …)  // 2 Aardbeitje cash + 1 Entree pin → 1000 +220, 1030 +60, 8011 -220, 8012 -60
  it("equals the kassa's own day report, also after a reversal", …)          // dayReport totals == entry lines per account
  it("takes a late sale into its own day while the year is open", …)
  it("books a late sale for a closed year on 1 January of the open year", …) // closed 2027, sale for 2027-12-31 arrives → kassa_late on 2028-01-01, 2027 entry unchanged
  it("books nothing before the ingebruikname or before 2027", …)
  it("books a handover with its difference", …)                             // expected 54,70 received 4,00 left 50,00 → 1000 -470, 1080 +400, 4515 +70
  it("books a handover dated in a closed year on 1 January of the open year", …)
  it("keeps Kas equal to what belongs in the kluisje", …)                    // balancesOn 1000 == getCashState().expectedCents (opening in the beginbalans)
  it("writes one entry per day when two syncs run at once", …)               // Promise.all(syncKassa ×2) → one entry per date
  it("stays within the free plan for a long offline day", …)                 // meteredDb: 300 sales on 40 dates → calls <= 20
  it("never writes in the kassa's tables", …)                                // row counts of sales, sale_lines, handovers unchanged; exportAll before == after for those
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): the kassa books its days and handovers`

---

### Task 11: The nightly job, "Nu bijwerken" and the weekly copy

**Files:**
- Create: `worker/nightly.ts`, `test/nightly.test.ts`
- Modify: `worker/index.ts`, `wrangler.jsonc` (`"triggers": { "crons": ["0 3 * * MON", "0 2 * * *"] }`), `worker/db/maintenance.ts` (`exportAll` adds `ledger: Record<string, unknown[]>` with every new table), `worker/routes/admin-ledger.ts` (`POST /sync`), `src/beheer/boekhouding/OverviewPage.tsx` (button "Nu bijwerken" and "Vannacht bijgewerkt om … (… niet gelukt)"), `test/backup.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // in shared/ledger-types.ts (defined in Task 7):
  export type NightlyStep = "kassa" | "ing" | "mollie";
  export type NightlyReport = { at: string; steps: Partial<Record<NightlyStep, "ok" | "skipped" | string>> };   // a string other than ok/skipped is the error code
  // in worker/nightly.ts:
  /** Each step on its own: one failing leaves the others running. Stored in settings `ledger_nightly_last`. */
  export async function runNightly(env: Env, now: Date): Promise<NightlyReport>;
  ```
  `index.ts`: `scheduled: (controller, env, ctx) => ctx.waitUntil(controller.cron === "0 2 * * *" ? runNightly(env, new Date()) : runBackup(env, new Date()))`. Steps `ing` and `mollie` are `"skipped"` until Tasks 13 and 15 fill them in.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("runs the kassa step at night and remembers how it went", …)
  it("goes on with the other steps when one fails", …)        // a step that throws → its code stored, the others "ok"
  it("still makes the weekly copy on Monday", …)              // scheduled with "0 3 * * MON" → runBackup called, runNightly not
  it("takes the boekhouding along in the weekly copy", …)     // exportAll(...).ledger.ledger_entries has the entries
  it("lets the penningmeester bring it up to date by hand", …)// POST /api/admin/boekhouding/sync → 200 NightlyReport
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). Then `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit.** `feat(boekhouding): a nightly job next to the weekly copy, and Nu bijwerken`

---

## Stap 3: ING automatisch

### Task 12: The Enable Banking client and a fake Enable Banking

**Files:**
- Create: `worker/lib/enable-banking.ts`, `test/fake-enable-banking.ts`, `test/enable-banking.test.ts`
- Modify: `worker/env.ts` (`ENABLE_BANKING_APP_ID?: string; ENABLE_BANKING_PRIVATE_KEY?: string; ENABLE_BANKING_API_BASE?: string`), `test/env.d.ts`, `test/helpers.ts` (`useFakeEnableBanking()` as `useFakeMollie()`; a combined fetch stub when a file needs both)

**Interfaces:**
- Produces:
  ```ts
  export const ENABLE_BANKING_API = "https://api.enablebanking.com";
  export type EbFailure = "unauthorized" | "refused" | "not_found" | "unreachable";
  export type EbResult<T> = { ok: true; data: T } | { ok: false; failure: EbFailure; status: number };
  export type EbClient = {
    maxConsentDays(): Promise<EbResult<number>>;                                                     // GET /aspsps?country=NL → ING's maximum_consent_validity in days
    startAuth(input: { validUntil: string; redirectUrl: string; state: string }): Promise<EbResult<{ url: string }>>;  // POST /auth, aspsp { name: "ING", country: "NL" }, psu_type "business"
    createSession(code: string): Promise<EbResult<{ sessionId: string; validUntil: string; accounts: { uid: string; iban: string | null }[] }>>;
    transactions(accountUid: string, dateFrom: string): Promise<EbResult<CamtLine[]>>;               // follows continuation_key
    balance(accountUid: string): Promise<EbResult<{ date: string; cents: number } | null>>;          // closingBooked, else interimBooked
  };
  export function enableBankingFor(env: Env): EbClient | null;   // null without app id or key
  export async function signJwt(appId: string, pem: string, now: Date): Promise<string>;   // RS256, header kid = appId, iss "enablebanking.com", aud "api.enablebanking.com", iat, exp = iat + 3600
  ```
  Mapping a transaction: `entry_reference` (else `transaction_id`) → `bankRef`; `booking_date`; `transaction_amount.amount` with `credit_debit_indicator` `DBIT` negative; counterparty `debtor`/`debtor_account.iban` for a credit, `creditor`/`creditor_account.iban` for a debit; `remittance_information` joined. Check the field names against the API reference (enablebanking.com/docs/api/reference) while writing; the fake follows what the reference says. Same failure mapping and timeout (8 s) as `worker/lib/mollie.ts`; `ENABLE_BANKING_API_BASE` only for a local host.
  Fake: verifies the JWT signature with the public half of the test key, answers `/aspsps`, `/auth` (url `https://fake.enablebanking.test/auth?state=…`), `/sessions`, `/accounts/:uid/transactions` (pages of 2 with `continuation_key`), `/accounts/:uid/balances`; `expireSession()`, `failNext(...)`.
- Produces in `test/helpers.ts`: `export async function testRsaKey(): Promise<{ pem: string; publicKey: CryptoKey }>` (generated once per file with `crypto.subtle.generateKey`, exported as PKCS#8 PEM; never written to disk).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("signs its requests with the application's key", …)          // fake accepts; JWT header kid = app id; exp − iat = 3600
  it("asks ING for consent with the longest validity allowed", …) // body.aspsp = { name: "ING", country: "NL" }, psu_type "business"
  it("reads every page of transactions as bank lines", …)          // 5 transactions over 3 pages → 5 CamtLine with the right signs and parties
  it("tells a refusal from no answer", …)                          // 401 unauthorized, 422 refused, 500/timeout unreachable
  it("has no client without the key", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): an Enable Banking client with a signed JWT, and a fake for the tests`

---

### Task 13: Connecting ING, the nightly fetch and the consent running out

**Files:**
- Create: `migrations/0007_bank_consent.sql`, `worker/db/bank-consent.ts`, `test/bank-consent.test.ts`, `src/beheer/boekhouding/BankReturnPage.tsx` (+ test)
- Modify: `worker/routes/admin-ledger-bank.ts`, `worker/nightly.ts` (step `ing`), `worker/db/ledger-reports.ts` (`overview.consent`), `src/routes.tsx` (`/beheer/bank` → `BankReturnPage`, inside `BeheerLayout`), `SettingsLedgerPage.tsx` (block "ING automatisch")

**Interfaces:**
- Table `bank_consents(id PK, state UNIQUE, status pending|active|expired|replaced, session_id, account_uid, valid_until, created_at, used_at)`.
- Produces:
  ```ts
  export type ConsentState = { status: "none" | "pending" | "active" | "expired"; validUntil: string | null; daysLeft: number | null };
  export async function startConsent(env: Env, origin: string, now: Date): Promise<{ url: string }>;   // redirectUrl = `${origin}/beheer/bank`
  export async function finishConsent(env: Env, input: { code: string; state: string }, now: Date): Promise<ConsentState>;
  export async function consentState(db: D1Database, now: Date): Promise<ConsentState>;
  /** Nightly: new lines and the balance of 1010, when its source is enable_banking and the consent is active. */
  export async function fetchIng(env: Env, now: Date): Promise<"ok" | "skipped" | string>;
  ```
  Routes: `GET /bank/ing`, `POST /bank/ing/connect` → `{ url }`, `POST /bank/ing/callback` `{ code, state }`.
  - `finishConsent` (Review Focus 4): the state must belong to a `pending` consent made less than 30 minutes ago and not used; otherwise `state_invalid` 409 and nothing changes. It is marked used before the session is made. The account whose IBAN equals the identifier of 1010 (spaces and case ignored) is kept; none → `account_not_in_consent` 409. A new active consent marks the old one `replaced`.
  - `fetchIng` asks from the newest stored booking date of 1010 minus 7 days (or `LEDGER_START`), imports with origin `enable_banking`, runs `autoBook`, records the balance. A `401`/`unauthorized` marks the consent `expired`.
  - Overview: `consent.daysLeft`; the beheer Overzicht and the dashboard warn from 14 days before ("De toestemming van ING verloopt over … dagen. Vernieuwen") and after expiry ("ING haalt geen regels meer op: toestemming verlopen. Vernieuwen of upload een bankbestand.").
  - `BankReturnPage` reads `code`, `state` (or `error`) from the address, posts once, then shows the result with a link back to Instellingen; a refused state shows "Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen."

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("sends the penningmeester to ING and back to /beheer/bank", …)
  it("connects ING betaal when the bank sends him back", …)                // active, validUntil from the session
  it("refuses the return page a second time, and keeps the connection", …)// second callback → 409 state_invalid; still active, one session
  it("refuses a state it did not make, or an old one", …)                  // unknown → 409; 31 minutes → 409
  it("refuses a consent without the ING betaal account", …)
  it("fetches new lines at night and books kasstortingen", …)              // fake transactions → bank_lines origin enable_banking; kasstorting booked
  it("fetches nothing when 1010 is set to files", …)                       // "skipped"
  it("notices that the consent ran out", …)                                // fake expireSession → status expired, step code "consent_expired"
  it("warns two weeks before the consent ends", …)                         // overview.consent.daysLeft 14
  ```
  and in `BankReturnPage.test.tsx`: `it("finishes the connection once, also when the page is opened again", …)`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): ING automatically via Enable Banking, with a warning before the consent ends`

---

## Stap 4: Mollie

### Task 14: Mollie with the organisation token, read only

**Files:**
- Create: `worker/lib/mollie-read.ts`, `test/mollie-read.test.ts`
- Modify: `test/fake-mollie.ts` (payments of other methods, refunds, chargebacks, settlements, balances; accepts `Bearer org_fake` for these), `worker/env.ts` (`MOLLIE_ORG_TOKEN?: string`), `test/env.d.ts`

**Interfaces:**
- Consumes: `MollieResult`, `MollieFailure`, `MOLLIE_API` from `worker/lib/mollie.ts` (unchanged).
- Produces:
  ```ts
  export type MolliePaymentRow = { id: string; method: string; amountCents: number; description: string; status: string; paidAt: string | null; settlementId: string | null };
  export type MollieRefundRow = { id: string; paymentId: string; amountCents: number; createdAt: string; description: string };
  export type MollieChargebackRow = { id: string; paymentId: string; amountCents: number; createdAt: string };
  export type MollieSettlementRow = { id: string; reference: string; status: string; settledAt: string | null; amountCents: number; costsCents: number };
  export type MollieRead = {
    paymentsSince(fromIso: string): Promise<MollieResult<MolliePaymentRow[]>>;
    refundsSince(fromIso: string): Promise<MollieResult<MollieRefundRow[]>>;
    chargebacksSince(fromIso: string): Promise<MollieResult<MollieChargebackRow[]>>;
    settlementsSince(fromIso: string): Promise<MollieResult<MollieSettlementRow[]>>;
    primaryBalance(): Promise<MollieResult<{ availableCents: number; pendingCents: number }>>;
  };
  export function mollieReadFor(env: Env): MollieRead | null;   // null without MOLLIE_ORG_TOKEN
  ```
  Lists page with `limit=250` and `from=` newest first and stop at the first item older than `fromIso`. `costsCents` is the sum of `amountGross` of every `periods.*.*.costs[]` (the vereniging cannot reclaim VAT, so gross is the cost). Settlement `amount` may be negative. Check against docs.mollie.com while writing: whether payments and refunds lists need `profileId` with an organisation token (if so, read it once from `GET /v2/profiles` and keep it in settings `mollie_profile_id`), and the exact shape of `periods` and `costs`. Do not use `settlementAmount` (removed by Mollie on 1 January 2027).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("reads payments of every method since a moment", …)       // ideal + pointofsale; stops at fromIso
  it("adds up a payout's costs from its periods", …)            // two periods, costs gross 1,88 + 0,29 → 217
  it("reads refunds and chargebacks", …)
  it("reads the balance", …)
  it("tells a refusal from no answer, as the kassa's client does", …)
  it("has no client without the organisation token", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): read payments, payouts and the balance from Mollie with a read-only token`

---

### Task 15: Mollie payments on 1030: the kassa's ticked off, the rest by rule or in Te boeken

**Files:**
- Create: `migrations/0008_mollie_ledger.sql`, `migrations/0009_mollie_rules_seed.sql`, `worker/db/mollie-ledger.ts`, `worker/routes/admin-ledger-mollie.ts`, `test/mollie-ledger.test.ts`
- Modify: `worker/nightly.ts` (step `mollie`), `worker/app.ts`, `SettingsLedgerPage.tsx` (block "Regels voor Mollie")

**Interfaces:**
- Tables: `mollie_payments(id PK, method, amount_cents, description, paid_date, settlement_id, kind kassa|rule|line, account_code, bank_line_id)`, `mollie_settlements(id PK, reference UNIQUE, status, settled_at, amount_cents, costs_cents)`, `mollie_rules(id PK, keyword, account_code, sort)`. Seed (0009): `dagkaart` and `dagticket` → 8012; `lidm`, `lidmaatschap`, `verl` → 8000; `reserver`, `verhuur` → 8010 (spec §11 table).
- Produces:
  ```ts
  export type MollieRule = { id: string; keyword: string; accountCode: string };
  export async function syncMolliePayments(env: Env, now: Date): Promise<"ok" | "skipped" | string>;
  export async function listRules(db: D1Database): Promise<MollieRule[]>;
  export async function saveRule(db: D1Database, rule: Omit<MollieRule, "id"> & { id?: string }): Promise<MollieRule>;
  export async function deleteRule(db: D1Database, id: string): Promise<void>;   // a rule is settings, not bookkeeping: deleting is allowed
  ```
  - Paid payments since the newest stored `paid_date` minus 3 days (or `LEDGER_START`): `id` equal to a `sales.mollie_payment_id` → kind `kassa` (already in the kassa day; only remembered). Else the first rule whose keyword is in the description (case ignored) → kind `rule`. Else → a bank line on 1030 (origin `mollie`, `bankRef` = payment id, amount positive) for Te boeken.
  - Per `paid_date` with rule payments: `upsertSourced` source `mollie_other`, ref = date, description "Mollie overig {d-m-jjjj}": debit 1030 the total, credit per account. A `paid_date` in a closed year → dated 1 January of the first open year, ref `late:{date}`.
  - Refunds and chargebacks of a non-kassa payment → a bank line on 1030 with a negative amount (`bankRef` = refund or chargeback id). Of a kassa payment → nothing (the kassa's reversal books it; a missing reversal shows in Task 16's comparison).
  - The step also records `primaryBalance()` as the balance of 1030 on yesterday's Amsterdam date.
  - Routes: `GET/POST /mollie/rules`, `DELETE /mollie/rules/:id`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("ticks off the kassa's pin payments without booking them again", …)
  it("books day tickets, memberships and rentals per day by rule", …)       // "Burcht ter Cleeff - 2x dagkaartje" 1,20; "Lidm. Speeltuin ter Cleefte" 32,00; "Verhuur reservering" 40,00 → one entry: 1030 +7320, 8012 -120, 8000 -3200, 8010 -4000
  it("puts a payment that fits no rule in Te boeken", …)
  it("puts a refund of a website payment in Te boeken", …)                  // -32,00 on 1030
  it("leaves a closed year alone and books late payments on 1 January", …)
  it("reads each payment once, also when the night runs twice", …)
  it("lets the penningmeester change the rules", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): Mollie payments of the website and the QR code booked by rule`

---

### Task 16: Payouts on ING, Mollie's costs and the comparison

**Files:**
- Modify: `worker/db/mollie-ledger.ts`, `worker/db/bank.ts` (`autoBook` also books payouts), `worker/routes/admin-ledger-mollie.ts`, `worker/db/ledger-reports.ts` (`overview.mollieDifferenceCents`)
- Create: `test/mollie-payouts.test.ts`, `src/beheer/boekhouding/MolliePage.tsx` (+ test)

**Interfaces:**
- Produces:
  ```ts
  export async function syncSettlements(env: Env, now: Date): Promise<"ok" | "skipped" | string>;   // part of the nightly step mollie, then autoBook
  export type MollieMonth = { month: string; kassaPinCents: number; molliePosCents: number; onlyInKassa: { saleId: string; date: string; amountCents: number }[]; onlyAtMollie: { paymentId: string; date: string; amountCents: number }[]; otherByAccount: { accountCode: string; cents: number }[]; costsCents: number; balance: { ledgerCents: number; mollieCents: number | null; differenceCents: number | null } };
  export async function mollieMonth(db: D1Database, month: string): Promise<MollieMonth>;
  ```
  - A credit on 1010 whose description holds a payout reference (`/\b\d{7,8}\.\d{4}\.\d{2}\b/`, e.g. `05665564.2611.01`) is a payout (Review Focus 5). Known payout with the same amount → entry source `mollie_settlement`, ref = settlement id: debit 1010 the amount, debit 4511 the costs, credit 1030 amount + costs; the line is booked. Unknown payout → status `waiting`, `waitingFor: "mollie"`. Known payout with another amount → stays `open`, note "Bedrag wijkt af van de uitbetaling bij Mollie (€ …)".
  - `GET /mollie/month?month=` answers `MollieMonth`. The page shows the month with Vorige/Volgende maand, pin in the kassa against pin at Mollie, the lists of differences, the other payments per account, the costs, and the balance check ("Saldo bij Mollie € …, in de boekhouding € …").

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("books a payout on ING with Mollie's costs", …)                       // payout 98,12 costs 1,88 → 1010 +9812, 4511 +188, 1030 -10000
  it("waits for Mollie when the payout is not known yet, then books it", …) // waiting → after syncSettlements → booked
  it("never books a payout whose amount differs", …)
  it("books one payout once, also when the night runs twice", …)
  it("compares the kassa's pin with Mollie's, payment by payment", …)       // a paid pin sale whose payment is missing at Mollie → onlyInKassa
  it("keeps 1030 equal to Mollie's balance", …)                             // after kassa day + rule day + payout: ledger 1030 == available + pending
  ```
  and `MolliePage.test.tsx`: `it("shows the month's pin, the differences and the balance", …)`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): Mollie payouts booked with their costs, and the monthly comparison`

---

## Stap 5: speeltoestellen

### Task 17: The depreciation rule

**Files:**
- Create: `shared/depreciation.ts`, `shared/depreciation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DepreciableAsset = { purchaseDate: string; costCents: number; residualCents: number; lifeYears: number; disposedOn: string | null };
  /** What to write off in `year`, given what was written off before it. Spec §12. */
  export function depreciationFor(asset: DepreciableAsset, year: number, writtenOffBeforeCents: number): number;
  ```
  Rule: `annual = round((cost − residual) / lifeYears)`. Months that count in `year`: 12; in the purchase year from the purchase month (July → 6); in the disposal year up to and including the disposal month; both in one year → the months between, inclusive; none before purchase or after disposal. `amount = round(annual × months / 12)`, never more than `cost − residual − writtenOffBefore`, never below 0.

- [ ] **Step 1: Write the failing tests** with the figures of "Vaste activa 2026" (spec §12):
  ```ts
  it("goes on as e-Boekhouden did", () => {
    expect(depreciationFor({ purchaseDate: "2008-01-01", costCents: 949600, residualCents: 0, lifeYears: 20, disposedOn: null }, 2027, 902120)).toBe(47480);   // Straaljager
    expect(depreciationFor({ purchaseDate: "2008-01-01", costCents: 949600, residualCents: 0, lifeYears: 20, disposedOn: null }, 2028, 949600)).toBe(0);
    expect(depreciationFor({ purchaseDate: "2012-07-10", costCents: 4445721, residualCents: 200000, lifeYears: 20, disposedOn: null }, 2027, 3072928)).toBe(212286);  // Dome - Kopan
    expect(depreciationFor({ purchaseDate: "2024-05-01", costCents: 584430, residualCents: 292215, lifeYears: 20, disposedOn: null }, 2027, 38962)).toBe(14611);   // Banken
  });
  it("writes off only what is left in the last year", …)       // Poort deel 1: 395700, 10 years, before 395375 → 325
  it("counts months in the year of purchase", …)               // 2027-07-15, 1.200.000, 20 years → 2027: 30000; 2028: 60000
  it("stops at the month of disposal", …)                      // disposed 2028-03-20 → 2028: 15000; 2029: 0
  it("never goes below the residual value", …)
  ```
- [ ] **Step 2–4:** `npm run test:client -- shared/depreciation.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): the depreciation rule, as e-Boekhouden applied it`

---

### Task 18: Speeltoestellen: paste from e-Boekhouden, buy, depreciate, dispose

**Files:**
- Create: `migrations/0010_assets.sql`, `shared/asset-paste.ts`, `shared/asset-paste.test.ts`, `worker/db/assets.ts`, `worker/routes/admin-ledger-assets.ts`, `test/assets.test.ts`, `src/beheer/boekhouding/AssetsPage.tsx` (+ test)
- Modify: `worker/db/opening.ts` (0130 and 0135 come from the asset list once it has rows), `worker/db/bank.ts` (`bookLine` with `assetId`, or a new asset), `ToBookPage.tsx` ("Nieuw toestel" when 0130 is chosen), `worker/app.ts`

**Interfaces:**
- Table `assets(id PK, name, purchase_date, cost_cents, residual_cents, life_years, opening_written_off_cents, disposed_on, created_at)`.
- Produces in `shared/asset-paste.ts`:
  ```ts
  export type PastedAsset = { name: string; purchaseDate: string; costCents: number; writtenOffCents: number; lifeYears: number };
  /** The table "Vaste activa {jaar}" copied from e-Boekhouden: tab-separated, dates d-m-jjjj, amounts 1.234,56. Header, group and total rows are skipped. */
  export function parseAssetPaste(text: string): { assets: PastedAsset[]; skipped: string[] };
  ```
  Columns used: 1 name, 2 purchase date, 5 cost per 31-12, 10 written off up to and including 31-12, 12 years.
- Produces in `worker/db/assets.ts`:
  ```ts
  export type Asset = { id: string; name: string; purchaseDate: string; costCents: number; residualCents: number; lifeYears: number; writtenOffCents: number; bookValueCents: number; disposedOn: string | null };
  export async function listAssets(db: D1Database, upTo: string): Promise<Asset[]>;
  export async function addPastedAssets(db: D1Database, assets: PastedAsset[], now: Date): Promise<Asset[]>;   // opening assets; refused once the year 2027 has a depreciation entry
  export async function saveAsset(db: D1Database, input: Partial<Asset> & { id?: string }, now: Date): Promise<Asset>;
  export type DepreciationPlan = { year: number; rows: { assetId: string; name: string; cents: number }[]; totalCents: number; booked: boolean };
  export async function depreciationPlan(db: D1Database, year: number): Promise<DepreciationPlan>;
  export async function bookDepreciation(db: D1Database, year: number, now: Date): Promise<Entry>;      // source depreciation, ref = year, dated `${year}-12-31`: per asset a 0135 line with assetId, one 4601 line
  export async function disposeAsset(db: D1Database, id: string, date: string, now: Date): Promise<Entry>; // rebooks the year's depreciation up to that month, then source disposal, ref = asset id: debit 0135 all written off, debit 4601 the book value left, credit 0130 the cost
  ```
  A bought asset's cost is the sum of its 0130 lines; its purchase date is the date of its first 0130 line. Routes: `GET /assets`, `POST /assets/paste`, `POST /assets`, `PATCH /assets/:id`, `POST /assets/:id/dispose`, `GET /depreciation?year=`, `POST /depreciation` `{ year }`.
  Page "Toestellen": the list (name, aankoopdatum, aanschafwaarde, restwaarde, levensduur, afgeschreven, boekwaarde), "Plakken uit e-Boekhouden" (a text area; shows what it read and what it skipped before "Overnemen"), restwaarde editable, "Afschrijving {jaar} boeken" with the rows, "Afvoeren".

- [ ] **Step 1: Write the failing tests:**
  ```ts
  // shared/asset-paste.test.ts, with rows copied from the penningmeester's paste of 23 November 2026
  it("reads the rows of Vaste activa 2026", …)        // Straaljager → { purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 }; Dome - Kopan → 4445721, 3072928, 20
  it("skips the header, the group row and the totals", …)
  // test/assets.test.ts
  it("takes the pasted list into the opening balance", …)       // 0130 = Σ cost, 0135 = −Σ written off; equity recomputed
  it("books the year's depreciation per asset", …)              // Straaljager + Dome → 4601 +259766, 0135 lines −47480 and −212286
  it("replaces the depreciation when booked again", …)          // one entry for 2027
  it("makes an asset from a bank line booked on 0130", …)
  it("disposes of an asset with what was left of its value", …)
  it("refuses to change the depreciation of a closed year", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): speeltoestellen from e-Boekhouden, with yearly depreciation and disposal`

---

## Stap 6: het jaar

### Task 19: Closing and reopening a year

**Files:**
- Create: `worker/db/year.ts` (checks, close, reopen), `worker/routes/admin-ledger-year.ts`, `test/year.test.ts`, `src/beheer/boekhouding/YearPage.tsx` (+ test)
- Modify: `worker/app.ts`

**Interfaces:**
- Produces:
  ```ts
  export type YearCheck = { key: "bank_lines" | "bank_balances" | "cash" | "mollie" | "depreciation" | "in_transit"; ok: boolean; detail: string; required: boolean };
  export async function yearChecks(env: Env, year: number, now: Date): Promise<YearCheck[]>;
  export async function closeYear(env: Env, year: number, note: string | null, now: Date): Promise<void>;
  export async function reopenYear(db: D1Database, year: number, reason: string, now: Date): Promise<void>;
  ```
  - Checks as spec §13: `bank_lines` (no open or waiting line dated in the year; required), `bank_balances` (per money account with a bank balance on or before 31 December: equal to the ledger on that date), `cash` (1000 equals `expectedCashAt` of 31 December 23:59 Amsterdam), `mollie` (1030 equals the Mollie balance recorded for 31 December), `depreciation` (a `depreciation` entry for the year when there are assets), `in_transit` (1080 is 0).
  - `closeYear` refuses `checks_failed` 409 when a required check fails, and `note_required` 400 when another fails and the note is empty. It writes source `closing`, ref = year, dated 31 December: per income and expense account minus its sum for the year (without closing), and 1400 the result; sets the year `closed`; creates the next year `open` when missing; adds a `ledger_year_events` row. Balance accounts carry on by themselves (balances add up over the years), so the next year's opening needs no entry.
  - `reopenYear` needs a reason (at least 3 characters): empties the closing entry through the sync path, sets the year `open`, adds an event. Only the newest closed year can be reopened (`not_newest` 409).
  - Routes: `GET /year/:year/checks`, `POST /year/:year/close` `{ note? }`, `POST /year/:year/reopen` `{ reason }`.
  - Page "Jaar": per year its status, the checks with a tick or the detail, "Jaar afsluiten" (asks for a note when needed), "Heropenen" with a reason, links to Beginbalans, Vergelijkingscijfers, Afschrijving and the Jaaroverzicht.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("will not close while bank lines are open", …)
  it("closes with a note when only a balance check fails", …)
  it("books the result to equity and keeps the result report as it was", …)  // resultReport(2027) unchanged; balance 1400 += result; income/expense balances 0 from 2028
  it("carries the balance into the next year", …)                           // balanceReport("2028-01-01") equals balanceReport("2027-12-31") with result in 1400
  it("changes nothing in a closed year", …)                                 // createEntry/editEntry/bookLine/attachments → year_closed
  it("reopens the newest closed year with a reason, and only that one", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit.** `feat(boekhouding): close a year after the checks, and reopen it with a reason`

---

### Task 20: Jaaroverzicht: Excel, PDF and the attachments

**Files:**
- Modify: `worker/db/year.ts` (`yearExport`), `worker/routes/admin-ledger-year.ts`, `src/beheer/boekhouding/YearPage.tsx`, `package.json` (an Excel library and `fflate`)
- Create: `src/beheer/boekhouding/year-export.ts` (+ test), `src/beheer/boekhouding/PrintYearPage.tsx` (+ test), `test/year-export.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type YearExport = { year: number; status: "open" | "closed"; opening: BalanceReport; closing: BalanceReport; result: ResultReport; checks: YearCheck[]; events: { at: string; kind: "closed" | "reopened"; note: string | null }[]; assets: Asset[]; depreciation: DepreciationPlan; entryCount: number };
  export async function yearExport(env: Env, year: number, now: Date): Promise<YearExport>;
  ```
  Routes: `GET /year/:year/export` (`YearExport`) and `GET /year/:year/entries?after=&limit=500` (entries with lines, attachments and `changed`, by number, paged so one request stays within the CPU limit), `GET /year/:year/changes?after=` (history).
  In the browser (`year-export.ts`): `buildWorkbook(data, entries, changes): Promise<Blob>` with sheets "Balans", "Winst en verlies", "Boekingen", "Grootboek", "Speeltoestellen", "Controles", "Wijzigingen"; `buildAttachmentsZip(entries, fetchAttachment): Promise<Blob>` with file names `{number}-{n}-{filename}`. Both libraries are loaded with `import()` only when the button is pressed, so neither the kassa nor other beheer pages grow. `PrintYearPage` (`/beheer/boekhouding/jaar/:year/afdruk`) shows the balance and the result for printing; the button "PDF" opens it and calls `window.print()` ("Bewaar als PDF" in the print dialog). An open year says "Voorlopig" on every sheet and on the print.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("gives the year's figures for the overview", …)                            // test/year-export.test.ts
  it("pages the entries so a large year still fits", …)                          // 1.200 entries → 3 pages; meteredDb rows per page ≤ 2.000
  it("writes every sheet, with Voorlopig for an open year", …)                   // year-export.test.ts: workbook sheet names; cell A1
  it("names each attachment after its entry number", …)                         // zip entries "12-1-bon-goodoo.pdf"
  it("prints the balance and the result", …)
  ```
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS). Check with `npm run build` that the kassa's bundle (`dist/client/assets/index-*.js`) does not hold the Excel or zip library.
- [ ] **Step 5: Commit.** `feat(boekhouding): the jaaroverzicht as Excel, PDF and a zip of the attachments`

---

### Task 21: End to end and the handbook

**Files:**
- Create: `e2e/boekhouding.spec.ts`
- Modify: `README.md`, `.dev.vars.example` (three empty lines with a warning, as for `MOLLIE_API_KEY`: `ENABLE_BANKING_APP_ID=`, `ENABLE_BANKING_PRIVATE_KEY=`, `MOLLIE_ORG_TOKEN=`), `e2e/setup.ts` if needed

**Interfaces:**
- `e2e/boekhouding.spec.ts`, WebKit, own empty database as the other e2e files:
  ```ts
  test("books a bank file and shows it in the result", …)
  // log in → Boekhouding → Instellingen: 1011 kenmerk V00000000 → Beginbalans 1011 € 10.883,45 → Te boeken: upload a made-up file with rente € 144,02 on 2027-01-02 → Boeken on 8030 → Rapporten: 8030 Rente € 144,02 → Overzicht: no balance difference for 1011
  ```
- README (Dutch, plain, as the existing handbook): a section "Boekhouding" for the penningmeester (what is where; elke maand en elk kwartaal; bankbestanden downloaden bij ING Zakelijk en ASN; ING automatisch en de toestemming vernieuwen; kasstorting; regels voor Mollie; toestellen en afschrijving; het jaar afsluiten en het jaaroverzicht bewaren voor 7 jaar), and for the builder: the three secrets with the commands below, the bucket, the crons, the migrations 0005–0010, what the weekly copy now holds and that the attachments are not in it.

  ```bash
  npx wrangler secret put ENABLE_BANKING_APP_ID --name kassa-burcht-ter-cleeff
  ```
  ```bash
  npx wrangler secret put ENABLE_BANKING_PRIVATE_KEY --name kassa-burcht-ter-cleeff < pad/naar/het-bestand.pem
  ```
  ```bash
  npx wrangler secret put MOLLIE_ORG_TOKEN --name kassa-burcht-ter-cleeff
  ```

- [ ] **Step 1: Write the e2e test.** Run `npm run e2e -- e2e/boekhouding.spec.ts`. Expected: PASS (the features exist; this guards them).
- [ ] **Step 2: Write the handbook.**
- [ ] **Step 3: Run everything.** `npm test`, `npm run typecheck`, `npm run e2e`. Expected: all green.
- [ ] **Step 4: Commit.** `docs(boekhouding): the handbook, and one walk through it end to end`

---

### Task 22: Online, step by step (prepare; each step needs the penningmeester's yes or is his own)

**Files:**
- Modify: `docs/superpowers/plans/2026-11-23-boekhouding.md` (tick what was done, with dates), spec §19 (what the live checks answered)

- [ ] **Step 1: Bring the branch up to date.** Merge the newest `main` into this branch; run `npm test`, `npm run typecheck`, `npm run e2e`.
- [ ] **Step 2: Ask** the penningmeester, in plain Dutch, for his yes to: create the R2 bucket `boekhouding-bijlagen` (`npx wrangler r2 bucket create boekhouding-bijlagen`), apply migrations 0005–0010 to the live database (note the UTC time first, for Time Travel), and deploy. Do each only after his yes.
- [ ] **Step 3: His own steps** (handbook): the three secrets; fixing the application's name at Enable Banking; the Mollie organisation token (Developers → API keys, read rights for payments, refunds, settlements, balances); ING koppelen in beheer.
- [ ] **Step 4: Live checks of spec §19**, with his yes for each call against the live services: whether the € 0,60 pin payment of 21 November 2026 appears in a payout; how the payout reference appears on the ING line (adjust the pattern of Task 16 if needed, with a test first); which `psu_type` ING Zakelijk accepts and how far back the first fetch reaches; whether the CAMT files of ING betaal and ASN carry a reference per line.
- [ ] **Step 5: Commit** the notes.
