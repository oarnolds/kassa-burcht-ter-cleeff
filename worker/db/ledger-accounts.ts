import type { AccountKind, LedgerAccount } from "../../shared/ledger-types";
import { LedgerError } from "./ledger";
import { deleteLedgerSettingStatement } from "./ledger-settings";

type Row = { code: string; name: string; kind: AccountKind; money: number; hidden: number; formerly: string };

const toAccount = (row: Row): LedgerAccount => ({
  code: row.code,
  name: row.name,
  kind: row.kind,
  money: row.money === 1,
  hidden: row.hidden === 1,
  formerly: JSON.parse(row.formerly) as string[],
});

const COLUMNS = "code, name, kind, money, hidden, formerly";

/** Every account, hidden ones too, in the order of the chart. */
export async function listAccounts(db: D1Database): Promise<LedgerAccount[]> {
  return (await db.prepare(`SELECT ${COLUMNS} FROM ledger_accounts ORDER BY sort`).all<Row>()).results.map(toAccount);
}

async function getAccount(db: D1Database, code: string): Promise<LedgerAccount | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM ledger_accounts WHERE code = ?`).bind(code).first<Row>();
  return row ? toAccount(row) : null;
}

/** A new account goes at the end of the chart. Accounts are never deleted. */
export async function addAccount(db: D1Database, input: { code: string; name: string; kind: AccountKind }): Promise<LedgerAccount> {
  try {
    await db
      .prepare(
        `INSERT INTO ledger_accounts (code, name, kind, money, hidden, sort, formerly)
         SELECT ?, ?, ?, 0, 0, COALESCE(MAX(sort), 0) + 1, '[]' FROM ledger_accounts`,
      )
      .bind(input.code, input.name, input.kind)
      .run();
  } catch (error) {
    if (/UNIQUE constraint failed: ledger_accounts\.code/.test(String(error))) throw new LedgerError("account_exists", 409);
    throw error;
  }
  return (await getAccount(db, input.code))!;
}

/** Renames or hides an account. A money account stays visible: the kassa, the banks and Mollie are booked on it. */
export async function patchAccount(db: D1Database, code: string, input: { name?: string; hidden?: boolean }): Promise<LedgerAccount> {
  const current = await getAccount(db, code);
  if (!current) throw new LedgerError("not_found", 404);
  if (input.hidden === true && current.money) throw new LedgerError("money_account", 409);
  await db
    .prepare("UPDATE ledger_accounts SET name = COALESCE(?2, name), hidden = COALESCE(?3, hidden) WHERE code = ?1")
    .bind(code, input.name ?? null, input.hidden === undefined ? null : input.hidden ? 1 : 0)
    .run();
  return (await getAccount(db, code))!;
}

export type CategoryAccount = { categoryId: string; categoryName: string; accountCode: string };

/** The income account each kassa category books on; 8011 (kiosk) when none is chosen. */
export async function categoryAccounts(db: D1Database): Promise<CategoryAccount[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, COALESCE(a.account_code, '8011') AS account_code FROM categories c
       LEFT JOIN category_accounts a ON a.category_id = c.id ORDER BY c.sort, c.id`,
    )
    .all<{ id: string; name: string; account_code: string }>();
  return results.map((row) => ({ categoryId: row.id, categoryName: row.name, accountCode: row.account_code }));
}

/** Chooses the income account of some categories (the others stay as they are). Only income accounts and known categories. */
export async function setCategoryAccounts(db: D1Database, input: { categoryId: string; accountCode: string }[]): Promise<CategoryAccount[]> {
  const [categories, accounts] = await db.batch([
    db.prepare("SELECT id FROM categories"),
    db.prepare("SELECT code, kind FROM ledger_accounts"),
  ]);
  const known = new Set((categories!.results as { id: string }[]).map((row) => row.id));
  const kinds = new Map((accounts!.results as { code: string; kind: AccountKind }[]).map((row) => [row.code, row.kind]));
  const chosen = new Map<string, string>();
  for (const item of input) {
    if (!known.has(item.categoryId)) throw new LedgerError("category_unknown", 400);
    const kind = kinds.get(item.accountCode);
    if (!kind) throw new LedgerError("account_unknown", 400);
    if (kind !== "income") throw new LedgerError("not_income_account", 400);
    chosen.set(item.categoryId, item.accountCode);
  }
  if (chosen.size > 0) {
    await db.batch([
      ...[...chosen].map(([categoryId, accountCode]) =>
        db
          .prepare("INSERT INTO category_accounts (category_id, account_code) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET account_code = excluded.account_code")
          .bind(categoryId, accountCode),
      ),
      // The next syncs look at every open day again, under the new mapping.
      deleteLedgerSettingStatement(db, "ledger_kassa_synced_at"),
    ]);
  }
  return categoryAccounts(db);
}
