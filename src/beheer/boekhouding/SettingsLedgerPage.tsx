import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { AccountKind, ConsentState, LedgerAccount, MoneyAccount, MoneySource } from "../../../shared/ledger-types";
import { businessDate, formatDateNl } from "../../../shared/time";
import { leavePage } from "../../lib/leave";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section, field, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { explainWrite, ledgerPath, useLedgerWrites, type CategoryAccount } from "./ledger-api";

const label = "flex flex-col gap-1 font-semibold";
const kindName: Record<AccountKind, string> = { asset: "bezit", liability: "schuld", equity: "vermogen", expense: "kosten", income: "opbrengst" };
const kinds: AccountKind[] = ["asset", "liability", "equity", "expense", "income"];

/** A sentence for a refusal or a failure of one of these forms. */
function explain(status: number, error: string): string {
  if (status === 0) return "Geen verbinding. Probeer het opnieuw.";
  if (error === "money_account") return "Een geldrekening kan niet worden verborgen.";
  if (error === "account_exists") return "Dit rekeningnummer bestaat al.";
  if (error === "source_fixed") return "De bron van deze rekening ligt vast.";
  if (error === "invalid") return "Controleer de invoer en probeer het opnieuw.";
  return "Opslaan is niet gelukt. Probeer het opnieuw.";
}

function AccountRow({ account, onChanged }: { account: LedgerAccount; onChanged(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(account.name);
  const [problem, setProblem] = useState<string | null>(null);

  const patch = async (body: { name?: string; hidden?: boolean }) => {
    setProblem(null);
    const answer = await api.patchAccount(account.code, body);
    if (!answer.ok) return setProblem(explain(answer.status, answer.error));
    setRenaming(false);
    toast.show("Opgeslagen.");
    onChanged();
  };

  return (
    <li className="flex flex-col gap-2 border-t border-sand px-2 py-3 first:border-t-0 sm:px-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-14 font-semibold tabular-nums">{account.code}</span>
        <span className={`min-w-0 flex-1 text-lg ${account.hidden ? "text-ink/50" : ""}`}>{account.name}</span>
        <span className="text-ink/70">{kindName[account.kind]}</span>
        {account.hidden && <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">verborgen</span>}
        <Button
          onClick={() => {
            setName(account.name);
            setRenaming(!renaming);
          }}
        >
          Naam wijzigen
        </Button>
        {account.money ? (
          <span className="text-ink/70">Een geldrekening kan niet worden verborgen.</span>
        ) : (
          <Button onClick={() => void patch({ hidden: !account.hidden })}>{account.hidden ? "Tonen" : "Verbergen"}</Button>
        )}
      </div>
      {renaming && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void patch({ name: name.trim() });
          }}
        >
          <label className={label}>
            Nieuwe naam
            <input className={field} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
          <Button type="submit" variant="primary">
            Bewaren
          </Button>
        </form>
      )}
      {problem && <Problem>{problem}</Problem>}
    </li>
  );
}

