import { useState } from "react";
import type { ImportResult, MoneyAccount } from "../../../shared/ledger-types";
import { Problem, pillLink } from "../parts";
import { chunkStatement, readStatements } from "./bank-file";
import { explainWrite, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

const SOURCES = ["file", "enable_banking"];

/** The accounts that take a bank file. */
export const bankAccounts = (accounts: MoneyAccount[]): MoneyAccount[] => accounts.filter((account) => SOURCES.includes(account.source));

/** A refusal of an import, in words. */
function explainImport(status: number, error: string, account: string): string {
  if (error === "wrong_account") return `Dit bestand hoort bij een andere rekening (${account}).`;
  if (error === "identifier_missing") return "Vul eerst bij Instellingen het kenmerk van deze rekening in.";
  if (error === "not_a_bank_account") return "Dit is geen bankrekening.";
  if (error === "too_many_lines") return "Dit bestand heeft te veel regels op één dag.";
  return explainWrite(status, error);
}

/** "Bankbestand inlezen" for one account: the browser reads the file, the Worker gets the lines. */
export function BankUpload({ account, onDone }: { account: MoneyAccount; onDone(): void }) {
  const api = useLedgerWrites();
  const [busy, run] = useBusy();
  const [message, setMessage] = useState<{ problem: boolean; text: string } | null>(null);

  const upload = (file: File) =>
    run(async () => {
      setMessage(null);
      const read = await readStatements(file);
      if (!read.ok) return setMessage({ problem: true, text: "Dit is geen bankafschrift dat ik kan lezen (CAMT.053)." });
      const total: ImportResult = { added: 0, known: 0, beforeStart: 0, autoBooked: 0 };
      for (const statement of read.statements) {
        for (const part of chunkStatement(statement)) {
          const answer = await api.importStatement(account.accountCode, part);
          if (!answer.ok) {
            onDone();
            return setMessage({ problem: true, text: explainImport(answer.status, answer.error, statement.account) });
          }
          total.added += answer.data.added;
          total.known += answer.data.known;
          total.autoBooked += answer.data.autoBooked;
        }
      }
      setMessage({ problem: false, text: `${total.added} nieuw, ${total.known} al bekend, ${total.autoBooked} vanzelf geboekt.` });
      onDone();
    });

  return (
    <div className="flex flex-col items-start gap-2">
      <label className={`${pillLink} relative cursor-pointer has-[:disabled]:opacity-40`}>
        Bankbestand inlezen
        <input
          type="file"
          accept=".xml"
          disabled={busy}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      {message?.problem ? <Problem>{message.text}</Problem> : message && <p role="status" className="text-lg">{message.text}</p>}
    </div>
  );
}
