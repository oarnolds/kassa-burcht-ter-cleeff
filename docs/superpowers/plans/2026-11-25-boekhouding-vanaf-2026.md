# Boekhouding vanaf 1 januari 2026: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The books start on 1 January 2026. Everything up to and including 24 November 2026 is read in from e-Boekhouden's auditfile (`.xaf`), one entry per booking. From the switch on, the app books the bank and Mollie itself; the kassa it books from its first day, 21 November 2026.

**Architecture:** `LEDGER_START` becomes 2026-01-01. Two new dates sit next to it: `OVERSTAP` (2026-11-25), where bank lines start, and `MOLLIE_START` (2026-11-01), where Mollie payments start. The browser reads the auditfile with `DOMParser`, as it does a CAMT file. It maps the old accounts to the app's, and sends the opening and the entries to the Worker in small requests. The Worker writes them as entries with the new source `eboekhouden`. Until that import is finished, the app books nothing in 2026 by itself. The opening then gets the first number of 2026, and Mollie knows which payouts e-Boekhouden already has.

**Tech Stack:** As the boekhouding plan of 23-11 (TypeScript, React 19, Hono, D1, zod 4, Vitest with `@cloudflare/vitest-plugin`, Testing Library). Nothing new.

**Spec:** `docs/superpowers/specs/2026-11-25-boekhouding-vanaf-2026-design.md` (Dutch, approved 25 November 2026). It changes `docs/superpowers/specs/2026-11-23-boekhouding-design.md`. The builder's earlier decisions are in `docs/superpowers/plans/2026-11-23-boekhouding-besluiten.md`.

**Scope:** Spec §6 to §13 and the handbook. Going online (spec §15) is prepared in Task 10. Each live step needs the penningmeester's yes.

## Global Constraints

- Everything in the Global Constraints of `docs/superpowers/plans/2026-11-23-boekhouding.md` still holds, except the line about `LEDGER_START`. In particular:
  - Dutch UI copy and English `snake_case` error codes;
  - integer cents and `Europe/Amsterdam` business dates;
  - lines sum to 0;
  - nothing in a closed year changes, and nothing is deleted;
  - the boekhouding never writes the kassa's tables, and nothing changes on the iPad;
  - Cloudflare free plan limits: about 10 ms CPU and 50 database calls per request (a batch is one call);
  - TDD, never push, no merge, no deploy, no remote migration without the penningmeester's yes;
  - commits end with the executing session's `Co-Authored-By:` line.
- Dates (`shared/ledger-types.ts`):
  - `LEDGER_START = "2026-01-01"`: the first day of the books;
  - `OVERSTAP = "2026-11-25"`: the first day of bank lines in the app;
  - `MOLLIE_START = "2026-11-01"`: the first day of Mollie payments, refunds and chargebacks in the app;
  - kassa days and handovers start at `later(ingebruikname, LEDGER_START)`, the formula `syncKassa` already uses.
- **The auditfile holds personal data.** Never commit it, copy it into the repo, quote its descriptions or names, or put it in a fixture or a test. Tests use a made-up file in `shared/fixtures/xaf-2026.ts`, with invented names. A builder may read the real file only on this Mac, to check totals:
  - path: `~/Downloads/1019013_0b6556b1edde46ef911ea069ec585459.xaf`;
  - only in the browser, or with `python3 -I` and the script in the scratchpad;
  - report counts and amounts only;
  - remove any copy afterwards.

  Add `*.xaf` to `.gitignore` in Task 1.
- What the real file of 25 November 2026 holds (amounts only, checked on 25 November 2026). Use these values to check the result on the real file, never in a test:
  - 312 transactions, 632 lines, every transaction balanced;
  - opening lines sum to −11.465,95 (the opening does not balance; equity is the balancing line);
  - 1400 in the opening: −246.629,12;
  - 1010 at the end of 24-11: 21.734,49;
  - 1000 and 1080 at the end of 24-11: 0;
  - 1300 and 1700 at 24-11: 0;
  - no lines on 0130 or 4601; one memoriaal 0800 → 0135 of 73,70;
  - seven transactions in journal 1012 (Revolut);
  - Mollie payout references in ING descriptions; the last one is dated 2026-11-02.
- Old accounts with a fixed mapping, everything else through `formerly` in `shared/accounts.ts`:
  - `0800 → 0135`;
  - `1012 → 1080`. Revolut stays out of the app, by the penningmeester's wish;
  - `0801` and `9998` → none. Allowed only while all their amounts are 0.
- Accounts that may not carry an imported line: `0130`, `0135`, `4601`. A line on them that is not cancelled by the mapping blocks "Overnemen". Kassa accounts to warn about: `8011` and `8012`, from the kassa's `in_use_since` date up to 24-11.
- Payout reference: `PAYOUT_REFERENCE = /\b\d{7,8}\.\d{4}\.\d{2}\b/`. Move it from `worker/db/bank.ts` to `shared/ledger-types.ts` and use it in both places.

## Review Focus

Conditions the spec implies but no task's main tests cover, most likely first. Each has a pinning test in the task named.

