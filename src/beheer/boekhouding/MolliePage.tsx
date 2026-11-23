import { useSearchParams } from "react-router";
import type { LedgerAccount, MollieMonth } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl, monthOf } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Section, amount, cell, table, tableScroll, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { ledgerPath } from "./ledger-api";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthName = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });

function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number! - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Rows of a label and an amount; "Geen." without any. */
function Amounts({ rows }: { rows: { key: string; label: string; cents: number }[] }) {
  if (rows.length === 0) return <p className="px-2 text-ink/70 sm:px-3">Geen.</p>;
  return (
    <div className={tableScroll}>
      <table className={table}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-sand first:border-t-0">
              <td className={cell}>{row.label}</td>
              <td className={amount}>{formatEuro(row.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthView({ data, names }: { data: MollieMonth; names: Map<string, string> }) {
  const { balance } = data;
  return (
    <>
      <Section title="Pin" note="De pinbetalingen van de kassa naast die van de terminal bij Mollie.">
        <Amounts
          rows={[
            { key: "kassa", label: "Pin in de kassa", cents: data.kassaPinCents },
            { key: "mollie", label: "Pin bij Mollie", cents: data.molliePosCents },
          ]}
        />
      </Section>
      <Section title="Alleen in de kassa" note="Een pinverkoop die Mollie niet heeft. Mollie wordt elke nacht gelezen: een verkoop van vandaag staat hier tot morgen.">
        <Amounts rows={data.onlyInKassa.map((sale) => ({ key: sale.saleId, label: formatDateNl(sale.date), cents: sale.amountCents }))} />
      </Section>
      <Section title="Alleen bij Mollie" note="Een pinbetaling zonder verkoop in de kassa.">
        <Amounts rows={data.onlyAtMollie.map((payment) => ({ key: payment.paymentId, label: formatDateNl(payment.date), cents: payment.amountCents }))} />
      </Section>
      <Section title="Overige betalingen" note="Website en QR-code, per rekening.">
        <Amounts
          rows={data.otherByAccount.map((row) => {
            const name = names.get(row.accountCode);
            return { key: row.accountCode, label: name ? `${row.accountCode} ${name}` : row.accountCode, cents: row.cents };
          })}
        />
      </Section>
      <Section title="Kosten" note="Wat Mollie inhield op de uitbetalingen van deze maand.">
        <Amounts rows={[{ key: "costs", label: "Kosten Mollie", cents: data.costsCents }]} />
      </Section>
      <Section title="Saldo">
        <p className="px-2 text-lg sm:px-3">
          {balance.mollieCents === null
            ? `Saldo bij Mollie nog niet bekend, in de boekhouding ${formatEuro(balance.ledgerCents)}`
            : `Saldo bij Mollie ${formatEuro(balance.mollieCents)}, in de boekhouding ${formatEuro(balance.ledgerCents)}`}
        </p>
        {balance.differenceCents !== null && balance.differenceCents !== 0 && (
          <>
            <p className="mt-1 px-2 font-semibold text-redbrown sm:px-3">{`verschil ${formatEuro(balance.differenceCents)}`}</p>
            <p className="mt-1 px-2 text-ink/70 sm:px-3">Hield Mollie iets anders in, zoals een terminal? Boek dat zelf.</p>
          </>
        )}
      </Section>
    </>
  );
}

/** Mollie per month: the kassa's pin next to Mollie's, the other payments, the costs, and 1030 next to Mollie's balance. */
export function MolliePage() {
  const [params, setParams] = useSearchParams();
  const current = monthOf(today());
  const asked = params.get("maand");
  const month = asked && MONTH.test(asked) ? asked : current;
  const data = useAdminData<MollieMonth>(ledgerPath.mollieMonth(month));
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const names = new Map((accounts.data ?? []).map((account) => [account.code, account.name]));
  const open = (to: string) => setParams({ maand: to });
  return (
    <div>
      <PageTitle>Mollie</PageTitle>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => open(shiftMonth(month, -1))}>Vorige maand</Button>
        <h2 className="text-xl font-bold">{monthName.format(new Date(`${month}-01T00:00:00Z`))}</h2>
        <Button disabled={month >= current} onClick={() => open(shiftMonth(month, 1))}>
          Volgende maand
        </Button>
      </div>
      <Loaded from={data}>{(shown) => <MonthView data={shown} names={names} />}</Loaded>
    </div>
  );
}