function AddAccount({ onAdded }: { onAdded(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("expense");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const answer = await api.addAccount({ code: code.trim(), name: name.trim(), kind });
    if (!answer.ok) return setProblem(explain(answer.status, answer.error));
    setCode("");
    setName("");
    toast.show("Opgeslagen.");
    onAdded();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-wrap items-end gap-3 border-t-2 border-sand px-2 pt-4 sm:px-3">
      <label className={label}>
        Nummer
        <input className={`${field} w-28`} value={code} inputMode="numeric" maxLength={4} onChange={(event) => setCode(event.target.value)} />
      </label>
      <label className={label}>
        Naam
        <input className={field} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={label}>
        Soort
        <select className={field} value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
          {kinds.map((one) => (
            <option key={one} value={one}>
              {kindName[one]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary" disabled={!/^\d{4}$/.test(code.trim()) || !name.trim()}>
        Rekening toevoegen
      </Button>
      {problem && <Problem>{problem}</Problem>}
    </form>
  );
}

function MoneyRow({ initial }: { initial: MoneyAccount }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [account, setAccount] = useState(initial);
  const [identifier, setIdentifier] = useState(initial.identifier ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const fixed = account.source === "kassa" || account.source === "mollie";

  const patch = async (body: { identifier?: string | null; source?: MoneySource }) => {
    setProblem(null);
    const answer = await api.patchMoneyAccount(account.accountCode, body);
    if (!answer.ok) return setProblem(explain(answer.status, answer.error));
    setAccount(answer.data);
    toast.show("Opgeslagen.");
  };

  return (
    <li className="flex flex-col gap-3 border-t border-sand px-2 py-3 first:border-t-0 sm:px-3">
      <p className="text-lg font-semibold">
        <span className="tabular-nums">{account.accountCode}</span> {account.name}
      </p>
      {account.source === "kassa" && <p>Kas: volgt de kassa</p>}
      {account.source === "mollie" && <p>Mollie: volgt Mollie</p>}
      {!fixed && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className={label}>
              Kenmerk (IBAN of spaarnummer)
              <input className={`${field} w-72 max-w-full`} value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </label>
            <Button onClick={() => void patch({ identifier: identifier.trim() || null })}>Opslaan</Button>
          </div>
          <div role="radiogroup" aria-label={`Bron van ${account.name}`} className="flex flex-col gap-1">
            {(
              [
                ["enable_banking", "Automatisch via Enable Banking"],
                ["file", "Bankbestand uploaden of met de hand"],
              ] as [MoneySource, string][]
            ).map(([source, text]) => (
              <label key={source} className="flex min-h-11 items-center gap-3 text-lg">
                <input
                  type="radio"
                  name={`source-${account.accountCode}`}
                  className="size-6"
                  checked={account.source === source}
                  onChange={() => void patch({ source })}
                />
                {text}
              </label>
            ))}
          </div>
        </>
      )}
      {problem && <Problem>{problem}</Problem>}
    </li>
  );
}

/** The consent for ING in words. */
function consentText(state: ConsentState): string {
  const day = state.validUntil ? formatDateNl(businessDate(state.validUntil)) : "";
  if (state.status === "active") return `Gekoppeld tot ${day}`;
  if (state.status === "expired") return `Verlopen op ${day}`;
  if (state.status === "pending") return "Bezig met koppelen";
  return "Niet gekoppeld";
}

/** ING betaal's automatic connection: where it stands, and the way to make or renew it at the bank. */
function IngBlock() {
  const api = useLedgerWrites();
  const consent = useAdminData<ConsentState>(ledgerPath.ingConsent);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    const answer = await api.connectIng();
    if (!answer.ok) {
      setBusy(false);
      return setProblem(explainWrite(answer.status, answer.error));
    }
    leavePage(answer.data.url);
  };

  return (
    <Section title="ING automatisch" note="De betaalrekening van ING haalt zijn regels zelf op, met jouw toestemming bij de bank.">
      <Loaded from={consent}>
        {(state) => (
          <div className="flex flex-col items-start gap-3 px-2 sm:px-3">
            <p className="text-lg font-semibold">{consentText(state)}</p>
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              {state.status === "none" ? "ING koppelen" : "Vernieuwen"}
            </Button>
            {problem && <Problem>{problem}</Problem>}
          </div>
        )}
      </Loaded>
    </Section>
  );
}

function CategoryForm({ categories, accounts }: { categories: CategoryAccount[]; accounts: LedgerAccount[] }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [chosen, setChosen] = useState(() => Object.fromEntries(categories.map((one) => [one.categoryId, one.accountCode])));
  const [problem, setProblem] = useState<string | null>(null);
  const income = accounts.filter((one) => one.kind === "income");

  const save = async () => {
    setProblem(null);
    const answer = await api.putCategoryAccounts(categories.map((one) => ({ categoryId: one.categoryId, accountCode: chosen[one.categoryId]! })));
    if (!answer.ok) return setProblem(explain(answer.status, answer.error));
    toast.show("Opgeslagen.");
  };

  return (
    <div className="flex flex-col gap-3 px-2 sm:px-3">
      {categories.map((one) => (
        <label key={one.categoryId} className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          {one.categoryName}
          <select
            className={`${field} font-normal`}
            value={chosen[one.categoryId]}
            onChange={(event) => setChosen({ ...chosen, [one.categoryId]: event.target.value })}
          >
            {income
              .filter((account) => !account.hidden || account.code === one.accountCode)
              .map((account) => (
                <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
              ))}
          </select>
        </label>
      ))}
      <div>
        <Button variant="primary" onClick={() => void save()}>
          Opslaan
        </Button>
      </div>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}

/** Boekhouding → Instellingen: the chart of accounts, the money accounts and where the kassa's turnover goes. */
export function SettingsLedgerPage() {
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const money = useAdminData<MoneyAccount[]>(ledgerPath.moneyAccounts);
  const categories = useAdminData<CategoryAccount[]>(ledgerPath.categoryAccounts);

  return (
    <div>
      <PageTitle>Instellingen</PageTitle>
      <Section title="Rekeningen">
        <Loaded from={accounts}>
          {(list) => (
            <>
              <ul>
                {list.map((account) => (
                  <AccountRow key={`${account.code}-${account.name}-${account.hidden}`} account={account} onChanged={accounts.reload} />
                ))}
              </ul>
              <AddAccount onAdded={accounts.reload} />
            </>
          )}
        </Loaded>
      </Section>
      <Section title="Geldrekeningen">
        <Loaded from={money}>
          {(list) => (
            <ul>
              {list.map((account) => (
                <MoneyRow key={account.accountCode} initial={account} />
              ))}
            </ul>
          )}
        </Loaded>
      </Section>
      <IngBlock />
      <Section title="Omzet van de kassa" note="Op welke opbrengstrekening de omzet van elke kassa-categorie komt.">
        <Loaded from={categories}>
          {(list) => (accounts.data ? <CategoryForm categories={list} accounts={accounts.data} /> : null)}
        </Loaded>
      </Section>
      <Section title="Eenmalig">
        <ul className="flex flex-col gap-2 px-2 text-lg sm:px-3">
          <li>
            <Link to="/beheer/boekhouding/beginbalans" className={textLink}>
              Beginbalans
            </Link>
          </li>
          <li>
            <Link to="/beheer/boekhouding/vergelijking" className={textLink}>
              Vergelijkingscijfers 2026
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  );
}
