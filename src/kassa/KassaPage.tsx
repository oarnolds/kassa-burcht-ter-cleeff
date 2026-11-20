import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import type { CashSaleInput, OutboxItem, ReversalInput } from "../../shared/schemas";
import type { Catalog } from "../../shared/types";
import { Logo } from "../ui/Logo";
import { useToast } from "../ui/Toast";
import { KassaScreen } from "./KassaScreen";
import { LastSaleBar } from "./LastSaleBar";
import { StatusBadge } from "./StatusBadge";
import { loadCatalog, noteSold } from "./store/catalog";
import { getMeta } from "./store/db";
import { enqueue } from "./store/outbox";
import { startSync, type SyncState } from "./store/sync";

/** How long the last sale can be taken back on the kassa. */
const REVERSE_FOR_MS = 5 * 60_000;

/** The kassa as it runs on the iPad: the screen, wired to the iPad's own storage and to the server. */
export function KassaPage() {
  const [boot, setBoot] = useState<"starting" | "unpaired" | "ready">("starting");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sync, setSync] = useState<SyncState>({ online: navigator.onLine, pending: 0, rejected: 0, paired: true });
  const [lastSale, setLastSale] = useState<CashSaleInput | null>(null);
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
      if (left) return;
      setCatalog(cached);
      setBoot("ready");
      const handle = startSync(setSync, setCatalog);
      kick.current = handle.kick;
      stop = handle.stop;
    })();
    return () => {
      left = true;
      stop();
    };
  }, []);

  // The offer to take the last sale back ends by itself.
  useEffect(() => {
    if (!lastSale) return;
    const timer = setTimeout(() => setLastSale(null), REVERSE_FOR_MS);
    return () => clearTimeout(timer);
  }, [lastSale]);

  /** Puts a sale or a reversal in the queue. Storing can fail (no space left, storage switched off); then paper is the only record. */
  const store = async (item: OutboxItem, sold: { productId: string; qty: number }[], what: string): Promise<boolean> => {
    try {
      await enqueue(item);
    } catch {
      setLastSale(null);
      toast.show(`Opslaan mislukt. Noteer deze ${what} op papier en meld het aan de penningmeester.`, { ms: 30_000 });
      return false;
    }
    await noteSold(sold).catch(() => {}); // only feeds the stock shown on the tiles
    kick.current();
    return true;
  };

  const onSale = (sale: CashSaleInput) => {
    setLastSale(sale);
    void store(sale, sale.lines, "verkoop");
  };

  const reverse = (sale: CashSaleInput) => {
    setLastSale(null);
    const reversal: ReversalInput = { id: crypto.randomUUID(), kind: "reversal", soldAt: new Date().toISOString(), reversesSaleId: sale.id };
    const back = sale.lines.map((line) => ({ productId: line.productId, qty: -line.qty }));
    void store(reversal, back, "terugboeking").then((stored) => {
      if (stored) toast.show("Verkoop teruggedraaid");
    });
  };

  if (boot === "unpaired") return <Navigate to="/koppelen" replace />;
  if (boot === "starting") return null;

  if (!catalog) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <Logo />
        {!sync.paired ? (
          <StatusBadge state={sync} />
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
      footer={
        <footer className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-t-2 border-sand bg-white px-4 py-1">
          <StatusBadge state={sync} />
          {lastSale && <LastSaleBar totalCents={lastSale.totalCents} onReverse={() => reverse(lastSale)} />}
        </footer>
      }
    />
  );
}
