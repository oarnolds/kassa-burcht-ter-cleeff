// The one place that knows the boekhouding's paths and body shapes (they follow the zod schemas in
// worker/routes/admin-ledger.ts, admin-ledger-bank.ts and admin-ledger-mollie.ts). Reads: a path for `useAdminData`. Writes: `useLedgerWrites`.

import { useMemo } from "react";
import type { CamtStatement } from "../../../shared/camt";
import type {
  AccountKind,
  Attachment,
  BankLine,
  ConsentState,
  Entry,
  ImportResult,
  LedgerAccount,
  MoneyAccount,
  MoneySource,
  MollieRule,
  NightlyReport,
} from "../../../shared/ledger-types";
import type { ApiResult } from "../../lib/api";
import { useAdminWrite } from "../useAdmin";

const LEDGER = "/api/admin/boekhouding";

export type CategoryAccount = { categoryId: string; categoryName: string; accountCode: string };

export type Opening = {
  year: number;
  /** As the balance shows them: positive for an asset and for a liability, 1400 not included. */
  lines: { accountCode: string; amountCents: number }[];
  equityCents: number;
  eBoekhoudenEquityCents: number | null;
  expectedCashCents: number;
};

export type Figure = { accountCode: string; amountCents: number };
export type Comparison = { year: number; figures: Figure[] };

/** What the entry form sends: the lines add up to zero, debit positive. */
export type EntryBody = { date: string; description: string; lines: { accountCode: string; amountCents: number; note: string | null }[] };

/** What the filters of the entries page can ask for. */
export type EntryFilter = { year: number; from?: string; to?: string; account?: string; amountCents?: number; text?: string };

/** The page of one entry. */
export const entryRoute = (id: string): string => `/beheer/boekhouding/boekingen/${id}`;

const query = (pairs: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(pairs)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
};

/** Where to read from. */
export const ledgerPath = {
  entries: (filter: EntryFilter) =>
    `${LEDGER}/entries?${query({ year: filter.year, from: filter.from, to: filter.to, account: filter.account, amount: filter.amountCents, text: filter.text })}`,
  entry: (id: string) => `${LEDGER}/entries/${id}`,
  history: (id: string) => `${LEDGER}/entries/${id}/history`,
  attachment: (id: string) => `${LEDGER}/attachments/${id}`,
  bankLines: `${LEDGER}/bank/lines`,
  balance: (date: string) => `${LEDGER}/reports/balance?date=${date}`,
  result: (from: string, to: string) => `${LEDGER}/reports/result?from=${from}&to=${to}`,
  accountLines: (code: string, from: string, to: string) => `${LEDGER}/reports/account/${code}?from=${from}&to=${to}`,
  overview: `${LEDGER}/overview`,
  accounts: `${LEDGER}/accounts`,
  moneyAccounts: `${LEDGER}/money-accounts`,
  ingConsent: `${LEDGER}/bank/ing`,
  categoryAccounts: `${LEDGER}/category-accounts`,
  mollieRules: `${LEDGER}/mollie/rules`,
  opening: (year: number) => `${LEDGER}/opening?year=${year}`,
  comparison: (year: number) => `${LEDGER}/comparison?year=${year}`,
};

/** A sentence for a refusal or a failure of a write on these pages. */
export function explainWrite(status: number, error: string): string {
  if (status === 0) return "Geen verbinding. Probeer het opnieuw.";
  const known: Record<string, string> = {
    year_closed: "Dit jaar is afgesloten. Er kan niets meer in worden veranderd.",
    year_unknown: "Voor deze datum worden de boeken niet bijgehouden.",
    before_start: "Voor deze datum worden de boeken niet bijgehouden.",
    not_editable: "Deze boeking kan niet worden aangepast.",
    unbalanced: "Debet en credit zijn niet gelijk.",
    account_hidden: "Deze rekening is verborgen. Kies een andere.",
    account_unknown: "Deze rekening bestaat niet.",
    too_large: "Dit bestand is te groot.",
    wrong_type: "Dit soort bestand kan niet worden bewaard. Kies een PDF of een foto.",
    attachments_off: "Bijlagen zijn nog niet aangezet.",
    not_found: "Dit bestaat niet meer. Ververs de pagina.",
    enable_banking_off: "De koppeling met Enable Banking is nog niet ingesteld (de sleutel ontbreekt).",
    identifier_missing: "Vul eerst het kenmerk (IBAN) van ING betaal in.",
    invalid: "Controleer de invoer en probeer het opnieuw.",
  };
  return known[error] ?? "Dat is niet gelukt. Probeer het opnieuw.";
}

