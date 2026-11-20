import { useState, type FormEvent } from "react";
import { businessDate, formatDateNl, localTime } from "../../shared/time";
import type { StockItem, StockOrder } from "../../shared/types";
import { orderLineText } from "../kassa/stock-label";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import { Loaded, PageTitle, Problem, Section, amount, amountHead, cell, field, head, table, tableScroll } from "./parts";
import { useAdminData, useAdminWrite, type AdminData } from "./useAdmin";

const day = (iso: string) => formatDateNl(businessDate(iso));

// Columns that only fit on a screen wider than a phone.
const wideOnly = "hidden sm:table-cell";

/** A whole number of zero or more from a number field; anything else counts as nothing. */
function whole(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function Reorder({ items }: { items: StockItem[] }) {
  const low = items.filter((item) => item.belowReorder).sort((a, b) => a.stock - b.stock);
  return (
    <Section title="Bijbestellen">
      {low.length === 0 ? (
        <p className="px-2 text-lg text-ink/70 sm:px-3">Niets onder de bestelgrens.</p>
      ) : (
        <ul className="px-2 text-lg font-semibold text-redbrown sm:px-3">
          {low.map((item) => (
            <li key={item.productId}>{`${item.name}: nog ${item.stock}`}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Levels({ items, onCount }: { items: StockItem[]; onCount(item: StockItem): void }) {
  return (
    <Section title="Stand">
      <div className={tableScroll}>
        <table className={table}>
          <thead>
            <tr className="border-b-2 border-sand">
              <th className={head}>Product</th>
              <th className={amountHead}>Voorraad</th>
              <th className={`${amountHead} ${wideOnly}`}>Per doos</th>
              <th className={`${amountHead} ${wideOnly}`}>Bestelgrens</th>
              <th className={head}>
                <span className="sr-only">Tellen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productId} className="border-b border-sand">
                <td className={cell}>
                  {item.name}
                  {/* On a phone the two settings move under the name, so the button stays in view. */}
                  <span className="block text-sm text-ink/70 sm:hidden">{`${item.unitsPerBox ?? "–"} per doos · bestelgrens ${item.reorderAt ?? "–"}`}</span>
                </td>
                <td className={`${amount} ${item.belowReorder ? "font-bold text-redbrown" : ""}`}>{item.stock}</td>
                <td className={`${amount} ${wideOnly}`}>{item.unitsPerBox ?? "–"}</td>
                <td className={`${amount} ${wideOnly}`}>{item.reorderAt ?? "–"}</td>
                <td className={`${cell} text-right`}>
                  <Button onClick={() => onCount(item)}>Tellen</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Corrects the stock of one product to what was counted in the freezer. */
function CountForm({ item, onDone, onClose }: { item: StockItem; onDone(stock: number): void; onClose(): void }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d+$/.test(counted.trim())) return setError("Vul het getelde aantal in.");
    setBusy(true);
    setError(null);
    const answer = await write<{ stock: number; delta: number }>("/api/admin/stock/counts", "POST", {
      productId: item.productId,
      counted: Number(counted.trim()),
      note: note.trim() || null,
    });
    if (answer.ok) return onDone(answer.data.stock);
    setBusy(false);
    setError(answer.status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Opslaan is niet gelukt. Probeer het opnieuw.");
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="text-lg">{`Volgens de kassa zijn er nu ${item.stock}.`}</p>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Geteld aantal
        <input className={field} type="number" inputMode="numeric" min={0} autoFocus value={counted} onChange={(event) => setCounted(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Toelichting
        <input className={field} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && <Problem>{error}</Problem>}
      <div className="flex justify-end gap-3">
        <Button onClick={onClose}>Annuleren</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Opslaan
        </Button>
      </div>
    </form>
  );
}

type Typed = Record<string, { boxes?: string; loose?: string }>;

/** The order the penningmeester has placed with the supplier; the kassa then shows "Levering onderweg". */
function OrderForm({ items, onSaved }: { items: StockItem[]; onSaved(): void }) {
  const [typed, setTyped] = useState<Typed>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();
  const toast = useToast();

  const rows = items.map((item) => ({ item, boxes: whole(typed[item.productId]?.boxes ?? ""), loose: whole(typed[item.productId]?.loose ?? "") }));
  const wanted = rows.filter((row) => row.boxes > 0 || row.loose > 0);
  const type = (productId: string, what: "boxes" | "loose", text: string) => setTyped((before) => ({ ...before, [productId]: { ...before[productId], [what]: text } }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const unknownBox = wanted.find((row) => row.boxes > 0 && row.item.unitsPerBox === null);
    if (unknownBox) return setError(`Vul bij ${unknownBox.item.name} eerst het aantal per doos in (bij Producten).`);
    setBusy(true);
    setError(null);
    const answer = await write<StockOrder>("/api/admin/stock/orders", "POST", {
      note: note.trim() || null,
      lines: wanted.map((row) => ({ productId: row.item.productId, boxes: row.boxes, looseUnits: row.loose })),
    });
    setBusy(false);
    if (!answer.ok) {
      if (answer.status === 0) return setError("Geen verbinding. Probeer het opnieuw.");
      if (answer.error === "units_per_box_missing") return setError("Vul eerst het aantal per doos in (bij Producten).");
      return setError("Opslaan is niet gelukt. Controleer de aantallen en probeer het opnieuw.");
    }
    setTyped({});
    setNote("");
    toast.show("Bestelling opgeslagen. De kassa toont nu “Levering onderweg”.");
    onSaved();
  };

  return (
    <Section title="Bestelling invoeren" note="Vul in wat je bij de leverancier hebt besteld. De beheerder bevestigt de ontvangst op de iPad.">
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className={tableScroll}>
          <table className={table}>
            <thead>
              <tr className="border-b-2 border-sand">
                <th className={head}>Product</th>
                <th className={head}>Dozen</th>
                <th className={head}>Los</th>
                <th className={amountHead}>Samen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, boxes, loose }) => {
                const units = boxes * (item.unitsPerBox ?? 0) + loose;
                return (
                  <tr key={item.productId} className="border-b border-sand">
                    <td className={cell}>
                      {item.name}
                      <span className="block text-sm text-ink/70">{item.unitsPerBox === null ? "aantal per doos onbekend" : `${item.unitsPerBox} per doos`}</span>
                    </td>
                    <td className={cell}>
                      <input
                        className={`${field} w-16 sm:w-20`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1000}
                        aria-label="Dozen"
                        value={typed[item.productId]?.boxes ?? ""}
                        onChange={(event) => type(item.productId, "boxes", event.target.value)}
                      />
                    </td>
                    <td className={cell}>
                      <input
                        className={`${field} w-16 sm:w-20`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10000}
                        aria-label="Los"
                        value={typed[item.productId]?.loose ?? ""}
                        onChange={(event) => type(item.productId, "loose", event.target.value)}
                      />
                    </td>
                    <td className={amount}>{units > 0 && (boxes === 0 || item.unitsPerBox !== null) ? `${units} ${units === 1 ? "stuk" : "stuks"}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex max-w-md flex-col gap-4 px-2 sm:px-3">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Notitie
            <input className={field} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error && <Problem>{error}</Problem>}
          <Button type="submit" variant="primary" disabled={busy || wanted.length === 0}>
            Bestelling opslaan
          </Button>
        </div>
      </form>
    </Section>
  );
}

function OrderLines({ order }: { order: StockOrder }) {
  return (
    <>
      <p className="text-ink/70">{`Besteld op ${day(order.createdAt)}`}</p>
      <ul className="text-lg font-semibold">
        {order.lines.map((line) => (
          <li key={line.productId}>{orderLineText(line)}</li>
        ))}
      </ul>
      {order.note && <p>{order.note}</p>}
    </>
  );
}

function outcome(order: StockOrder): string {
  if (order.status === "cancelled" || order.receivedAt === null) return "Vervallen";
  return `Ontvangen op ${day(order.receivedAt)} om ${localTime(order.receivedAt)} door ${order.receivedBy === "admin" ? "de penningmeester" : "de kassa"}`;
}

function Orders({ orders, onChanged }: { orders: StockOrder[]; onChanged(): void }) {
  // What has been asked of the server, as `order/action`. A button that was pressed stays out of reach until
  // the fresh list arrives without the order, so a second click cannot ask for the same thing again.
  const [asked, setAsked] = useState<string[]>([]);
  const write = useAdminWrite();
  const toast = useToast();
  const waiting = orders.filter((order) => order.status === "open");
  const earlier = orders.filter((order) => order.status !== "open");

  const act = async (order: StockOrder, action: "receive" | "cancel") => {
    const key = `${order.id}/${action}`;
    setAsked((keys) => [...keys, key]);
    const answer = await write(`/api/admin/stock/orders/${encodeURIComponent(order.id)}/${action}`, "POST");
    if (answer.ok) {
      toast.show(action === "receive" ? "Levering ontvangen, voorraad bijgewerkt" : "Bestelling vervallen");
      return onChanged();
    }
    if (answer.error === "not_open") {
      // The beheerder confirmed it on the iPad in the meantime, or it was handled in another window.
      toast.show("Deze bestelling was al afgehandeld.");
      return onChanged();
    }
    // Not done: the button comes back for another try.
    setAsked((keys) => keys.filter((other) => other !== key));
    toast.show(answer.status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Dat lukte niet. Probeer het opnieuw.");
  };

  return (
    <>
      <Section title="Onderweg">
        {waiting.length === 0 ? (
          <p className="px-2 text-lg text-ink/70 sm:px-3">Geen levering onderweg.</p>
        ) : (
          <ul className="flex flex-col gap-3 px-2 sm:px-3">
            {waiting.map((order) => (
              <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border-2 border-sand p-4">
                <div>
                  <OrderLines order={order} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={asked.includes(`${order.id}/receive`)} onClick={() => void act(order, "receive")}>
                    Markeer als ontvangen
                  </Button>
                  <Button variant="ghost" disabled={asked.includes(`${order.id}/cancel`)} onClick={() => void act(order, "cancel")}>
                    Laat vervallen
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {earlier.length > 0 && (
        <Section title="Eerdere bestellingen">
          <ul className="flex flex-col px-2 sm:px-3">
            {earlier.map((order) => (
              <li key={order.id} className="border-b border-sand py-3 last:border-b-0">
                <OrderLines order={order} />
                <p className={order.status === "cancelled" ? "text-redbrown" : "text-green-dark"}>{outcome(order)}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** Stock of the products that keep one: what to reorder, the levels, entering an order, deliveries on their way. */
export function StockPage() {
  const stock = useAdminData<{ items: StockItem[] }>("/api/admin/stock");
  const orders = useAdminData<{ orders: StockOrder[] }>("/api/admin/stock/orders");
  const [counting, setCounting] = useState<StockItem | null>(null);
  const toast = useToast();

  const reload = () => {
    stock.reload();
    orders.reload();
  };
  const both: AdminData<{ items: StockItem[]; orders: StockOrder[] }> = {
    data: stock.data && orders.data ? { items: stock.data.items, orders: orders.data.orders } : null,
    error: stock.error ?? orders.error,
    loading: stock.loading || orders.loading,
    reload,
  };

  return (
    <>
      <PageTitle>Voorraad</PageTitle>
      <Loaded from={both}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <p className="mt-6 text-lg text-ink/70">Van geen enkel product wordt de voorraad bijgehouden. Dat stel je per product in bij Producten.</p>
            ) : (
              <>
                <Reorder items={data.items} />
                <Levels items={data.items} onCount={setCounting} />
                <OrderForm items={data.items} onSaved={orders.reload} />
              </>
            )}
            <Orders orders={data.orders} onChanged={reload} />
          </>
        )}
      </Loaded>

      <Dialog open={counting !== null} onClose={() => setCounting(null)} title={counting ? `${counting.name} tellen` : ""}>
        {counting && (
          <CountForm
            item={counting}
            onClose={() => setCounting(null)}
            onDone={(now) => {
              toast.show(`Telling opgeslagen: ${counting.name} staat nu op ${now}.`);
              setCounting(null);
              stock.reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