1. **The same file is read in twice, or again after a correction in e-Boekhouden.** Nothing is doubled. A changed booking gets one history row. A booking gone from the file is emptied, not deleted. The opening is replaced. Task 5.
2. **The nightly run or "Nu bijwerken" runs before the import is done.** Nothing is booked in 2026 by the app. Bank lines are still stored. After the import, the kassa days from 21-11 and the waiting bank lines are booked, with numbers after the imported entries. Task 2.
3. **The migration runs on the live database with entries in it.** Every row, id, number, `UNIQUE (year, number)`, `UNIQUE (source, source_ref)`, index and foreign key survives. The new source is accepted. Task 3.
4. **Mollie's payout of 2-11-2026 (in e-Boekhouden) and the first payout the app books (December).** The first is not counted as in transit and not booked again. The second is booked with its costs on 4511. Task 7.
5. **A request carrying the largest chunk of entries.** It stays within 50 database calls (use `meteredDb`). A chunk of 40 entries with 4 lines each passes; 41 entries are refused with `too_many`. Task 5.

---

### Task 1: The three dates

**Files:**
- Modify: `shared/ledger-types.ts`, `worker/db/bank.ts`, `worker/db/bank-consent.ts`, `worker/db/mollie-ledger.ts`, `worker/db/ledger.ts` (comment on `openYear`), `.gitignore`
- Test: `test/bank-import.test.ts`, `test/bank-consent.test.ts`, `test/mollie-ledger.test.ts`, `test/kassa-ledger.test.ts`, plus every existing test that assumed 2027 is the first year

**Interfaces:**
- Produces:
  ```ts
  export const LEDGER_START = "2026-01-01";
  /** The first day of bank lines in the app; before it the bank is in e-Boekhouden's auditfile. */
  export const OVERSTAP = "2026-11-25";
  /** The first day of Mollie payments, refunds and chargebacks in the app; earlier ones are in payouts e-Boekhouden booked. */
  export const MOLLIE_START = "2026-11-01";
  export const PAYOUT_REFERENCE: RegExp;
  ```
