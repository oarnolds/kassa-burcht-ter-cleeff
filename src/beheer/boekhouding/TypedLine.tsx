import { useState, type FormEvent } from "react";
import type { MoneyAccount } from "../../../shared/ledger-types";
import { parseEuro } from "../../../shared/money";
import { Button } from "../../ui/Button";
import { Problem, Section, field, today } from "../parts";
import { explainWrite, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

const label = "flex flex-col gap-1 font-semibold";

/** An amount with a minus for money that went out: "-12,50" or "−12,50". */
export function parseSigned(text: string): number | null {
  const trimmed = text.trim();
  const out = /^[-−]/.test(trimmed);
  const cents = parseEuro(out ? trimmed.slice(1) : trimmed);
  return cents === null || cents === 0 ? null : out ? -cents : cents;
}

/** A bank line typed by hand: for an account without a file or a line the bank did not give. */
export function TypedLine({ accounts, onAdded }: { accounts: MoneyAccount[]; onAdded(): void }) {
  const api = useLedgerWrites();
  const [busy, run] = useBusy();
  const [accountCode, setAccountCode] = useState(accounts[0]?.accountCode ?? "");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [party, setParty] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const cents = parseSigned(amount);
  const ready = accountCode !== "" && date !== "" && cents !== null && description.trim() !== "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    void run(async () => {
      setProblem(null);
      const answer = await api.addBankLine({
        accountCode,
        date,
        amountCents: cents,
        description: description.trim(),
        ...(party.trim() ? { counterpartyName: party.trim() } : {}),
      });
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      setAmount("");
      setDescription("");
      setParty("");
      onAdded();
    });
  };

  return (
    <Section title="Regel intypen">
      <form onSubmit={submit} className="flex flex-col gap-3 px-2 sm:px-3">
        <label className={label}>
          Rekening
          <select className={field} value={accountCode} onChange={(event) => setAccountCode(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.accountCode} value={account.accountCode}>{`${account.accountCode} ${account.name}`}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Datum
          <input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={label}>
          Bedrag
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="-12,50 voor af"
            className={`${field} text-right tabular-nums`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {amount.trim() !== "" && cents === null && <span className="text-sm font-semibold text-redbrown">Dit bedrag kan ik niet lezen.</span>}
        <label className={label}>
          Omschrijving
          <input type="text" maxLength={200} className={field} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className={label}>
          Tegenpartij (mag leeg)
          <input type="text" maxLength={200} className={field} value={party} onChange={(event) => setParty(event.target.value)} />
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={!ready || busy}>
            Regel toevoegen
          </Button>
        </div>
        {problem && <Problem>{problem}</Problem>}
      </form>
    </Section>
  );
}
