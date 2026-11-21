import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
import { formatEuro } from "../../shared/money";
import type { CashSaleInput } from "../../shared/schemas";
import { businessDate, localTime } from "../../shared/time";
import type { Catalog, KassaPayments } from "../../shared/types";
import { kassaApi } from "../lib/api";
import { Logo } from "../ui/Logo";
import { useToast } from "../ui/Toast";
import { cashSaleFor } from "./cash";
import { DeliveryBar } from "./DeliveryBar";
import { KassaScreen } from "./KassaScreen";
import { footerButton, Payments } from "./Payments";
import { RevenuePanel } from "./RevenuePanel";
import { prepareReceiptShare } from "./share-receipt";
import { StatusBadge } from "./StatusBadge";
import { stockLabel } from "./stock-label";
import { loadCatalog, noteSold, soldSinceFetch } from "./store/catalog";
import { getMeta, setMeta } from "./store/db";
import { enqueue, listUnsentSales } from "./store/outbox";
import { listParked, markCashTaken, parkLeftovers, resolveParked, runPin, type Parked, type PinProgress, type PinReceipt, type PinRun } from "./store/pin";
import { startSync, type SyncState } from "./store/sync";
import { TestBar } from "./TestBar";

const PARKED_EVERY_MS = 5000;

/** The last payment that went through on this iPad, shown in the footer for the rest of its day. */
type LastPayment = { totalCents: number; method: "cash" | "pin"; soldAt: string };

const today = () => businessDate(new Date().toISOString());

/** Why pin cannot be used right now, in the beheerder's words; null when it can. */
function pinBlocked(sync: SyncState, catalog: Catalog): string | null {
  if (!sync.online) return "Geen internet: pin kan nu niet. Contant werkt door.";
  if (!sync.paired) return "Kassa is ontkoppeld: pin kan nu niet.";
  // A catalog that fase 1 left on the iPad says nothing about pin.
  if (!(catalog as Partial<Catalog>).pin?.ready) return "Pin is nog niet ingesteld.";
  return null;
}