- Where each date goes:
  - `OVERSTAP`:
    - `importLines`: `kept` and `beforeStart`;
    - `addTypedLine`: `before_start`;
    - `autoBook`: the `booking_date >= ?1` floor;
    - `fetchIng`: the floor of `from`.
  - `MOLLIE_START`:
    - `syncMolliePayments`: the `from` floor and the `paidDate` filter;
    - the reversals filter at `mollie-ledger.ts:332`.
  - `FIRST_PAYOUT_DATE` becomes `"2026-10-01"`, so the payout of 2-11 is known.
  - `LEDGER_START` stays at:
    - years, reports, opening, assets, budget, year;
    - `FIRST_BALANCE_DATE` and `FIRST_OPENING_REF` in `bank.ts`;
    - `kassa-ledger.ts`.
  - `LEDGER_START_MOMENT` in `payoutsInTransitStatement` changes in Task 7.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("skips bank lines before the overstap and counts them", …)   // lines 2026-11-24 and 2026-11-25 → added 1, beforeStart 1
  it("refuses a typed bank line before the overstap", …)          // date 2026-11-24 → "before_start" 400
  it("asks ING from the overstap on", …)                          // no lines yet → first window date_from 2026-11-25
  it("keeps Mollie payments from 1 November 2026 on", …)          // paid 2026-10-31 and 2026-11-01 → one stored
  it("books kassa days from the ingebruikname in 2026", …)        // in_use_since 2026-11-21, a paid sale that day → entry "Kassa 21-11-2026"
  ```
  (The kassa test passes only once Task 2's gate is open; give it the gate open in its setup: `ledger_settings` key `eboekhouden_imported_at`.)
- [ ] **Step 2: Run them.** `npm run test:worker -- test/bank-import.test.ts test/bank-consent.test.ts test/mollie-ledger.test.ts test/kassa-ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Change the constants and their uses as listed. Run the whole worker suite. Fix every test that assumed 2027 is the first year, by moving its dates or its expectation. Change no other behaviour. Add `*.xaf` to `.gitignore`, with the comment `# e-Boekhouden auditfiles hold personal data`.
- [ ] **Step 4: Run them.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): the books start on 1 January 2026; bank from the overstap, Mollie from November`

---

### Task 2: The app waits for the auditfile

**Files:**
- Create: `worker/db/eboekhouden.ts` (this task only adds the gate)
- Modify:
  - `worker/db/kassa-ledger.ts` (`syncKassa`);
  - `worker/db/mollie-ledger.ts` (`storePayments`: store, but do not book);
  - `worker/db/bank.ts` (`autoBook`);
  - `worker/db/ledger-reports.ts` (`overview`);
  - `shared/ledger-types.ts` (`LedgerOverview`);
  - `src/beheer/boekhouding/ledger-alerts.ts`.
- Test: `test/eboekhouden-gate.test.ts`, `src/beheer/boekhouding/OverviewPage.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const IMPORTED_KEY = "eboekhouden_imported_at";
  /** The auditfile has been read in (finishImport ran once). Until then the app books nothing by itself. */
  export async function eboekhoudenDone(db: D1Database): Promise<boolean>;
  export function eboekhoudenDoneStatement(db: D1Database): D1PreparedStatement; // one row { done: 0 | 1 }, for a caller's batch
  ```
  `LedgerOverview` gets `eboekhoudenDone: boolean`.
- While the gate is closed:
  - `syncKassa` returns `{ days: 0, late: 0, handovers: 0, left: 0 }`;
  - `autoBook` returns 0;
  - `storePayments` stores payments but makes no entries and marks none booked;
  - nothing else changes: bank lines and Mollie payments are still stored, and balances are still recorded.
- The gate is one read added to a batch each function already makes, not an extra call.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("books no kassa day while 2026 waits for e-Boekhouden", …)       // sale on 2026-11-21, gate closed → no entry; open gate → entry
  it("stores bank lines but books none while it waits", …)            // kasstorting line 2026-11-26 → status open, no entry; open gate + autoBook → booked
  it("stores Mollie payments but books none while it waits", …)       // rule payment 2026-11-03 → stored booked 0, no entry
  it("numbers the imported year before the app's own entries", …)     // gate closed, sync; open gate (simulate finishImport by setting the key after writing an opening) then sync → kassa entry number > opening number
  it("tells the overview the books wait for e-Boekhouden", …)         // overview().eboekhoudenDone === false
  ```
  Client: `it("asks to read in 2026 from e-Boekhouden first", …)`. The overview alert reads "Lees eerst 2026 in uit e-Boekhouden (Instellingen → Eenmalig). Tot dan boekt de app niets zelf." and links to the import page (Task 6 route `/beheer/boekhouding/eboekhouden-2026`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): the app books nothing in 2026 until the auditfile is read in`

---

### Task 3: The source `eboekhouden` (migration 0012)

**Files:**
- Create: `migrations/0012_eboekhouden.sql`
- Modify: `shared/ledger-types.ts` (`EntrySource`), `test/schema.test.ts`, `test/helpers.ts` (`resetData`, if it lists sources or tables)
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: `EntrySource` includes `"eboekhouden"`. The migration rebuilds `ledger_entries` with the CHECK list extended by `'eboekhouden'`:
  - `PRAGMA defer_foreign_keys = true`;
  - create `ledger_entries_new` with the same columns, `UNIQUE (year, number)` and `UNIQUE (source, source_ref)`;
  - `INSERT INTO ledger_entries_new SELECT * FROM ledger_entries`;
  - `DROP TABLE ledger_entries`;
  - `ALTER TABLE ledger_entries_new RENAME TO ledger_entries`;
  - recreate `ledger_entries_by_year_date` and `ledger_entries_by_date`.

  `ledger_lines`, `ledger_history`, attachments and bank lines keep pointing at the same ids. `EDITABLE_SOURCES` stays `["manual", "bank"]`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("accepts an entry from e-Boekhouden", …)                              // insert source 'eboekhouden' → ok
  it("keeps every entry, line, number and link through the rebuild", …)    // apply migrations up to 0011, write an entry with a line, a history row and an attachment, apply 0012 → all still there, same ids and numbers; a second entry with the same (source, source_ref) or (year, number) is refused
  ```
  Use `test/apply-migrations.ts` for "up to 0011, then 0012".
- [ ] **Step 2: Run them.** `npm run test:worker -- test/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the migration** as the Interfaces say.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): entries can come from e-Boekhouden (migration 0012)`

---

### Task 4: Reading and mapping the auditfile (browser and shared)

**Files:**
- Create: `shared/xaf.ts`, `shared/xaf.test.ts`, `shared/xaf-map.ts`, `shared/xaf-map.test.ts`, `shared/fixtures/xaf-2026.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/xaf.ts: only parseXaf touches DOMParser (as shared/camt.ts), so the Worker typecheck can include it.
  export type XafLine = { accountId: string; amountCents: number; description: string }; // debit +, credit −
  export type XafTransaction = { journal: string; nr: string; date: string; description: string; lines: XafLine[] };
  export type XafFile = {
    year: number;                // header/fiscalYear
    createdOn: string;           // header/dateCreated, YYYY-MM-DD
    accounts: { id: string; name: string }[];
    opening: { accountId: string; amountCents: number }[];
    transactions: XafTransaction[];
  };
  export class XafError extends Error {} // message "not_auditfile" | "unbalanced" | "not_2026"
  export function parseXaf(xml: string): XafFile;

  // shared/xaf-map.ts
  export type ImportedEntry = { ref: string; date: string; description: string; lines: { accountCode: string; amountCents: number; note: string | null }[] };
  export type XafPlan = {
    year: number; createdOn: string;
    opening: { accountCode: string; amountCents: number }[];  // debit +, credit −; no 1400, no zero lines, merged per new account
    ebEquityCents: number;                                      // e-Boekhouden's 1400 as the balance shows it (credit → positive)
    entries: ImportedEntry[];                                   // dated before OVERSTAP, in date order, then journal, then nr
    skippedFromOverstap: number;                                // transactions dated on or after OVERSTAP
    fallenAway: { ref: string; date: string; description: string }[]; // nothing left after merging (e.g. 0800 → 0135)
    mapping: { from: string; name: string; to: string | null }[];     // every old account that occurs, with where it goes
    unplaced: { code: string; name: string }[];                       // needs a choice before "Overnemen"
    assetLines: { ref: string; date: string; description: string }[]; // a line left on 0130, 0135 or 4601: blocks "Overnemen"
    kassaLines: { ref: string; date: string; description: string }[]; // 8011/8012 on or after kassaSince: a warning
    payouts: string[];                                                // PAYOUT_REFERENCE matches in transactions with a 1010 line
    atSwitch: { accountCode: string; cents: number }[];               // 1000, 1010, 1011, 1020, 1021, 1080, 1300, 1700 at the end of 24-11 (opening + entries)
  };
  export function mapXaf(file: XafFile, accounts: LedgerAccount[], options: { kassaSince: string | null; choices: Record<string, string> }): XafPlan;
  ```