/** Every change the boekhouding's pages send. A 401 leads back to login, as with `useAdminWrite`. */
export function useLedgerWrites() {
  const write = useAdminWrite();
  return useMemo(
    () => ({
      addAccount: (body: { code: string; name: string; kind: AccountKind }): Promise<ApiResult<LedgerAccount>> =>
        write(`${LEDGER}/accounts`, "POST", body),
      patchAccount: (code: string, body: { name?: string; hidden?: boolean }): Promise<ApiResult<LedgerAccount>> =>
        write(`${LEDGER}/accounts/${code}`, "PATCH", body),
      /** Brings the books up to date now, as the nightly run does. */
      syncNow: (): Promise<ApiResult<NightlyReport>> => write(`${LEDGER}/sync`, "POST"),
      putCategoryAccounts: (body: { categoryId: string; accountCode: string }[]): Promise<ApiResult<CategoryAccount[]>> =>
        write(`${LEDGER}/category-accounts`, "PUT", body),
      /** Without `id` a new rule at the end; with `id` that rule changed. */
      saveMollieRule: (body: { id?: string; keyword: string; accountCode: string }): Promise<ApiResult<MollieRule>> =>
        write(`${LEDGER}/mollie/rules`, "POST", body),
      deleteMollieRule: (id: string): Promise<ApiResult<{ ok: true }>> => write(`${LEDGER}/mollie/rules/${encodeURIComponent(id)}`, "DELETE"),
      putOpening: (year: number, body: { lines: Figure[]; eBoekhoudenEquityCents: number | null }): Promise<ApiResult<Opening>> =>
        write(ledgerPath.opening(year), "PUT", body),
      putComparison: (year: number, figures: Figure[]): Promise<ApiResult<Comparison>> =>
        write(ledgerPath.comparison(year), "PUT", { figures }),
      patchMoneyAccount: (code: string, body: { identifier?: string | null; source?: MoneySource }): Promise<ApiResult<MoneyAccount>> =>
        write(`${LEDGER}/money-accounts/${code}`, "PATCH", body),
      /** Asks for a consent at ING: the answer holds the page of the bank to send the browser to. */
      connectIng: (): Promise<ApiResult<{ url: string }>> => write(`${LEDGER}/bank/ing/connect`, "POST"),
      /** The bank sent the browser back: trades the code for a connection. The state may be used once. */
      finishIng: (body: { code: string; state: string }): Promise<ApiResult<ConsentState>> => write(`${LEDGER}/bank/ing/callback`, "POST", body),
      importStatement: (accountCode: string, statement: CamtStatement): Promise<ApiResult<ImportResult>> =>
        write(`${LEDGER}/bank/import`, "POST", { accountCode, statement }),
      addBankLine: (body: {
        accountCode: string;
        date: string;
        amountCents: number;
        description: string;
        counterpartyName?: string;
      }): Promise<ApiResult<BankLine>> => write(`${LEDGER}/bank/lines`, "POST", body),
      bookLine: (id: string, split: Figure[]): Promise<ApiResult<Entry>> => write(`${LEDGER}/bank/lines/${id}/book`, "POST", { split }),
      createEntry: (body: EntryBody): Promise<ApiResult<Entry>> => write(`${LEDGER}/entries`, "POST", body),
      saveEntry: (id: string, body: EntryBody): Promise<ApiResult<Entry>> => write(`${LEDGER}/entries/${id}`, "PUT", body),
      emptyEntry: (id: string): Promise<ApiResult<Entry>> => write(`${LEDGER}/entries/${id}/empty`, "POST"),
      hideAttachment: (id: string): Promise<ApiResult<{ ok: true }>> => write(`${LEDGER}/attachments/${id}/hide`, "POST"),
      /** The file itself is the body; its name travels URI-encoded in a header. */
      addAttachment: (entryId: string, file: File): Promise<ApiResult<Attachment>> =>
        write(`${LEDGER}/entries/${entryId}/attachments`, "POST", undefined, {
          raw: { body: file, headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) } },
          timeoutMs: 60_000,
        }),
    }),
    [write],
  );
}
