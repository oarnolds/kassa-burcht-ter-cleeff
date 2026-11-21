import { useState } from "react";
import { formatEuro } from "../../shared/money";
import type { CashSaleInput } from "../../shared/schemas";
import type { KassaPayments } from "../../shared/types";
import { localTime } from "../../shared/time";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { CashDialog } from "./CashDialog";
import { paymentRows, type PaymentState } from "./payment-rows";
import type { Parked } from "./store/pin";

/** What the list is made of: the server's day (null without a connection) and the sales this iPad has not sent. */
export type PaymentsSource = { server: KassaPayments | null; unsent: CashSaleInput[] };

type Props = {
  /** The receipts whose pin payment has no outcome yet. */
  waiting: Parked[];
  load(): Promise<PaymentsSource>;
  /** Cash after all for a receipt whose pin payment is still waiting. */
  onCash(receipt: Parked, cashGivenCents: number): void;
};

const LABELS: Record<PaymentState, string> = {
  paid: "betaald",
  waiting: "wacht",
  failed: "niet gelukt",
  reversed: "teruggedraaid",
  unsent: "nog niet verstuurd",
  cashTaken: "contant afgerekend",
};

const BADGES: Record<PaymentState, string> = {
  paid: "bg-[#E1EACB] text-[#3F5512]",
  waiting: "bg-[#F5E7BF] text-[#5E4500]",
  failed: "bg-[#F6DDE2] text-[#6E1F33]",
  reversed: "bg-sand text-ink",
  unsent: "bg-sand text-ink",
  cashTaken: "bg-sand text-ink",
};

export const footerButton = "min-h-11 shrink-0 rounded-full border-2 border-green bg-white px-5 font-bold text-green-dark active:bg-sand";

/** "Betalingen": every payment of the day, to look at only. A waiting pin payment can still be rung up as cash. */
export function Payments({ waiting, load, onCash }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PaymentsSource | null>(null);
  const [cashFor, setCashFor] = useState<Parked | null>(null);

  const show = () => {
    setSource(null);
    setOpen(true);
    load().then(setSource, () => setSource({ server: null, unsent: [] }));
  };
  const rows = source ? paymentRows(source.server, waiting, source.unsent) : null;

  return (
    <>
      <button type="button" className={footerButton} onClick={show}>
        Betalingen
      </button>
      <CashDialog
        open={cashFor !== null}
        totalCents={cashFor?.totalCents ?? 0}
        onPaid={(cashGivenCents) => {
          if (cashFor) onCash(cashFor, cashGivenCents);
          setCashFor(null);
        }}
        onClose={() => setCashFor(null)}
      />
      {/* After the cash dialog: the shield this list leaves behind for a moment lies over the cash dialog that
          "Toch contant" opens, so the second tap of a double tap cannot land on "Gepast". */}
      <Dialog open={open} onClose={() => setOpen(false)} title="Betalingen vandaag" wide>
        {!rows || !source ? (
          <p className="text-lg text-ink/70">Betalingen worden opgehaald…</p>
        ) : (
          <>
            {source.server === null && <p className="mb-3 text-lg font-semibold text-redbrown">Geen verbinding. Je ziet alleen wat op deze iPad staat.</p>}
            {rows.length === 0 ? (
              <p className="text-lg text-ink/70">Nog geen betalingen vandaag.</p>
            ) : (
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-sand py-2.5 first:border-t-0">
                    <span className="w-14 text-lg font-bold tabular-nums">{localTime(row.soldAt)}</span>
                    <span className="w-16 text-lg">{row.method === "pin" ? "Pin" : "Contant"}</span>
                    <span className="min-w-0 flex-1 text-lg text-ink/80">{row.lines.map((line) => `${line.qty}× ${line.name}`).join(", ")}</span>
                    <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${BADGES[row.state]}`}>{LABELS[row.state]}</span>
                    <span className="w-20 text-right text-lg font-bold tabular-nums">{formatEuro(row.totalCents)}</span>
                    {row.state === "waiting" && row.receipt && (
                      <Button
                        className="shrink-0"
                        onClick={() => {
                          setCashFor(row.receipt!);
                          setOpen(false);
                        }}
                      >
                        Toch contant
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={() => setOpen(false)}>
            Sluiten
          </Button>
        </div>
      </Dialog>
    </>
  );
}