- Reading:
  - The namespace must be XAF 4.0 (`…/XmlauditfileXAF_4.0`), else `not_auditfile`.
  - A fiscal year other than 2026 gives `not_2026`.
  - A transaction whose lines do not sum to 0 gives `unbalanced`.
  - Amounts are read from their text without floating point (`"185938.91"` → `18593891`). `amntTp` `D` is +, `C` is −.
  - An opening that does not balance is allowed; that is the old difference.
- `ref` is `` `${journal}:${nr}` ``.
- A line's note is its own description when it differs from the transaction's, else null.
- Mapping: the fixed list of the Global Constraints first, then `formerly`, then `options.choices`.
  - An old account without a place is `unplaced`.
  - `0801` and `9998` with any non-zero amount are `unplaced` as well.
- The fixture is a made-up auditfile with invented names. It has:
  - an opening that does not balance;
  - a payout line on 1010 with reference `05665564.2611.01`;
  - a kas booking;
  - the 0800 → 0135 memoriaal;
  - a Revolut transfer via 1080 and a Revolut payment on 4513;
  - a booking dated 2026-11-25;
  - a split booking (one line on 8010, one on 8012).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("reads the opening and every booking with signed cents", …)        // 185938.91 D → 18593891; C → negative
  it("refuses a file that is not an auditfile", …)                       // CAMT text → "not_auditfile"
  it("refuses a booking that does not balance", …)                       // → "unbalanced"
  it("refuses another year", …)                                          // fiscalYear 2025 → "not_2026"
  it("maps old accounts through formerly and the fixed list", …)         // 4305 → 4304, 1590 → 1300, 0800 → 0135, 1012 → 1080
  it("lets a transfer within one new account fall away", …)              // 0800 → 0135 memoriaal and Revolut transfer 1012/1080 → in fallenAway, not in entries
  it("keeps Revolut's costs and income on 1080", …)                      // Revolut payment → lines 4513 +, 1080 −
  it("leaves bookings from the overstap on out and counts them", …)      // 2026-11-25 → skippedFromOverstap 1
  it("asks for a place for an account it does not know", …)             // old 4999 → unplaced; with choices { "4999": "4514" } → mapped
  it("blocks a booking on a toestel account", …)                         // 0130 line → assetLines
  it("warns about kassa revenue from the kassa's first day", …)          // 8012 on 2026-11-22, kassaSince 2026-11-21 → kassaLines
  it("finds Mollie's payout references on ING", …)                       // → payouts ["05665564.2611.01"]
  it("gives e-Boekhouden's equity and the balances at the switch", …)    // ebEquityCents; atSwitch for 1010 = opening + movements
  ```
- [ ] **Step 2: Run them.** `npm run test:client -- shared/xaf.test.ts shared/xaf-map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseXaf` and `mapXaf`. Fixed mapping table in `shared/xaf-map.ts`: `{ "0800": "0135", "1012": "1080" }`.
- [ ] **Step 4: Run them.** Expected: PASS. Then read the real file once, as the Global Constraints say, with a throwaway script outside the repo that calls `parseXaf` and `mapXaf`. Check:
  - 312 transactions;
  - opening sum −11.465,95;
  - `atSwitch` 1010 = 2.173.449 cents;
  - 1000, 1080, 1300 and 1700 at 0;
  - `fallenAway` holds the 0800 memoriaal and the Revolut transfer;
  - `assetLines` and `unplaced` are empty;
  - `payouts` ends with the reference of 2-11-2026.

  Report counts and amounts only.
- [ ] **Step 5: Commit.** `feat(boekhouding): read e-Boekhouden's auditfile and map it onto the app's accounts`

---

### Task 5: Writing the import (Worker)

**Files:**
- Modify: `worker/db/eboekhouden.ts`, `worker/db/opening.ts`, `worker/app.ts` (mount)
- Create: `worker/routes/admin-ledger-eboekhouden.ts`, `test/eboekhouden.test.ts`

**Interfaces:**
- Consumes:
  - `ImportedEntry` and `PAYOUT_REFERENCE` (Tasks 1 and 4);
  - `upsertSourcedStatements`, `LedgerError` (`worker/db/ledger.ts`);
  - `setOpening`, `getOpening`, `expectedCashAt`, `endOfDay` (`worker/db/opening.ts`);
  - `balancesOn`, `inUseSince`.
- Produces:
  ```ts
  export const PAYOUTS_KEY = "eboekhouden_payouts";   // JSON string[]
  export const MAX_ENTRIES = 40;
  export type EbStatus = { done: boolean; createdOn: string | null; imported: number; inUseSince: string | null; yearClosed: boolean };
  export type EbSummary = {
    imported: number; emptied: number;
    cash: { ledgerCents: number; kluisjeCents: number };                   // 1000 at the end of 24-11, and what the kassa says belonged in the kluisje then
    open: { accountCode: "1300" | "1700"; cents: number }[];               // non-zero only
    money: { accountCode: string; ledgerCents: number; bankCents: number | null; bankDate: string | null }[]; // at the end of 24-11; bank = newest balance on or before 24-11
  };
  export async function eboekhoudenStatus(db: D1Database): Promise<EbStatus>;
  export async function eboekhoudenPayouts(db: D1Database): Promise<string[]>;
  export async function startImport(db: D1Database, input: { createdOn: string; opening: { accountCode: string; amountCents: number }[]; ebEquityCents: number; payouts: string[] }, now: Date): Promise<void>;
  export async function importEntries(db: D1Database, entries: ImportedEntry[], now: Date): Promise<{ written: number }>;
  export async function finishImport(db: D1Database, input: { createdOn: string; refs: string[] }, now: Date): Promise<EbSummary>;
  ```
  Routes under `/api/admin/boekhouding/eboekhouden`, behind `requireAdmin`:
  - `GET /status`;
  - `POST /start`;
  - `POST /entries` (body `{ entries }`, at most `MAX_ENTRIES`, else 400 `too_many`);
  - `POST /finish`.

  Every body is checked with zod.
- Rules:
  - All three writes refuse with 409 `year_closed` when 2026 is closed.
  - `startImport`:
    - turns the signed opening into "as the balance shows it" (an asset is +; liabilities, equity and 0135 flip) and calls `setOpening(db, 2026, …)`, so 0130 and 0135 come from the toestellen list once it is pasted;
    - refuses income and expense accounts (400 `not_balance_account`, as `setOpening` does);
    - writes `PAYOUTS_KEY`, and does not yet set `IMPORTED_KEY`.
  - `importEntries`:
    - refuses an entry dated outside 2026-01-01 to the day before `OVERSTAP` (400 `outside_period`);
    - refuses an entry with a line on 0130, 0135 or 4601 (400 `asset_account`);
    - refuses an entry that does not balance (the ledger refuses it).
    - Each entry is upserted with source `eboekhouden` and `sourceRef = ref`.
    - A changed existing entry also gets one `ledger_history` row (before → after, note `"opnieuw ingelezen uit e-Boekhouden"`), in the same batch.
    - An unchanged entry writes nothing.
    - All writes go in one `db.batch`.
  - `finishImport`:
    - empties every `eboekhouden` entry whose ref is not in `refs`, with a history row (note `"niet meer in het auditbestand"`);
    - empties an `opening` entry with `source_ref = '2027'` if one exists, with a history row, and deletes the setting `ledger_opening_eb_equity_2027`;
    - sets `IMPORTED_KEY` to `createdOn`;
    - returns `EbSummary`.
- The route for typing the opening (`PUT /api/admin/boekhouding/opening`) now refuses with 409 `opening_from_file`. `addPastedAssets` still calls `setOpening` itself.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("writes the opening of 2026 with equity worked out", …)                // opening lines + ebEquityCents → opening entry 2026, 1400 balancing, eBoekhoudenEquityCents kept
  it("takes 0130 and 0135 from the toestellen list when it is there", …)    // pasted list first → opening 0130/0135 = list totals
  it("writes a chunk of bookings as entries from e-Boekhouden", …)          // 2 entries → source 'eboekhouden', refs, not editable
  it("does not double a booking read in twice", …)                         // same entries again → same ids, no new rows, no history
  it("keeps a history row when a booking changed in e-Boekhouden", …)       // changed amount → one ledger_history row with the note
  it("empties a booking that is no longer in the file", …)                  // finish with refs without it → lines empty, entry stays, history row
  it("refuses a booking from the overstap on or on a toestel account", …)   // 2026-11-25 → outside_period; 0130 → asset_account
  it("refuses everything once 2026 is closed", …)                           // close 2026 → 409 year_closed on start, entries, finish
  it("empties a typed opening of 2027", …)                                  // opening 2027 present → emptied with history, setting gone
  it("opens the gate and sums up kas, open items and money accounts", …)    // finish → eboekhoudenDone true; cash, open, money as computed
  it("refuses typing the opening by hand", …)                               // PUT /opening → 409 opening_from_file
  it("refuses more than 40 bookings in one request", …)                     // 41 → 400 too_many
  it("stays within 50 database calls for a full chunk", …)                  // meteredDb: 40 entries × 4 lines → calls() <= 50
  it("takes an attachment on a booking from e-Boekhouden", …)               // addAttachment on an imported entry in open 2026 → ok
  ```
