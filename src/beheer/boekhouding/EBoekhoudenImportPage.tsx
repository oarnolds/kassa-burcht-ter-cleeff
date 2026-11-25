import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { type EbStatus, type EbSummary, type LedgerAccount, MAX_ENTRIES, OVERSTAP } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl, shiftDate } from "../../../shared/time";
import type { XafFile } from "../../../shared/xaf";
import { mapXaf, type XafPlan } from "../../../shared/xaf-map";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Problem, Section, amount, amountHead, cell, count, field, head, pillLink, table, tableScroll, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { explainImport, ledgerPath, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

const NOT_READ: Record<"not_auditfile" | "unbalanced" | "not_2026", string> = {
  not_auditfile: "Dit is geen auditbestand van e-Boekhouden.",
  not_2026: "Dit auditbestand gaat niet over 2026.",
  unbalanced: "Er staat een boeking in die niet sluit; download het bestand opnieuw.",
};
const REPLACE = "Er staan al boekingen uit e-Boekhouden. Vervangen door dit bestand?";
const YEAR_CLOSED = "2026 is afgesloten; heropen het jaar eerst.";
/** The last day the auditfile books; from OVERSTAP on, the bank lines are the app's. */
const LAST_DAY = shiftDate(OVERSTAP, -1);
/** The toestellen run through the list at Toestellen: a booking on these blocks "Overnemen", so none is offered as a place. */
const ASSET_ACCOUNTS = ["0130", "0135", "4601"];
/** A payment from the overstap on of what is open on these belongs on them, not on income or costs (spec §7.3). */
const OPEN_ITEMS = ["1300", "1700"];
const KAS = "1000";
const REVOLUT = "1012";

type Read = { file: XafFile; plan: XafPlan };
type Chart = Map<string, LedgerAccount>;
type Booking = { ref: string; date: string; description: string };

/** A ledger amount (debit +, credit −) as the balance shows it: an asset as it is, a liability or equity the other way round. */
const asShown = (account: LedgerAccount | undefined, cents: number) => (account && account.kind !== "asset" ? 0 - cents : cents);
const nameOf = (chart: Chart, code: string) => `${code} ${chart.get(code)?.name ?? ""}`.trim();

/** The bookings as the penningmeester finds them back in e-Boekhouden: date and description. */
function Bookings({ list }: { list: Booking[] }) {
  return (
    <ul className="mt-2 px-2 sm:px-3">
      {list.map((booking) => (
        <li key={booking.ref} className="border-t border-sand py-1 first:border-t-0">{`${formatDateNl(booking.date)} ${booking.description}`}</li>
      ))}
    </ul>
  );
}

/** 1300 and 1700 when they are not at zero at the end of 24-11. */
function OpenItems({ items, chart }: { items: { accountCode: string; cents: number }[]; chart: Chart }) {
  if (items.length === 0) return null;
  return (
    <Section title="Open op 24 november">
      <ul className="px-2 text-lg sm:px-3">
        {items.map((item) => (
          <li key={item.accountCode}>{`${nameOf(chart, item.accountCode)}: ${formatEuro(asShown(chart.get(item.accountCode), item.cents))}`}</li>
        ))}
      </ul>
      <p className="mt-2 px-2 font-semibold sm:px-3">Boek de betaling hiervan in Te boeken op 1300 (of 1700).</p>
    </Section>
  );
}

/** Account, name and amount, one row each, with rows below for what is not an account. */
function AmountTable({ rows, chart, children }: { rows: { accountCode: string; cents: number }[]; chart: Chart; children?: ReactNode }) {
  return (
    <div className={tableScroll}>
      <table className={table}>
        <thead>
          <tr>
            <th className={head}>Nummer</th>
            <th className={head}>Naam</th>
            <th className={amountHead}>Bedrag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.accountCode} className="border-t border-sand">
              <td className={`${cell} tabular-nums`}>{row.accountCode}</td>
              <td className={cell}>{chart.get(row.accountCode)?.name}</td>
              <td className={amount}>{formatEuro(asShown(chart.get(row.accountCode), row.cents))}</td>
            </tr>
          ))}
          {children}
        </tbody>
      </table>
    </div>
  );
}

function SumRow({ name, cents }: { name: string; cents: number }) {
  return (
    <tr className="border-t-2 border-ink/30 font-semibold">
      <td className={cell} colSpan={2}>
        {name}
      </td>
      <td className={amount}>{formatEuro(cents)}</td>
    </tr>
  );
}

/**
 * What the file holds, laid onto the app's accounts, before anything is saved; then "Overnemen". An unknown account
 * gets its place here (for this reading only), and the file is laid out again with it.
 */
