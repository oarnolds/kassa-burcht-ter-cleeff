import { useMemo, useState } from "react";
import { MAX_LIFE_YEARS, parseAssetPaste, readLifeYears } from "../../../shared/asset-paste";
import { type Asset, type DepreciationPlan, LEDGER_START, type LedgerOverview } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section, amount, amountHead, cell, count, field, head, table, tableScroll, today } from "../parts";
import { type AdminData, useAdminData } from "../useAdmin";
import { AmountField } from "./AmountField";
import { FIRST_LEDGER_YEAR, explainWrite, ledgerPath, useLedgerWrites } from "./ledger-api";
import { repasteText } from "./ledger-alerts";
import { useBusy } from "./useBusy";

const firstYear = Number(LEDGER_START.slice(0, 4));
const thisYear = (): number => Math.max(Number(today().slice(0, 4)), firstYear);
/** The years whose depreciation can be booked: from the first year of the books up to this one. */
const years = (): number[] => Array.from({ length: thisYear() - firstYear + 1 }, (_, i) => firstYear + i);

const label = "flex flex-col gap-1 font-semibold";
const MAX_NAME = 60;

function AssetTable({ assets, onEdit, onDispose }: { assets: Asset[]; onEdit(asset: Asset): void; onDispose(asset: Asset): void }) {
  if (assets.length === 0) {
    return <p className="px-2 text-lg text-ink/70 sm:px-3">Er staan nog geen toestellen in de lijst. Plak het overzicht uit e-Boekhouden hieronder.</p>;
  }
  const inUse = assets.filter((asset) => asset.disposedOn === null);
  const sum = (pick: (asset: Asset) => number) => inUse.reduce((total, asset) => total + pick(asset), 0);
  return (
    <div className={tableScroll}>
      <table className={table}>
        <thead>
          <tr>
            <th className={head}>Naam</th>
            <th className={head}>Aankoopdatum</th>
            <th className={amountHead}>Aanschafwaarde</th>
            <th className={amountHead}>Restwaarde</th>
            <th className={head}>Levensduur</th>
            <th className={amountHead}>Afgeschreven</th>
            <th className={amountHead}>Boekwaarde</th>
            <th className={head}>
              <span className="sr-only">Acties</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id} className={`border-t border-sand ${asset.disposedOn ? "text-ink/60" : ""}`}>
              <td className={cell}>{asset.name}</td>
              <td className={`${cell} whitespace-nowrap tabular-nums`}>{asset.purchaseDate ? formatDateNl(asset.purchaseDate) : "nog niet geboekt"}</td>
              <td className={amount}>{formatEuro(asset.costCents)}</td>
              <td className={amount}>{formatEuro(asset.residualCents)}</td>
              <td className={`${cell} whitespace-nowrap`}>{`${asset.lifeYears} jaar`}</td>
              <td className={amount}>{formatEuro(asset.writtenOffCents)}</td>
              <td className={amount}>{formatEuro(asset.bookValueCents)}</td>
              <td className={cell}>
                {asset.disposedOn ? (
                  <span className="whitespace-nowrap">{`afgevoerd ${formatDateNl(asset.disposedOn)}`}</span>
                ) : (
                  // Side by side from a window of 1280 wide; in a narrower one they may go under each other, so nothing scrolls.
                  <span className="flex flex-wrap gap-2 xl:flex-nowrap">
                    <Button aria-label={`${asset.name} wijzigen`} onClick={() => onEdit(asset)}>
                      Wijzigen
                    </Button>
                    <Button aria-label={`${asset.name} afvoeren`} onClick={() => onDispose(asset)}>
                      Afvoeren
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink/30 font-semibold">
            <td className={cell} colSpan={2}>
              Totaal in gebruik
            </td>
            <td className={amount}>{formatEuro(sum((asset) => asset.costCents))}</td>
            <td className={cell} colSpan={2} />
            <td className={amount}>{formatEuro(sum((asset) => asset.writtenOffCents))}</td>
            <td className={amount}>{formatEuro(sum((asset) => asset.bookValueCents))}</td>
            <td className={cell} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Name, residual value and life of one toestel. */
function EditAsset({ asset, onClose, onSaved }: { asset: Asset; onClose(): void; onSaved(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [name, setName] = useState(asset.name);
  const [residual, setResidual] = useState<number | null>(asset.residualCents || null);
  const [residualBad, setResidualBad] = useState(false);
  const [lifeText, setLifeText] = useState(String(asset.lifeYears));
  const [problem, setProblem] = useState<string | null>(null);
  const lifeYears = readLifeYears(lifeText);
  const ready = name.trim() !== "" && lifeYears !== null && !residualBad;

  const save = () =>
    run(async () => {
      setProblem(null);
      // The name only when it changed: one taken over from e-Boekhouden may be longer than a new one can be.
      const renamed = name.trim() !== asset.name ? { name: name.trim() } : {};
      const answer = await api.patchAsset(asset.id, { ...renamed, residualCents: residual ?? 0, lifeYears: lifeYears! });
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Opgeslagen.");
      onSaved();
    });

  return (
    <Section title={`Wijzigen: ${asset.name}`}>
      <div className="flex flex-col gap-3 px-2 sm:px-3">
        <label className={label}>
          Naam
          <input type="text" maxLength={MAX_NAME} className={field} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className={label}>
          <span>Restwaarde</span>
          <AmountField label="Restwaarde" valueCents={residual} onChange={setResidual} onUnreadable={setResidualBad} className="w-40 text-right tabular-nums" />
        </div>
        <label className={label}>
          Levensduur in jaren
          <input type="text" inputMode="numeric" autoComplete="off" className={`${field} w-28`} value={lifeText} onChange={(event) => setLifeText(event.target.value)} />
        </label>
        {lifeYears === null && <span className="text-sm font-semibold text-redbrown">{`Een levensduur van 1 tot ${MAX_LIFE_YEARS} jaar.`}</span>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            Opslaan
          </Button>
          <Button onClick={onClose}>Annuleren</Button>
        </div>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </Section>
  );
}

/** "Afvoeren" on a date, asked once more: the depreciation up to that month, then the rest of the book value to 4601. */
function DisposeAsset({ asset, onClose, onDone }: { asset: Asset; onClose(): void; onDone(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [date, setDate] = useState(today());
  const [problem, setProblem] = useState<string | null>(null);

  const dispose = () =>
    run(async () => {
      setProblem(null);
      if (!window.confirm(`${asset.name} afvoeren op ${formatDateNl(date)}? De boekwaarde gaat naar afschrijving.`)) return;
      const answer = await api.disposeAsset(asset.id, date);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Afgevoerd.");
      onDone();
    });

  return (
    <Section
      title={`Afvoeren: ${asset.name}`}
      note="De afschrijving tot en met die maand wordt geboekt en de rest van de boekwaarde gaat naar 4601. Een opbrengst (verkoop) boek je apart op 8040."
    >
      <div className="flex flex-col gap-3 px-2 sm:px-3">
        <label className={label}>
          Datum van afvoeren
          <input type="date" className={`${field} w-48`} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" disabled={date === "" || busy} onClick={() => void dispose()}>
            Afvoeren
          </Button>
          <Button onClick={onClose}>Annuleren</Button>
        </div>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </Section>
  );
}

/** The state of a year's depreciation, in a sentence. */
function bookedText(plan: DepreciationPlan): string {
  if (!plan.booked) return "Nog niet geboekt.";
  const on = formatDateNl(`${plan.year}-12-31`);
  return plan.upToDate
    ? `Geboekt op ${on}. Opnieuw boeken vervangt die boeking.`
    : `Geboekt op ${on}, maar de bedragen zijn sindsdien veranderd. Opnieuw boeken past dat aan.`;
}

/**
 * "Afschrijving {jaar} boeken": the amount per toestel, booked on 31 December; booking again replaces it. Only in
 * year order: the Worker refuses a year before the one ahead of it is booked, or while a later year is booked;
 * "leegmaken" undoes a year, from the last one back. `year` is null until the Worker has said where to start.
 */
function Depreciation({ year, onYear, plan, onBooked }: { year: number | null; onYear(year: number): void; plan: AdminData<DepreciationPlan>; onBooked(year: number): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [problem, setProblem] = useState<string | null>(null);
  const shown = year;
  const options = shown === null || years().includes(shown) ? years() : [...years(), shown].sort();

  const explain = (status: number, error: string, data: DepreciationPlan): string => {
    if (error === "depreciation_first") return `Boek eerst de afschrijving van ${data.year - 1}.`;
    if (error === "depreciation_later") return `Er is al afgeschreven over ${data.laterBooked ?? data.year + 1}; pas dat eerst aan.`;
    return explainWrite(status, error);
  };
  const book = (data: DepreciationPlan, empty: boolean) =>
    run(async () => {
      setProblem(null);
      if (empty && !window.confirm(`De afschrijving van ${data.year} leegmaken? Daarna kan het jaar ervoor opnieuw worden geboekt.`)) return;
      const answer = await api.bookDepreciation(data.year, empty);
      if (!answer.ok) return setProblem(explain(answer.status, answer.error, data));
      toast.show(empty ? "Leeggemaakt." : "Geboekt.");
      onBooked(data.year);
    });

  return (
    <Section title={shown === null ? "Afschrijving" : `Afschrijving ${shown}`} note="Lineair, zoals e-Boekhouden het deed: debet 4601, credit 0135, op 31 december.">
      <div className="flex flex-col gap-3 px-2 sm:px-3">
        {shown !== null && (
          <label className="flex flex-wrap items-center gap-2 font-semibold">
            Jaar
            <select
              className={`${field} w-28`}
              value={shown}
              onChange={(event) => {
                setProblem(null);
                onYear(Number(event.target.value));
              }}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
        <Loaded from={plan}>
          {(data) => (
            <>
              {data.rows.length === 0 ? (
                <p className="text-lg text-ink/70">Er valt dit jaar niets af te schrijven.</p>
              ) : (
                <div className={tableScroll}>
                  <table className={table}>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.assetId} className="border-t border-sand first:border-t-0">
                          <td className={cell}>{row.name}</td>
                          <td className={amount}>{formatEuro(row.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-ink/30 font-semibold">
                        <td className={cell}>Totaal</td>
                        <td className={amount}>{formatEuro(data.totalCents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="text-ink/70">{bookedText(data)}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy || plan.loading || (data.totalCents === 0 && !data.booked)} onClick={() => void book(data, false)}>
                  {`Afschrijving ${data.year} boeken`}
                </Button>
                {data.booked && (
                  <Button disabled={busy || plan.loading} onClick={() => void book(data, true)}>
                    {`Afschrijving ${data.year} leegmaken`}
                  </Button>
                )}
              </div>
            </>
          )}
        </Loaded>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </Section>
  );
}

/** Why a paste was refused; the rest as on every page. */
function explainPaste(status: number, error: string): string {
  if (error === "asset_disposed") return "Er is al een toestel uit de lijst afgevoerd. De lijst uit e-Boekhouden kan niet meer worden vervangen.";
  return explainWrite(status, error);
}

/**
 * The overview "Vaste activa" from e-Boekhouden, read in the browser: what was read and what was skipped, before
 * "Overnemen". `repaste`: the list in the books was pasted before the books moved to 2026, so it is asked for again.
 */
function Paste({ repaste, onDone }: { repaste: boolean; onDone(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const read = useMemo(() => parseAssetPaste(text), [text]);
  const sum = (pick: (asset: (typeof read.assets)[number]) => number) => read.assets.reduce((total, asset) => total + pick(asset), 0);

  const take = () =>
    run(async () => {
      setProblem(null);
      const answer = await api.pasteAssets(read.assets);
      if (!answer.ok) return setProblem(explainPaste(answer.status, answer.error));
      setText("");
      toast.show("Overgenomen.");
      onDone();
    });

  return (
    <Section
      title="Plakken uit e-Boekhouden"
      note="Kopieer in e-Boekhouden het overzicht Vaste activa 2026 en plak het hier. De app neemt de stand van 1 januari 2026 over en boekt de afschrijving van 2026 zelf. Overnemen vervangt wat eerder is overgenomen; gekochte toestellen blijven staan. De restwaarde staat er niet in: vul die daarna per toestel in."
    >
      <div className="flex flex-col gap-3 px-2 sm:px-3">
        {repaste && <p className="font-semibold text-redbrown">{repasteText}</p>}
        <label className={label}>
          Overzicht uit e-Boekhouden
          <textarea className={`${field} min-h-32 py-2 font-normal`} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {text.trim() !== "" && (
          <>
            <p className="font-semibold">{`${count(read.assets.length, "toestel", "toestellen")} gelezen`}</p>
            {read.assets.length > 0 && (
              <div className={tableScroll}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th className={head}>Naam</th>
                      <th className={head}>Aankoopdatum</th>
                      <th className={amountHead}>Aanschafwaarde</th>
                      <th className={amountHead}>{`Afgeschreven t/m ${FIRST_LEDGER_YEAR - 1}`}</th>
                      <th className={amountHead}>Boekwaarde</th>
                      <th className={head}>Levensduur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.assets.map((asset, index) => (
                      <tr key={index} className="border-t border-sand">
                        <td className={cell}>{asset.name}</td>
                        <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatDateNl(asset.purchaseDate)}</td>
                        <td className={amount}>{formatEuro(asset.costCents)}</td>
                        <td className={amount}>{formatEuro(asset.writtenOffCents)}</td>
                        <td className={amount}>{formatEuro(asset.costCents - asset.writtenOffCents)}</td>
                        <td className={`${cell} whitespace-nowrap`}>{`${asset.lifeYears} jaar`}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink/30 font-semibold">
                      <td className={cell} colSpan={2}>
                        Totaal
                      </td>
                      <td className={amount}>{formatEuro(sum((asset) => asset.costCents))}</td>
                      <td className={amount}>{formatEuro(sum((asset) => asset.writtenOffCents))}</td>
                      <td className={amount}>{formatEuro(sum((asset) => asset.costCents - asset.writtenOffCents))}</td>
                      <td className={cell} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {read.skipped.length > 0 && (
              <>
                <p className="font-semibold">{`${count(read.skipped.length, "regel", "regels")} overgeslagen`}</p>
                <ul className="flex flex-col gap-1 text-ink/70">
                  {read.skipped.map((line, index) => (
                    <li key={index} className="break-all">
                      {line}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <div>
          <Button variant="primary" disabled={read.assets.length === 0 || busy} onClick={() => void take()}>
            Overnemen
          </Button>
        </div>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </Section>
  );
}

/** Toestellen: the list behind 0130 and 0135, its depreciation per year, disposal, and the list taken over from e-Boekhouden. */
export function AssetsPage() {
  const assets = useAdminData<Asset[]>(ledgerPath.assets);
  // Only for whether a list pasted before the books moved to 2026 must be pasted again.
  const overview = useAdminData<LedgerOverview>(ledgerPath.overview);
  // The year chosen; until then the Worker's: the earliest open year still to book. Booking a year stays on it.
  const [year, setYear] = useState<number | null>(null);
  const plan = useAdminData<DepreciationPlan>(ledgerPath.depreciation(year));
  const [editing, setEditing] = useState<Asset | null>(null);
  const [disposing, setDisposing] = useState<Asset | null>(null);
  const reload = () => {
    assets.reload();
    plan.reload();
  };

  return (
    <div>
      <PageTitle>Toestellen</PageTitle>
      <Loaded from={assets}>
        {(list) => (
          <Section title="Lijst" note="Speeltoestellen en inventaris, met wat er tot nu toe is geboekt.">
            <AssetTable
              assets={list}
              onEdit={(asset) => {
                setDisposing(null);
                setEditing(asset);
              }}
              onDispose={(asset) => {
                setEditing(null);
                setDisposing(asset);
              }}
            />
          </Section>
        )}
      </Loaded>
      {editing && (
        <EditAsset
          key={editing.id}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {disposing && (
        <DisposeAsset
          key={disposing.id}
          asset={disposing}
          onClose={() => setDisposing(null)}
          onDone={() => {
            setDisposing(null);
            reload();
          }}
        />
      )}
      <Depreciation
        year={year ?? plan.data?.year ?? null}
        onYear={setYear}
        plan={plan}
        onBooked={(booked) => {
          setYear(booked);
          reload();
        }}
      />
      <Paste
        repaste={overview.data?.assetsRepasteNeeded === true}
        onDone={() => {
          reload();
          overview.reload();
        }}
      />
    </div>
  );
}