/** The kassa as it runs on the iPad: the screen, wired to the iPad's own storage and to the server. */
export function KassaPage() {
  const [boot, setBoot] = useState<"starting" | "unpaired" | "ready">("starting");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sync, setSync] = useState<SyncState>({ online: navigator.onLine, pending: 0, rejected: 0, paired: true });
  // Pieces sold per product since the catalog was fetched: the stock on the tiles is the server's minus these.
  const [sold, setSold] = useState<Record<string, number>>({});
  // Omzet: "never" until it has been opened once. A closed panel leaves the tap shield behind, as a Dialog does.
  const [revenue, setRevenue] = useState<"never" | "open" | "closed">("never");
  // The pin payments whose outcome is not known yet.
  const [parked, setParked] = useState<Parked[]>([]);
  const [last, setLast] = useState<LastPayment | null>(null);
  const lastRef = useRef<LastPayment | null>(null);
  const kick = useRef<() => void>(() => {});
  const settling = useRef(false);
  const settleAgain = useRef(false);
  const toast = useToast();

  /** Notes a payment that went through, unless a later one already did: a parked one can settle after the next customer. */
  const noteLast = (payment: LastPayment) => {
    if (lastRef.current && payment.soldAt < lastRef.current.soldAt) return;
    lastRef.current = payment;
    setLast(payment);
    void setMeta("lastPayment", payment).catch(() => {});
  };

  const readParked = () =>
    listParked()
      .then(setParked)
      .catch(() => {});
  /** Counts what a pin payment sold on the tiles, and asks the server for the new stock. */
  const countSold = async (receipts: PinReceipt[]) => {
    for (const receipt of receipts) await noteSold(receipt.lines).catch(() => {});
    await soldSinceFetch()
      .then(setSold)
      .catch(() => {});
    kick.current();
  };

  useEffect(() => {
    let left = false;
    let stop = () => {};
    // Ask the iPad not to clear the kassa's storage when it runs short of space.
    void navigator.storage?.persist?.();
    void (async () => {
      const token = await getMeta<string>("deviceToken");
      if (left) return;
      if (!token) return setBoot("unpaired");
      const cached = await loadCatalog();
      const soldBefore = await soldSinceFetch();
      // A pin payment that was waiting when the kassa was closed is found again, never silently lost.
      const waiting = await parkLeftovers()
        .then(listParked)
        .catch(() => []);
      const lastBefore = await getMeta<LastPayment>("lastPayment").catch(() => undefined);
      if (left) return;
      if (lastBefore) {
        lastRef.current = lastBefore;
        setLast(lastBefore);
      }
      setCatalog(cached);
      setSold(soldBefore);
      setParked(waiting);
      setBoot("ready");
      const handle = startSync(setSync, (fresh) => {
        // A fresh catalog already counts every sale the server has.
        setCatalog(fresh);
        setSold({});
      });
      kick.current = handle.kick;
      stop = handle.stop;
    })();
    return () => {
      left = true;
      stop();
    };
  }, []);

  /**
   * Puts a sale in the queue. Storing can fail (no space left, storage switched off); then paper is the only record.
   * A paid sale cannot be taken back here: that is the penningmeester's work in beheer, where it asks for a reason.
   */
  const store = async (sale: CashSaleInput) => {
    try {
      await enqueue(sale);
    } catch {
      toast.show("Opslaan mislukt. Noteer deze verkoop op papier en meld het aan de penningmeester.", { ms: 30_000 });
      return;
    }
    noteLast({ totalCents: sale.totalCents, method: "cash", soldAt: sale.soldAt });
    // Cash for a receipt whose pin payment has no outcome yet: should that payment fail, there is nothing to tell.
    if (sale.insteadOfSaleId) {
      await markCashTaken(sale.insteadOfSaleId)
        .then(readParked)
        .catch(() => {});
    }
    // The count only feeds the stock shown on the tiles: a failure here must not look like a lost sale.
    await noteSold(sale.lines)
      .then(soldSinceFetch)
      .then(setSold)
      .catch(() => {});
    kick.current();
  };

  const startPin = (receipt: PinReceipt, onProgress: (progress: PinProgress) => void): PinRun => {
    const run = runPin(receipt, onProgress);
    // Whatever the end: a receipt whose outcome could not be learned is now on the list.
    void run.done.then(readParked, () => {});
    return run;
  };

  /**
   * Asks the server about the parked receipts and tells the beheerder which ones went through. One round at
   * a time, and a call made in the meantime gets a round of its own afterwards: an outcome is told once.
   */
  const settleParked = async () => {
    if (settling.current) {
      settleAgain.current = true;
      return;
    }
    settling.current = true;
    try {
      do {
        settleAgain.current = false;
        const { paid, failed } = await resolveParked();
        await readParked();
        for (const receipt of paid) noteLast({ totalCents: receipt.totalCents, method: "pin", soldAt: receipt.soldAt });
        // One message: the toast shows one at a time. A payment that did not go through is said once; Betalingen keeps it.
        // One that went through after the receipt was rung up as cash: the customer paid twice, and the beheerder
        // must not settle that at the kassa (the penningmeester sees it in beheer and refunds one of the two).
        const plain = paid.filter((receipt) => !receipt.cashTaken);
        const twice = paid.filter((receipt) => receipt.cashTaken);
        const told = [
          plain.length === 0 ? "" : plain.length === 1 ? `Pinbetaling van ${formatEuro(plain[0]!.totalCents)} is gelukt` : `${plain.length} pinbetalingen zijn gelukt`,
          twice.length === 0
            ? ""
            : `${twice.length === 1 ? `Pinbetaling van ${formatEuro(twice[0]!.totalCents)} is` : `${twice.length} pinbetalingen zijn`} toch gelukt. Er is ook contant afgerekend: geef niets terug, de penningmeester regelt het`,
          failed.length === 0 ? "" : failed.length === 1 ? `Pinbetaling van ${formatEuro(failed[0]!.totalCents)} is niet gelukt` : `${failed.length} pinbetalingen zijn niet gelukt`,
        ].filter(Boolean);
        if (told.length > 0) toast.show(told.join(". "), { ms: twice.length > 0 ? 8000 : failed.length > 0 ? 5000 : 3000 });
        if (paid.length > 0) await countSold(paid);
      } while (settleAgain.current);
    } catch {
      // Storage went away under us. The next round tries again.
    } finally {
      settling.current = false;
    }
  };
  const settle = useRef(settleParked);
  settle.current = settleParked;

  const anyWaiting = parked.some((receipt) => receipt.parked);
  useEffect(() => {
    if (!anyWaiting) return;
    const ask = () => void settle.current();
    const timer = setInterval(ask, PARKED_EVERY_MS);
    window.addEventListener("online", ask);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", ask);
    };
  }, [anyWaiting]);

  const receive = async (orderId: string): Promise<"ok" | "offline" | "error"> => {
    const token = (await getMeta<string>("deviceToken")) ?? "";
    const answer = await kassaApi<{ ok: true }>(`/api/kassa/orders/${encodeURIComponent(orderId)}/receive`, token, { method: "POST" });
    // Already received, by this kassa or in beheer: the boxes are in, which is what was asked.
    const received = answer.ok || (answer.status === 409 && answer.error === "not_open");
    if (received) kick.current(); // fetch the catalog with the new stock
    return received ? "ok" : answer.status === 0 ? "offline" : "error";
  };

  /** Betalingen: the server's list of today, and what this iPad has not sent yet. */
  const loadPayments = async () => {
    const token = (await getMeta<string>("deviceToken")) ?? "";
    const [answer, unsent] = await Promise.all([kassaApi<KassaPayments>(`/api/kassa/payments?date=${today()}`, token), listUnsentSales().catch(() => [])]);
    return { server: answer.ok ? answer.data : null, unsent };
  };

  const products = useMemo(() => new Map((catalog?.products ?? []).map((product) => [product.id, product])), [catalog]);
  const tileNote = (productId: string) => {
    const product = products.get(productId);
    return product ? stockLabel(product, sold[productId] ?? 0) : null;
  };

  if (boot === "unpaired") return <Navigate to="/koppelen" replace />;
  if (boot === "starting") return null;

  if (!catalog) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <Logo />
        {!sync.paired ? (
          <StatusBadge state={sync} onRejectedChange={() => kick.current()} />
        ) : sync.online ? (
          <p className="text-xl">De kassa wordt gestart…</p>
        ) : (
          <p className="text-xl">Geen verbinding. De kassa heeft één keer internet nodig om te starten.</p>
        )}
      </main>
    );
  }

  return (
    <KassaScreen
      catalog={catalog}
      onSale={(sale) => void store(sale)}
      tileNote={tileNote}
      pin={{ blocked: pinBlocked(sync, catalog), start: startPin }}
      onPinPaid={(receipt) => {
        noteLast({ totalCents: receipt.totalCents, method: "pin", soldAt: receipt.soldAt });
        void countSold([receipt]);
      }}
      shareReceipt={(sale) => prepareReceiptShare(sale)}
      header={
        <>
          {(catalog as Partial<Catalog>).pin?.mode === "test" && <TestBar />}
          <DeliveryBar orders={catalog.openOrders} online={sync.online && sync.paired} onReceive={receive} />
        </>
      }
      footer={
        <footer className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-sand bg-white px-4 py-1">
          <StatusBadge state={sync} onRejectedChange={() => kick.current()} />
          {last && businessDate(last.soldAt) === today() && (
            <p className="min-w-0 font-semibold text-ink/80">{`Laatste betaling: ${formatEuro(last.totalCents)} ${last.method === "pin" ? "pin" : "contant"} · ${localTime(last.soldAt)}`}</p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <Payments
              waiting={parked}
              load={loadPayments}
              onCash={(receipt, cashGivenCents) => {
                toast.show("Contant ontvangen", { ms: 1000 });
                void store(cashSaleFor(receipt, cashGivenCents, receipt.id));
              }}
            />
            <button type="button" className={footerButton} onClick={() => setRevenue("open")}>
              Omzet
            </button>
          </div>
          {revenue === "open" && <RevenuePanel pending={sync.pending} onClose={() => setRevenue("closed")} />}
          {/* Sluiten sits right above "Wis alles": the shield takes the second tap of a double tap (see app.css). */}
          {revenue === "closed" && <div className="tap-shield" />}
        </footer>
      }
    />
  );
}