- [ ] **Step 2: Run them.** `npm run test:worker -- test/eboekhouden.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces and Rules say. Mount the route in `worker/app.ts` next to the other `admin-ledger-*` routes.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): write the opening and the bookings of 2026 from e-Boekhouden`

---

### Task 6: The page "2026 uit e-Boekhouden inlezen"

**Files:**
- Create:
  - `src/beheer/boekhouding/xaf-file.ts`;
  - `src/beheer/boekhouding/EBoekhoudenImportPage.tsx`;
  - `src/beheer/boekhouding/EBoekhoudenImportPage.test.tsx`.
- Modify:
  - `src/beheer/boekhouding/ledger-api.ts`;
  - `src/beheer/boekhouding/pages.ts`;
  - `src/routes.tsx` (route `eboekhouden-2026`);
  - `src/beheer/boekhouding/SettingsLedgerPage.tsx` (Eenmalig, first link: "2026 uit e-Boekhouden inlezen");
  - `src/beheer/boekhouding/EntryPage.tsx` and its test: for source `eboekhouden`, under "Deze boeking kan niet worden aangepast.", the line "Hij komt uit e-Boekhouden. Corrigeer hem daar en lees het auditbestand opnieuw in, of maak een gewone boeking.";
  - `src/beheer/boekhouding/ledger-test-data.ts`.

