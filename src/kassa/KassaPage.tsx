import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
import type { CashSaleInput, OutboxItem, ReversalInput } from "../../shared/schemas";
import type { Catalog } from "../../shared/types";
import { kassaApi } from "../lib/api";
import { Logo } from "../ui/Logo";
import { useToast } from "../ui/Toast";
import { DeliveryBar } from "./DeliveryBar";
import { KassaScreen } from "./KassaScreen";
import { LastSaleBar } from "./LastSaleBar";
import { StatusBadge } from "./StatusBadge";
import { stockLabel } from "./stock-label";
import { loadCatalog, noteSold, soldSinceFetch } from "./store/catalog";
import { getMeta } from "./store/db";
import { enqueue } from "./store/outbox";
import { startSync, type SyncState } from "./store/sync";

/** How long the last sale can be taken back on the kassa. The server holds a reversal to the same five minutes. */
const REVERSE_FOR_MS = 5 * 60_000;

/** Time left to take a sale back, by the clock: a sleeping iPad pauses timers, not the time. */
const reversibleFor = (sale: CashSaleInput) => Date.parse(sale.soldAt) + REVERSE_FOR_MS - Date.now();

/** The kassa as it runs on the iPad: the screen, wired to the iPad's own storage and to the server. */
export function KassaPage() {
  const [boot, setBoot] = useState<"starting" | "unpaired" | "ready">("starting");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sync, setSync] = useState<SyncState>({ online: navigator.onLine, pending: 0, rejected: 0, paired: true });
  const [lastSale, setLastSale] = useState<CashSaleInput | null>(null);
  // Pieces sold per product since the catalog was fetched: the stock on the tiles is the server's minus these.
  const [sold, setSold] = useState<Record<string, number>>({});
  const kick = useRef<() => void>(() => {});
  const toast = useToast();

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
      if (left) return;
      setCatalog(cached);
      setSold(soldBefore);
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

  // The offer to take the last sale back ends by itself, also when the iPad slept through the moment.
  useEffect(() => {
    if (!lastSale) return;
    const check = () => {
      if (reversibleFor(lastSale) <= 0) setLastSale(null);
    };
    const timer = setTimeout(() => setLastSale(null), Math.max(0, reversibleFor(lastSale)));
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [lastSale]);

  /** Puts a sale or a reversal in the queue. Storing can fail (no space left, storage switched off); then paper is the only record. */
  const store = async (item: OutboxItem, pieces: { productId: string; qty: number }[], what: string): Promise<boolean> => {
    try {
      await enqueue(item);
    } catch {
      setLastSale(null);
      toast.show(`Opslaan mislukt. Noteer deze ${what} op papier en meld het aan de penningmeester.`, { ms: 30_000 });
      return false;
    }
    // The count only feeds the stock shown on the tiles: a failure here must not look like a lost sale.
    await noteSold(pieces)
      .then(soldSinceFetch)
      .then(setSold)
      .catch(() => {});
    kick.current();
    return true;
  };

  const receive = async (orderId: string): Promise<"ok" | "offline" | "error"> => {
    const token = (await getMeta<string>("deviceToken")) ?? "";
    const answer = await kassaApi<{ ok: true }>(`/api/kassa/orders/${encodeURIComponent(orderId)}/receive`, token, { method: "POST" });
    // Already received, by this kassa or in beheer: the boxes are in, which is what was asked.
    const received = answer.ok || (answer.status === 409 && answer.error === "not_open");
    if (received) kick.current(); // fetch the catalog with the new stock
    return received ? "ok" : answer.status === 0 ? "offline" : "error";
  };

  const onSale = (sale: CashSaleInput) => {
    setLastSale(sale);
    void store(sale, sale.lines, "verkoop");
  };

  const reverse = (sale: CashSaleInput) => {
    setLastSale(null);
    // The server refuses a reversal of an older sale; saying "teruggedraaid" here would be untrue.
    if (reversibleFor(sale) < 0) {
      toast.show("Terugdraaien kan tot vijf minuten na de verkoop. Meld het aan de penningmeester.", { ms: 15_000 });
      return;
    }
    const reversal: ReversalInput = { id: crypto.randomUUID(), kind: "reversal", soldAt: new Date().toISOString(), reversesSaleId: sale.id };
    const back = sale.lines.map((line) => ({ productId: line.productId, qty: -line.qty }));
    void store(reversal, back, "terugboeking").then((stored) => {
      if (stored) toast.show("Verkoop teruggedraaid");
    });
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
      onSale={onSale}
      tileNote={tileNote}
      header={<DeliveryBar orders={catalog.openOrders} online={sync.online && sync.paired} onReceive={receive} />}
      footer={
        <footer className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-t-2 border-sand bg-white px-4 py-1">
          <StatusBadge state={sync} onRejectedChange={() => kick.current()} />
          <LastSaleBar sale={lastSale} onReverse={() => lastSale && reverse(lastSale)} />
        </footer>
      }
    />
  );
}
