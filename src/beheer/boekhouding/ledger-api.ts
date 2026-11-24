// The one place that knows the boekhouding's paths and body shapes (they follow the zod schemas in
// worker/routes/admin-ledger.ts, admin-ledger-bank.ts, admin-ledger-mollie.ts, admin-ledger-assets.ts, admin-ledger-year.ts
// and admin-ledger-budget.ts). Reads: a path for `useAdminData`. Writes: `useLedgerWrites`.

import { useMemo } from "react";
import type { PastedAsset } from "../../../shared/asset-paste";
import type { Budget, BudgetLine, BudgetRule, BudgetSource } from "../../../shared/budget";
import type { CamtStatement } from "../../../shared/camt";
import type {
  AccountKind,
  Asset,
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
import { LEDGER_START, YEAR_PAGE } from "../../../shared/ledger-types";
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
  /** 0130 and 0135 are the totals of the toestellen pasted from e-Boekhouden, not typed. */
  fromAssetList: boolean;
  /** What Mollie gave for 31 December 2026 (available plus still to pay out), when the app read it. */
  mollieBalanceCents: number | null;
};

export type Figure = { accountCode: string; amountCents: number };
/** A part of a booked bank line; on 0130 it names the toestel it buys. */
export type SplitPart = Figure & { assetId?: string };
export type Comparison = { year: number; figures: Figure[] };

/** What the entry form sends: the lines add up to zero, debit positive. A line on 0130 or 0135 keeps its toestel. */
export type EntryBody = { date: string; description: string; lines: { accountCode: string; amountCents: number; note: string | null; assetId?: string | null }[] };

/** What the filters of the entries page can ask for. */
export type EntryFilter = { year: number; from?: string; to?: string; account?: string; amountCents?: number; text?: string };

/** The page of one entry. */
export const entryRoute = (id: string): string => `/beheer/boekhouding/boekingen/${id}`;

/** What "Begroting maken" sends: the source and a rule per account; the Worker works out the months. */
export type BudgetBody = { source: BudgetSource; lines: Pick<BudgetLine, "accountCode" | "rule" | "base">[] };

/** The page "Eerdere jaren": the years read from e-Boekhouden, and reading another. */
export const EARLIER_YEARS_ROUTE = "/beheer/boekhouding/eerdere-jaren";
/** The page with the comparison figures of one year before the books, to see or change them. */
export const comparisonRoute = (year: number): string => `/beheer/boekhouding/vergelijking?jaar=${year}`;

/** The first year the app keeps the books; the years before it are comparison figures only. */
export const FIRST_LEDGER_YEAR = Number(LEDGER_START.slice(0, 4));
/** Why a year from FIRST_LEDGER_YEAR on takes no comparison figures. */
export const FROM_LEDGER = `Vanaf ${FIRST_LEDGER_YEAR} staan de cijfers in de boekhouding zelf.`;

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
  mollieMonth: (month: string) => `${LEDGER}/mollie/month?month=${month}`,
  opening: (year: number) => `${LEDGER}/opening?year=${year}`,
  comparison: (year: number) => `${LEDGER}/comparison?year=${year}`,
  /** Every year with comparison figures, with its income, costs and result. */
  comparisonYears: `${LEDGER}/comparison/years`,
  /** The result per account, a column per year: the earlier years from e-Boekhouden and every year of the books. */
  multiYear: `${LEDGER}/reports/years`,
  assets: `${LEDGER}/assets`,
  /** Without a year: the plan of the earliest open year still to book. */
  depreciation: (year?: number | null) => (year == null ? `${LEDGER}/depreciation` : `${LEDGER}/depreciation?year=${year}`),
  /** A year's budget: its source and a line per account. */
  budget: (year: number) => `${LEDGER}/budget?year=${year}`,
  /** A year of the books per income and expense account and month, with its last booking. */
  budgetActuals: (year: number) => `${LEDGER}/budget/actuals?year=${year}`,
  /** Every year, oldest first, with its closing and reopening. */
  years: `${LEDGER}/years`,
  yearChecks: (year: number) => `${LEDGER}/year/${year}/checks`,
  /** What the jaaroverzicht reads in one go; the entries and their changes come in pages of YEAR_PAGE. */
  yearExport: (year: number) => `${LEDGER}/year/${year}/export`,
  yearEntries: (year: number, after: number) => `${LEDGER}/year/${year}/entries?after=${after}&limit=${YEAR_PAGE}`,
  yearChanges: (year: number, after: number) => `${LEDGER}/year/${year}/changes?after=${after}`,
  /** The page to print the jaaroverzicht from; `print` opens the print dialog ("Bewaar als PDF") right away. */
  yearPrint: (year: number, print = false) => `/beheer/boekhouding/jaar/${year}/afdruk${print ? "?print=1" : ""}`,
};