**Interfaces:**
- Consumes:
  - `parseXaf`, `mapXaf`, `XafPlan` (Task 4);
  - the routes and `EbStatus` / `EbSummary` (Task 5);
  - `readText` (`bank-file.ts`).
- Produces:
  ```ts
  export async function readXafFile(file: File, accounts: LedgerAccount[], options: { kassaSince: string | null; choices: Record<string, string> }): Promise<{ ok: true; plan: XafPlan; file: XafFile } | { ok: false; error: "not_auditfile" | "unbalanced" | "not_2026" }>;
  ```
  The page loads `xaf-file.ts` with `import()` only when a file is chosen, as Eerdere jaren does.
- The page, in this order:
  1. Status: "Nog niet ingelezen", or "Ingelezen uit het auditbestand van {d-m-jjjj}: {n} boekingen".
  2. A file picker, "Kies het auditbestand (.xaf)".
  3. After reading:
     - the year and the date the file was made;
     - "{n} boekingen van 1 januari tot en met 24 november; {m} vanaf 25 november worden overgeslagen";
     - the opening per new account;
     - e-Boekhouden's eigen vermogen and the difference;
     - the mapping table (old account and name → new account; 1012 shows "Revolut: niet in de app, via 1080");
     - `fallenAway`, under "Vallen weg (beide kanten op dezelfde rekening)";
     - the balances at 24-11.
  4. Blocks and warnings:
     - `unplaced`: a select per account from the app's accounts, and "Overnemen" stays disabled until each has one;
     - `assetLines`, blocking: "Deze boekingen staan op een toestel-rekening. Haal ze weg in e-Boekhouden, lees opnieuw in en leg het toestel vast bij Toestellen.";
     - `kassaLines`, a warning: "De app boekt de kassa vanaf {d-m-jjjj} zelf. Haal deze boekingen weg in e-Boekhouden en lees opnieuw in.";
     - a non-zero 1300 or 1700 at the switch: "Boek de betaling hiervan in Te boeken op 1300 (of 1700).".
  5. "Overnemen":
     - when already imported, first a confirm: "Er staan al boekingen uit e-Boekhouden. Vervangen door dit bestand?";
     - then `start`, the entries in chunks of `MAX_ENTRIES` (progress "{k} van {n}"), and `finish`.
  6. After `finish`:
     - the summary;
     - Kas: "1000 Kas in de boeken: € x; in het kluisje volgens de kassa: € y", and when they differ: "Boek het verschil één keer met een gewone boeking. Kwam het wisselgeld uit de oude kas, dan tegen de rekening waar het vandaan kwam; anders op 4515 Kasverschillen.";
     - per money account the ledger next to the bank, with the difference;
     - "De kassa, ING en Mollie worden vannacht bijgewerkt, of nu met Nu bijwerken op het overzicht."
  - Errors:
    - `not_auditfile`: "Dit is geen auditbestand van e-Boekhouden.";
    - `not_2026`: "Dit auditbestand gaat niet over 2026.";
    - `unbalanced`: "Er staat een boeking in die niet sluit; download het bestand opnieuw.";
    - `year_closed`: "2026 is afgesloten; heropen het jaar eerst.".

