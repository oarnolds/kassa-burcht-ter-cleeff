// The boekhouding's routes in the Worker, one small typed call each. Every call answers like `adminApi`: the data or a reason.

import type { AccountKind, LedgerAccount, MoneyAccount, MoneySource } from "../../../shared/ledger-types";
import { adminApi, type ApiResult } from "../../lib/api";

export const LEDGER = "/api/admin/boekhouding";

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

export const listAccounts = (): Promise<ApiResult<LedgerAccount[]>> => adminApi(`${LEDGER}/accounts`);

export const addAccount = (body: { code: string; name: string; kind: AccountKind }): Promise<ApiResult<LedgerAccount>> =>
  adminApi(`${LEDGER}/accounts`, { method: "POST", json: body });

export const patchAccount = (code: string, body: { name?: string; hidden?: boolean }): Promise<ApiResult<LedgerAccount>> =>
  adminApi(`${LEDGER}/accounts/${code}`, { method: "PATCH", json: body });

export const getCategoryAccounts = (): Promise<ApiResult<CategoryAccount[]>> => adminApi(`${LEDGER}/category-accounts`);

export const putCategoryAccounts = (body: { categoryId: string; accountCode: string }[]): Promise<ApiResult<CategoryAccount[]>> =>
  adminApi(`${LEDGER}/category-accounts`, { method: "PUT", json: body });

export const getOpening = (year: number): Promise<ApiResult<Opening>> => adminApi(`${LEDGER}/opening?year=${year}`);

export const putOpening = (
  year: number,
  body: { lines: Figure[]; eBoekhoudenEquityCents: number | null },
): Promise<ApiResult<Opening>> => adminApi(`${LEDGER}/opening?year=${year}`, { method: "PUT", json: body });

export const getComparison = (year: number): Promise<ApiResult<Comparison>> => adminApi(`${LEDGER}/comparison?year=${year}`);

export const putComparison = (year: number, figures: Figure[]): Promise<ApiResult<Comparison>> =>
  adminApi(`${LEDGER}/comparison?year=${year}`, { method: "PUT", json: { figures } });

export const listMoneyAccounts = (): Promise<ApiResult<MoneyAccount[]>> => adminApi(`${LEDGER}/money-accounts`);

export const patchMoneyAccount = (code: string, body: { identifier?: string | null; source?: MoneySource }): Promise<ApiResult<MoneyAccount>> =>
  adminApi(`${LEDGER}/money-accounts/${code}`, { method: "PATCH", json: body });
