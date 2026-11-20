import { useState } from "react";
import type { OpenOrder } from "../../shared/types";
import { businessDate, formatDateNl } from "../../shared/time";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import { orderLineText } from "./stock-label";

type Props = {
  /** The orders the penningmeester has placed and that have not been received yet. */
  orders: OpenOrder[];
  online: boolean;
  onReceive(orderId: string): Promise<"ok" | "offline" | "error">;
};

const OFFLINE = "Bevestigen kan pas als er weer internet is.";

/** A bar above the kassa while a delivery is on its way. The beheerder confirms it once the boxes are in the freezer. */
export function DeliveryBar({ orders, online, onReceive }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Confirmed here already; the catalog that says so is still on its way.
  const [done, setDone] = useState<string[]>([]);
  const toast = useToast();

  const waiting = orders.filter((order) => !done.includes(order.id));
  if (waiting.length === 0) return null;

  const close = () => {
    setOpen(false);
    setProblem(null);
  };

  const receive = async (orderId: string) => {
    setBusy(orderId);
    setProblem(null);
    const outcome = await onReceive(orderId);
    setBusy(null);
    if (outcome === "ok") {
      setDone((ids) => [...ids, orderId]);
      close();
      toast.show("Levering ontvangen, voorraad bijgewerkt");
    } else {
      setProblem(outcome === "offline" ? OFFLINE : "Dat lukte niet. Probeer het nog eens.");
    }
  };

  const message = !online ? OFFLINE : problem;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b-2 border-[#E0C36A] bg-[#F5E7BF] px-4 py-1.5 text-[#5E4500]">
      <button
        type="button"
        className="min-h-11 rounded-full border-2 border-[#5E4500] bg-white px-5 text-lg font-bold active:bg-sand"
        onClick={() => setOpen(true)}
      >
        {waiting.length > 1 ? `Levering onderweg (${waiting.length})` : "Levering onderweg"}
      </button>
      <span className="text-base">Staan de dozen in de vriezer? Tik hier om de ontvangst te bevestigen.</span>

      <Dialog open={open} onClose={close} title="Levering onderweg" wide>
        <div>
          {message && (
            <p role="alert" className="mb-4 text-lg font-semibold text-redbrown">
              {message}
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {waiting.map((order) => (
              <li key={order.id} className="flex items-start justify-between gap-4 rounded-2xl border-2 border-sand p-4">
                <div>
                  <p className="text-base text-ink/70">Besteld op {formatDateNl(businessDate(order.createdAt))}</p>
                  <ul className="mt-1 text-lg font-semibold">
                    {order.lines.map((line) => (
                      <li key={line.productId}>{orderLineText(line)}</li>
                    ))}
                  </ul>
                  {order.note && <p className="mt-1 text-base">{order.note}</p>}
                </div>
                <Button variant="primary" size="lg" disabled={!online || busy !== null} onClick={() => void receive(order.id)}>
                  Ontvangen
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end">
            <Button onClick={close}>Sluiten</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