- [ ] **Step 1: Write the failing tests** (the fixture of Task 4, served as a `File`):
  ```ts
  it("shows what the file holds before anything is saved", …)            // counts, opening, mapping, fallenAway; no POST made
  it("asks a place for an unknown account before Overnemen", …)           // fixture variant with 4999 → button disabled until chosen
  it("blocks a booking on a toestel account", …)                          // variant with 0130 → message, button disabled
  it("sends the opening, the bookings in chunks and the finish", …)       // 41 entries → start, entries(40), entries(1), finish, in that order
  it("asks before replacing an earlier import", …)                        // status done → confirm shown; cancel → no POST
  it("shows the kas difference after Overnemen", …)                       // summary cash 0 vs 5000 → the sentence with € 50,00
  it("says why a file cannot be read", …)                                 // CAMT file → "Dit is geen auditbestand van e-Boekhouden."
  it("tells where a booking from e-Boekhouden is corrected", …)           // EntryPage, source eboekhouden → the line above
  ```
- [ ] **Step 2: Run them.** `npm run test:client -- src/beheer/boekhouding/EBoekhoudenImportPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run them.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): a page to read in 2026 from e-Boekhouden`

---

### Task 7: Mollie next to e-Boekhouden's payouts

**Files:**
- Modify: `worker/db/bank.ts` (`payoutsInTransitStatement`, `autoBook`), `worker/db/mollie-ledger.ts` (`mollieMonth` floor), `src/beheer/boekhouding/MolliePage.tsx` (first month)
- Test: `test/mollie-payouts.test.ts`, `src/beheer/boekhouding/MolliePage.test.tsx`

**Interfaces:**
- Consumes: `PAYOUTS_KEY` / `eboekhoudenPayouts` (Task 5), `MOLLIE_START` (Task 1).
- Rules:
  - `payoutsInTransitStatement`:
    - counts settlements settled from the start of `MOLLIE_START` in Amsterdam (replaces `LEDGER_START_MOMENT`);
    - leaves out every settlement whose `reference` is in the `PAYOUTS_KEY` list (read in the same statement with `json_each`).
  - `autoBook`: a payout line whose reference is in that list stays open with the note "Uitbetaling {ref} staat al in e-Boekhouden." It can only occur if a line from before the overstap is typed or imported again. This replaces the branch `settled < LEDGER_START`.
  - The Mollie month view:
    - starts at `MOLLIE_START.slice(0, 7)` (`"2026-11"`);
    - an earlier month is refused (400 `before_mollie_start`);
    - the page offers no earlier month.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("does not count e-Boekhouden's payout as in transit", …)        // settlement 05665564.2611.01 settled 2026-11-01, in PAYOUTS_KEY → payoutsInTransit 0
  it("books the first payout of the app with its costs", …)         // payments 2026-11-03 (rule) and kassa pin 2026-11-21, settlement 2026-12-01 → ING line booked: 1010, 4511 costs, 1030
  it("leaves a payout line e-Boekhouden has open with a note", …)   // ING line carrying a reference in PAYOUTS_KEY → open, note "staat al in e-Boekhouden"
  it("starts the Mollie months in November 2026", …)                // GET month 2026-10 → 400 before_mollie_start
  ```
  Client: `it("offers Mollie months from November 2026 on", …)`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as the Rules say.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): Mollie starts where e-Boekhouden's payouts stop`

---

### Task 8: Opening page, toestellen and comparison years

**Files:**
- Modify:
  - `shared/asset-paste.ts` and `shared/asset-paste.test.ts` (columns);
  - `src/beheer/boekhouding/OpeningPage.tsx` and its test;
  - `src/beheer/boekhouding/AssetsPage.tsx` and its test;
  - `src/beheer/boekhouding/SettingsLedgerPage.tsx`, `src/beheer/boekhouding/YearPage.tsx` (the comparison link);
  - `src/beheer/boekhouding/EarlierYearsPage.tsx` and its test.

**Interfaces:**
- `parseAssetPaste` reads the cost from column 2 (cost on 1 January) and what was written off from column 5 (up to 1 January), counted from 0, instead of columns 4 and 9. The fixture row Straaljager then gives `writtenOffCents` = column 5 of that row. Check it against `shared/fixtures/vaste-activa-2026.ts`; the test's expected values change with it.
- Opening page:
  - title `Beginbalans 1 januari ${FIRST_LEDGER_YEAR}`, without a form;
  - the balance read-only, with the note "Uit het auditbestand van e-Boekhouden; 0130 en 0135 uit de toestellenlijst. Opnieuw inlezen kan bij 2026 uit e-Boekhouden inlezen.";
  - e-Boekhouden's equity and the difference, as now;
  - no Mollie hint, and the line "1030 Mollie begint op nul: e-Boekhouden boekte een uitbetaling als omzet toen die op ING binnenkwam.";
  - without an opening entry: "Nog niet ingelezen", with a link to the import page.