/** The file of an attachment as bytes, for the zip. A failure is the status the Worker answered (0: no connection). */
export async function attachmentBytes(id: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number }> {
  try {
    const response = await fetch(ledgerPath.attachment(id), { credentials: "same-origin", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** A sentence for a refusal or a failure of a write on these pages. */
export function explainWrite(status: number, error: string): string {
  if (status === 0) return "Geen verbinding. Probeer het opnieuw.";
  const known: Record<string, string> = {
    year_closed: "Dit jaar is afgesloten. Er kan niets meer in worden veranderd.",
    year_unknown: "Voor deze datum worden de boeken niet bijgehouden.",
    before_start: "Voor deze datum worden de boeken niet bijgehouden.",
    not_editable: "Deze boeking kan niet worden aangepast.",
    bank_line_fixed: "De regel van de bank en de datum blijven zoals de bank ze gaf.",
    date_in_future: "Deze datum ligt in de toekomst.",
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
    not_comparison_year: FROM_LEDGER,
    depreciation_booked: "De afschrijving is al geboekt. De lijst uit e-Boekhouden kan niet meer worden vervangen.",
    asset_linked: "Er is al op een toestel uit de lijst geboekt. De lijst uit e-Boekhouden kan niet meer worden vervangen.",
    asset_disposed: "Dit toestel is al afgevoerd.",
    asset_unknown: "Dit toestel bestaat niet meer. Ververs de pagina.",
    asset_wrong_account: "Een toestel hoort bij rekening 0130.",
    asset_line_account: "Een toestel kan alleen op 0130 of 0135 staan.",
    asset_booked_later: "Op dit toestel is na die datum nog geboekt. Kies een latere datum.",
    depreciation_first: "Boek eerst de afschrijving van het jaar ervoor; daarna kan dit toestel worden afgevoerd.",
    depreciation_later: "Er is al afgeschreven over een later jaar; pas dat eerst aan.",
    checks_failed: "Er zijn nog bankregels van dit jaar te boeken. Boek die eerst.",
    note_required: "Niet alle controles kloppen. Schrijf in de toelichting waarom het jaar toch dicht kan.",
    year_not_ended: "Dit jaar is nog niet voorbij. Afsluiten kan vanaf 1 januari.",
    earlier_year_open: "Sluit eerst het jaar ervoor af.",
    year_changed: "Er is net nog iets in dit jaar geboekt. Bekijk de controles en probeer het opnieuw.",
    reason_required: "Schrijf waarom het jaar weer open moet (minstens 3 tekens).",
    not_newest: "Alleen het laatst afgesloten jaar kan weer open.",
    not_closed: "Dit jaar is niet afgesloten. Ververs de pagina.",
    not_budget_year: "Voor dit jaar kan geen begroting worden gemaakt.",
    not_ledger_year: "Van dit jaar zijn er geen boekingen in de app.",
    unknown_account: "Deze rekening bestaat niet.",
    not_result_account: "Alleen een rekening van opbrengsten of kosten kan in de begroting.",
    duplicate_account: "Een rekening staat twee keer in de begroting.",
    invalid_rule: "Controleer de bedragen en probeer het opnieuw.",
    not_whole_euros: "Vul hele euro's in, zonder centen.",
    no_pattern: "Deze rekening heeft geen bedragen uit een eerder jaar om zo te verdelen. Kies een ander ritme.",
    invalid_source: "Het voorstel past niet bij dit jaar. Maak het voorstel opnieuw.",
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
      bookLine: (id: string, split: SplitPart[]): Promise<ApiResult<Entry>> => write(`${LEDGER}/bank/lines/${id}/book`, "POST", { split }),
      /** The list read from e-Boekhouden: replaces the toestellen taken over before. */
      pasteAssets: (assets: PastedAsset[]): Promise<ApiResult<Asset[]>> => write(`${LEDGER}/assets/paste`, "POST", { assets }),
      /** A toestel bought later; its cost is what is booked on 0130 for it. */
      addAsset: (body: { name: string; lifeYears: number; residualCents: number }): Promise<ApiResult<Asset>> => write(`${LEDGER}/assets`, "POST", body),
      patchAsset: (id: string, body: { name?: string; lifeYears?: number; residualCents?: number }): Promise<ApiResult<Asset>> =>
        write(`${LEDGER}/assets/${encodeURIComponent(id)}`, "PATCH", body),
      disposeAsset: (id: string, date: string): Promise<ApiResult<Entry>> => write(`${LEDGER}/assets/${encodeURIComponent(id)}/dispose`, "POST", { date }),
      /** "Jaar afsluiten"; `note` is the toelichting, needed when a check that is not required fails. */
      closeYear: (year: number, note: string | null): Promise<ApiResult<{ ok: true }>> => write(`${LEDGER}/year/${year}/close`, "POST", { note }),
      /** Only the newest closed year, with a reason of at least 3 characters. */
      reopenYear: (year: number, reason: string): Promise<ApiResult<{ ok: true }>> => write(`${LEDGER}/year/${year}/reopen`, "POST", { reason }),
      /** `empty`: books nothing, to undo a year before one ahead of it is booked again. */
      bookDepreciation: (year: number, empty = false): Promise<ApiResult<Entry>> => write(`${LEDGER}/depreciation`, "POST", empty ? { year, empty } : { year }),
      /** "Begroting maken": replaces the whole year. */
      putBudget: (year: number, body: BudgetBody): Promise<ApiResult<Budget>> => write(ledgerPath.budget(year), "PUT", body),
      /** Adds a line or changes its rule; a line keeps its base. */
      putBudgetLine: (year: number, accountCode: string, rule: BudgetRule): Promise<ApiResult<BudgetLine>> =>
        write(`${LEDGER}/budget/line?year=${year}&account=${encodeURIComponent(accountCode)}`, "PUT", { rule }),
      deleteBudgetLine: (year: number, accountCode: string): Promise<ApiResult<{ ok: true }>> =>
        write(`${LEDGER}/budget/line?year=${year}&account=${encodeURIComponent(accountCode)}`, "DELETE"),
      /** "Begroting {jaar} leegmaken": every line and the source. */
      deleteBudget: (year: number): Promise<ApiResult<{ ok: true }>> => write(ledgerPath.budget(year), "DELETE"),
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