function ReadFile(props: {
  read: Read;
  accounts: LedgerAccount[];
  chart: Chart;
  status: EbStatus;
  busy: boolean;
  run: (job: () => Promise<void>) => Promise<void>;
  onDone(summary: EbSummary): void;
}) {
  const { read, accounts, chart, status, busy, run, onDone } = props;
  const api = useLedgerWrites();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState(read.plan);
  const [sent, setSent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const total = plan.entries.length;
  const skipped = plan.skippedFromOverstap;
  // Lines on an unplaced account keep their old number, and a toestel is booked at Toestellen: neither may go in.
  const blocked = plan.unplaced.length > 0 || plan.assetLines.length > 0;
  const offered = accounts.filter((account) => !account.hidden && !ASSET_ACCOUNTS.includes(account.code));
  // How far e-Boekhouden's own opening is from closing: its equity less its assets and debts.
  const difference = 0 - read.file.opening.reduce((sum, line) => sum + line.amountCents, 0);

  const place = (code: string, to: string) => {
    const next = { ...choices, [code]: to };
    setChoices(next);
    setPlan(mapXaf(read.file, accounts, { kassaSince: status.inUseSince, choices: next }));
  };

  const save = () =>
    run(async () => {
      setProblem(null);
      if (status.done && !window.confirm(REPLACE)) return;
      const refused = (answer: { status: number; error: string }) => {
        setSent(null);
        setProblem(explainImport(answer.status, answer.error));
      };
      setSent(0);
      const started = await api.startEboekhouden({ createdOn: plan.createdOn, opening: plan.opening, ebEquityCents: plan.ebEquityCents, payouts: plan.payouts });
      if (!started.ok) return refused(started);
      // One chunk after the other. A refusal stops here: the finish only checks that each booking is there, so it
      // must never come after a chunk that did not go in.
      for (let from = 0; from < total; from += MAX_ENTRIES) {
        const chunk = plan.entries.slice(from, from + MAX_ENTRIES);
        const answer = await api.sendEboekhoudenEntries(chunk);
        if (!answer.ok) return refused(answer);
        setSent(from + chunk.length);
      }
      const finished = await api.finishEboekhouden({ createdOn: plan.createdOn, refs: plan.entries.map((entry) => entry.ref) });
      if (!finished.ok) return refused(finished);
      onDone(finished.data);
    });

  return (
    <>
      <Section title="Het bestand">
        <div className="flex flex-col gap-1 px-2 text-lg sm:px-3">
          <p>{`Boekjaar ${plan.year}, gemaakt op ${formatDateNl(plan.createdOn)}`}</p>
          <p>{`${count(total, "boeking", "boekingen")} van 1 januari tot en met 24 november; ${skipped} vanaf 25 november ${skipped === 1 ? "wordt" : "worden"} overgeslagen`}</p>
        </div>
      </Section>
      <Section
        title="Beginbalans 1 januari 2026"
        note="Per rekening van de app, zoals de balans ze toont. 0130 en 0135 komen uit de lijst bij Toestellen, 1030 Mollie begint op nul en het eigen vermogen rekent de app zelf uit. Dat van e-Boekhouden en het verschil in zijn beginbalans zijn ter informatie."
      >
        <AmountTable rows={plan.opening.map((line) => ({ accountCode: line.accountCode, cents: line.amountCents }))} chart={chart}>
          <SumRow name="Eigen vermogen in e-Boekhouden" cents={plan.ebEquityCents} />
          <SumRow name="Verschil in de beginbalans van e-Boekhouden" cents={difference} />
        </AmountTable>
      </Section>
      <Section title="Rekeningen" note="Van de rekening in e-Boekhouden naar de rekening in de app.">
        <div className={tableScroll}>
          <table className={table}>
            <thead>
              <tr>
                <th className={head}>Oud</th>
                <th className={head}>Naam in e-Boekhouden</th>
                <th className={head}>In de app</th>
              </tr>
            </thead>
            <tbody>
              {plan.mapping.map((row) => (
                <tr key={row.from} className="border-t border-sand">
                  <td className={`${cell} tabular-nums`}>{row.from}</td>
                  <td className={cell}>{row.name}</td>
                  <td className={cell}>
                    {row.to === null ? <span className="font-semibold text-redbrown">nog geen plek</span> : nameOf(chart, row.to)}
                    {row.from === REVOLUT && <span className="block text-sm text-ink/70">Revolut: niet in de app, via 1080</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {plan.fallenAway.length > 0 && (
        <Section title="Vallen weg (beide kanten op dezelfde rekening)">
          <Bookings list={plan.fallenAway} />
        </Section>
      )}
      <Section title="Saldo's aan het eind van 24 november" note="Volgens het bestand, op de rekeningen van de app.">
        <AmountTable rows={plan.atSwitch} chart={chart} />
      </Section>

      {read.plan.unplaced.length > 0 && (
        <Section title="Nog geen plek" note="Deze rekeningen uit e-Boekhouden kent de app niet. Kies voor elk een rekening; die keuze geldt alleen voor dit inlezen.">
          <ul className="px-2 sm:px-3">
            {read.plan.unplaced.map(({ code, name }) => {
              const label = `${code} ${name}`.trim();
              return (
                <li key={code} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
                  <span className="text-lg">{label}</span>
                  <select aria-label={`Rekening voor ${label}`} className={field} value={choices[code] ?? ""} onChange={(event) => place(code, event.target.value)}>
                    <option value="">Kies een rekening</option>
                    {offered.map((account) => (
                      <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {plan.assetLines.length > 0 && (
        <Section title="Op een toestel-rekening">
          <div className="px-2 sm:px-3">
            <Problem>Deze boekingen staan op een toestel-rekening. Haal ze weg in e-Boekhouden, lees opnieuw in en leg het toestel vast bij Toestellen.</Problem>
          </div>
          <Bookings list={plan.assetLines} />
        </Section>
      )}
      {plan.kassaLines.length > 0 && status.inUseSince && (
        <Section title="Kassa-omzet">
          <p className="px-2 text-lg font-semibold sm:px-3">{`De app boekt de kassa vanaf ${formatDateNl(status.inUseSince)} zelf. Haal deze boekingen weg in e-Boekhouden en lees opnieuw in.`}</p>
          <Bookings list={plan.kassaLines} />
        </Section>
      )}
      <OpenItems items={plan.atSwitch.filter((item) => OPEN_ITEMS.includes(item.accountCode) && item.cents !== 0)} chart={chart} />

      <div className="mt-6 flex flex-col items-start gap-3">
        <Button variant="primary" disabled={busy || blocked} onClick={() => void save()}>
          Overnemen
        </Button>
        {sent !== null && <p role="status" className="text-lg tabular-nums">{`${sent} van ${total}`}</p>}
        {problem && <Problem>{problem}</Problem>}
      </div>
    </>
  );
}

/** What the books hold at the end of 24-11 once the file is in: the kas next to the kluisje, each money account next to its bank. */
function Done({ summary, chart }: { summary: EbSummary; chart: Chart }) {
  const { ledgerCents, kluisjeCents } = summary.cash;
  const { imported, emptied } = summary;
  return (
    <>
      <Section title="Overgenomen">
        <div className="flex flex-col gap-1 px-2 text-lg sm:px-3">
          <p>{`${count(imported, "boeking", "boekingen")} uit e-Boekhouden ${imported === 1 ? "staat" : "staan"} nu in de boeken.`}</p>
          {emptied > 0 && (
            <p>
              {emptied === 1
                ? "1 boeking is leeggemaakt, omdat hij niet meer in het bestand staat."
                : `${emptied} boekingen zijn leeggemaakt, omdat ze niet meer in het bestand staan.`}
            </p>
          )}
        </div>
      </Section>
      <Section title="Kas">
        <div className="flex flex-col gap-2 px-2 text-lg sm:px-3">
          <p>{`1000 Kas in de boeken: ${formatEuro(ledgerCents)}; in het kluisje volgens de kassa: ${formatEuro(kluisjeCents)}`}</p>
          {ledgerCents !== kluisjeCents && (
            <p className="font-semibold">
              Boek het verschil één keer met een gewone boeking. Kwam het wisselgeld uit de oude kas, dan tegen de rekening waar het vandaan kwam; anders op 4515
              Kasverschillen.
            </p>
          )}
        </div>
      </Section>
      <OpenItems items={summary.open} chart={chart} />
      <Section title="Geldrekeningen op 24 november">
        <ul className="px-2 sm:px-3">
          {summary.money
            .filter((account) => account.accountCode !== KAS)
            .map((account) => {
              const name = chart.get(account.accountCode)?.name ?? account.accountCode;
              return (
                <li key={account.accountCode} aria-label={name} className="flex flex-col gap-1 border-t border-sand py-3 first:border-t-0">
                  <span className="text-lg font-semibold">{name}</span>
                  <span className="flex flex-wrap justify-between gap-x-4">
                    <span>Saldo in de boekhouding</span>
                    <strong className="tabular-nums">{formatEuro(account.ledgerCents)}</strong>
                  </span>
                  {account.bankCents === null || account.bankDate === null ? (
                    <span className="text-ink/70">{`Geen saldo van de bank op of vóór ${formatDateNl(LAST_DAY)}.`}</span>
                  ) : (
                    <>
                      <span className="flex flex-wrap justify-between gap-x-4">
                        <span>{`Saldo bij de bank op ${formatDateNl(account.bankDate)}`}</span>
                        <strong className="tabular-nums">{formatEuro(account.bankCents)}</strong>
                      </span>
                      <span className={account.ledgerCents === account.bankCents ? "text-ink/70" : "font-semibold text-redbrown"}>
                        {`verschil ${formatEuro(account.ledgerCents - account.bankCents)}`}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
        </ul>
        <p className="mt-3 px-2 text-ink/70 sm:px-3">
          De kassa, ING en Mollie worden vannacht bijgewerkt, of nu met Nu bijwerken op{" "}
          <Link to="/beheer/boekhouding" className={textLink}>
            het overzicht
          </Link>
          .
        </p>
      </Section>
    </>
  );
}

function Reader({ status, accounts, onDone }: { status: EbStatus; accounts: LedgerAccount[]; onDone(): void }) {
  // One job at a time for the whole page: no other file while "Overnemen" runs.
  const [busy, run] = useBusy();
  const [read, setRead] = useState<Read | null>(null);
  const [summary, setSummary] = useState<EbSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A new key for each file read, so the choices of the one before do not stay.
  const [round, setRound] = useState(0);
  const chart: Chart = new Map(accounts.map((account) => [account.code, account]));

  const readFile = (file: File) =>
    run(async () => {
      setProblem(null);
      setRead(null);
      setSummary(null);
      try {
        const { readXafFile } = await import("./xaf-file");
        const answer = await readXafFile(file, accounts, { kassaSince: status.inUseSince, choices: {} });
        if (!answer.ok) return setProblem(NOT_READ[answer.error]);
        setRound((n) => n + 1);
        setRead({ file: answer.file, plan: answer.plan });
      } catch {
        setProblem("Het bestand kon niet worden gelezen. Probeer het opnieuw.");
      }
    });

  return (
    <>
      <Section title="Stand van het inlezen">
        <div className="flex flex-col gap-1 px-2 text-lg sm:px-3">
          <p>
            {status.done && status.createdOn
              ? `Ingelezen uit het auditbestand van ${formatDateNl(status.createdOn)}: ${count(status.imported, "boeking", "boekingen")}`
              : "Nog niet ingelezen"}
          </p>
          {status.yearClosed && <p className="font-semibold">{YEAR_CLOSED}</p>}
        </div>
      </Section>
      <Section
        title="Inlezen"
        note="Download in e-Boekhouden het auditbestand van 2026 en kies het hier. Er wordt pas iets opgeslagen met Overnemen. Opnieuw inlezen kan zolang 2026 open is, bijvoorbeeld na een correctie in e-Boekhouden."
      >
        <div className="flex flex-col items-start gap-2 px-2 sm:px-3">
          <label className={`${pillLink} relative cursor-pointer has-[:disabled]:opacity-40`}>
            Kies het auditbestand (.xaf)
            <input
              type="file"
              accept=".xaf"
              disabled={busy}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void readFile(file);
              }}
            />
          </label>
          {problem && <Problem>{problem}</Problem>}
        </div>
      </Section>
      {read && (
        <ReadFile
          key={round}
          read={read}
          accounts={accounts}
          chart={chart}
          status={status}
          busy={busy}
          run={run}
          onDone={(done) => {
            setRead(null);
            setSummary(done);
            onDone();
          }}
        />
      )}
      {summary && <Done summary={summary} chart={chart} />}
    </>
  );
}

/**
 * "2026 uit e-Boekhouden inlezen" (spec §7): the auditfile is read in the browser and shown before anything is saved;
 * "Overnemen" writes the opening of 1 January and the bookings up to 24 November. Until then the app books nothing by
 * itself. Reading in again, while 2026 is open, replaces what came from the file before.
 */
export function EBoekhoudenImportPage() {
  const status = useAdminData<EbStatus>(ledgerPath.eboekhoudenStatus);
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  return (
    <div>
      <PageTitle>2026 uit e-Boekhouden inlezen</PageTitle>
      <p className="mt-2 text-lg text-ink/70">
        Tot en met 24 november 2026 staan de boeken in e-Boekhouden. Met het auditbestand komen de beginbalans en die boekingen in de app; pas daarna boekt de
        app zelf.
      </p>
      <Loaded from={status}>{(found) => <Loaded from={accounts}>{(chart) => <Reader status={found} accounts={chart} onDone={status.reload} />}</Loaded>}</Loaded>
    </div>
  );
}