- Toestellen paste note: "Kopieer in e-Boekhouden het overzicht Vaste activa 2026 en plak het hier. De app neemt de stand van 1 januari 2026 over en boekt de afschrijving van 2026 zelf. Overnemen vervangt wat eerder is overgenomen; gekochte toestellen blijven staan. De restwaarde staat er niet in: vul die daarna per toestel in." Column header `Afgeschreven t/m ${FIRST_LEDGER_YEAR - 1}`.
- The links "Vergelijkingscijfers 2026" become `Vergelijkingscijfers ${FIRST_LEDGER_YEAR - 1}`.
- Eerdere jaren, for a file of a year ≥ `FIRST_LEDGER_YEAR`: "{jaar} staat in de boekhouding zelf; dat jaar hoeft u hier niet in te lezen." The Worker already refuses `not_comparison_year`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("reads the cost and what was written off on 1 January", …)          // asset-paste: Straaljager → costCents col 2, writtenOffCents col 5
  it("shows the opening of 2026 read only", …)                           // OpeningPage: no inputs, the note, no Mollie hint
  it("says the opening is not read in yet", …)                           // no opening → link to eboekhouden-2026
  it("asks for Vaste activa 2026 at its state of 1 January", …)          // AssetsPage note and header "Afgeschreven t/m 2025"
  it("does not read in a year the books hold", …)                        // EarlierYearsPage: W&V 2026 → the sentence
  ```
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run them.** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): opening of 2026 from the file, toestellen at 1 January 2026`

---

### Task 9: The jaaroverzicht of 2026 says where its first months come from

**Files:**
- Modify:
  - `shared/ledger-types.ts` (`YearExport`);
  - `worker/db/year.ts` (`yearExport`);
  - `src/beheer/boekhouding/year-export.ts`;
  - `src/beheer/boekhouding/PrintYearPage.tsx`;
  - their tests (`test/year-export.test.ts`, `src/beheer/boekhouding/year-export.test.ts`, `PrintYearPage.test.tsx`).

**Interfaces:**
- `YearExport` gets `notes: string[]`. For the year of `LEDGER_START`, once `IMPORTED_KEY` is set, it holds:
  1. `Boekingen tot en met 24-11-2026 komen uit e-Boekhouden (auditbestand van {d-m-jjjj}); hun bijlagen staan in e-Boekhouden.`
  2. `Tot 21-11-2026 staat op 8011 de contante verkoop en op 8012 de pin- en online-verkoop, zoals e-Boekhouden boekte; daarna kiosk en entree.`

  The dates in the notes come from `OVERSTAP` − 1 day, `IMPORTED_KEY` and `inUseSince`. Other years get `[]`. The Excel puts the notes at the top of its first sheet, and the PDF puts them under the title.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it("explains where 2026 comes from in the jaaroverzicht", …)   // imported → notes as above with the file's date
  it("has no notes for a later year", …)                         // 2027 → []
  ```
  Client: `it("puts the notes on top of the Excel and the PDF", …)`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as the Interfaces say.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(boekhouding): the jaaroverzicht 2026 says what came from e-Boekhouden`

---

### Task 10: Handbook, decisions and going online (prepared only)

**Files:**
- Modify: `README.md` (chapter "Boekhouding")
- Create: `docs/superpowers/plans/2026-11-25-boekhouding-vanaf-2026-besluiten.md`

- [ ] **Step 1: Handbook.** Update the chapter "Boekhouding" for the books from 2026:
  - the overstap;
  - what still lives in e-Boekhouden (bijlagen up to 24-11, ledenlijst, incasso);
  - reading in the auditfile, and again after a correction;
  - Revolut via 1080;
  - booking a kas difference once;
  - a payment of an invoice from before 25-11 on 1300 or 1700;
  - 2026 is closed in the app.

  Remove what says to close 2026 in e-Boekhouden or to type the opening of 2027.
- [ ] **Step 2: Decisions.** Write every choice this plan or the build left to the builder, in plain Dutch, each with what it costs if wrong. Use the format of `2026-11-23-boekhouding-besluiten.md`.
- [ ] **Step 3: Full check.** `npm test`, `npm run typecheck`, `npm run e2e`. Expected: all green. If e2e hangs on this Mac in tests the change did not touch, say so plainly in the report. That happened on 24-11.
- [ ] **Step 4: Commit.** `docs(boekhouding): handbook and decisions for the books from 2026`
- [ ] **Step 5: Going online: prepare, do not do.** Write the steps for the penningmeester, each needing his yes:
  1. merge into `main`;
  2. note a D1 restore point (`npx wrangler d1 time-travel info …`), then run migration 0012 on the live database;
  3. deploy.

  After the deploy:
  - The gate (Task 2) keeps the app from booking 2026 until he reads in the file. The overview tells him so.
  - He pastes Vaste activa 2026 at Toestellen. Pasted first, the toestellen fill the opening; pasted after the import, the opening is saved again.
  - He reads in the auditfile and presses Overnemen. That is his own action in beheer.
  - He checks the kas, the open items and the money accounts on the summary.

  Nobody reads the live database without his yes. The code handles a typed opening of 2027, a pasted list and comparison figures for 2026, so no live check is needed first.
