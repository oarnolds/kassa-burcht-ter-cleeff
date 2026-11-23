// The one place that knows the boekhouding's paths and body shapes (they follow the zod schemas in
// worker/routes/admin-ledger.ts and admin-ledger-bank.ts). Reads: a path for `useAdminData`. Writes: `useLedgerWrites`.

import { useMemo } from "react";
import type { AccountKind, LedgerAccount, MoneyAccount, MoneySource } from "../../../shared/ledger-types";
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

/** Where to read from. */
export const ledgerPath = {
  accounts: `${LEDGER}/accounts`,
  moneyAccounts: `${LEDGER}/money-accounts`,
  categoryAccounts: `${LEDGER}/category-accounts`,
  opening: (year: number) => `${LEDGER}/opening?year=${year}`,
  comparison: (year: number) => `${LEDGER}/comparison?year=${year}`,
};

/** Every change the boekhouding's settings pages send. A 401 leads back to login, as with `useAdminWrite`. */
export function useLedgerWrites() {
  const write = useAdminWrite();
  return useMemo(
    () => ({
      addAccount: (body: { code: string; name: string; kind: AccountKind }): Promise<ApiResult<LedgerAccount>> =>
        write(`${LEDGER}/accounts`, "POST", body),
      patchAccount: (code: string, body: { name?: string; hidden?: boolean }): Promise<ApiResult<LedgerAccount>> =>
        write(`${LEDGER}/accounts/${code}`, "PATCH", body),
      putCategoryAccounts: (body: { categoryId: string; accountCode: string }[]): Promise<ApiResult<CategoryAccount[]>> =>
        write(`${LEDGER}/category-accounts`, "PUT", body),
      putOpening: (year: number, body: { lines: Figure[]; eBoekhoudenEquityCents: number | null }): Promise<ApiResult<Opening>> =>
        write(ledgerPath.opening(year), "PUT", body),
      putComparison: (year: number, figures: Figure[]): Promise<ApiResult<Comparison>> =>
        write(ledgerPath.comparison(year), "PUT", { figures }),
      patchMoneyAccount: (code: string, body: { identifier?: string | null; source?: MoneySource }): Promise<ApiResult<MoneyAccount>> =>
        write(`${LEDGER}/money-accounts/${code}`, "PATCH", body),
    }),
    [write],
  );
}
