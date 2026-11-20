import { useEffect, useState } from "react";
import { formatEuro } from "../../shared/money";
import { businessDate, formatDateNl, localTime } from "../../shared/time";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { dismissRejected, listRejected, type Rejected } from "./store/outbox";

const reasons: Record<string, string> = {
  invalid: "De server kon de gegevens niet lezen.",
  total_mismatch: "Het totaal klopte niet met de regels.",
  unknown_product: "Een product op de bon bestaat niet in beheer.",
  original_not_found: "De verkoop die teruggedraaid moest worden is niet gevonden.",
  not_cash: "Alleen een contante verkoop kan op de kassa worden teruggedraaid.",
  already_reversed: "Deze verkoop was al teruggedraaid.",
  too_late: "Terugdraaien op de kassa kan tot vijf minuten na de verkoop.",
  other_device: "Deze verkoop is op een andere kassa gemaakt.",
};

const when = (iso: string) => `${formatDateNl(businessDate(iso))} ${localTime(iso)}`;

/** What the refusal means for the books and the cash box. */
function consequence({ item, reason }: Rejected): string {
  if (item.kind === "sale") return "Niet geboekt. Het geld zit wel in het kluisje.";
  if (reason === "already_reversed") return "De verkoop was al teruggeboekt. Er hoeft niets te gebeuren.";
  return "Niet teruggeboekt. De verkoop staat nog in de boeken; de penningmeester kan hem in beheer terugdraaien.";
}

type Props = { open: boolean; onClose(): void; /** Called after an item has been taken off the list. */ onChange?(): void };

/**
 * The sales and reversals the server refused, with what the penningmeester needs to set the books right.
 * An item stays on the iPad until someone says it has been passed on.
 */
export function RejectedDialog({ open, onClose, onChange }: Props) {
  const [items, setItems] = useState<Rejected[] | null>(null);
  // Passed on while the list is open. Such an item keeps its place, so that the list does not jump up
  // under a finger: the second tap of a double tap must not pass on the next one.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let left = false;
    void listRejected().then((rows) => {
      if (left) return;
      setItems(rows);
      setDone(new Set());
    });
    return () => {
      left = true;
    };
  }, [open]);

  const passedOn = async (id: string) => {
    await dismissRejected(id);
    const now = new Set(done).add(id);
    setDone(now);
    onChange?.();
    if ((items ?? []).every((rejected) => now.has(rejected.id))) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Afgekeurde verkopen" wide>
      <p className="text-lg">De server heeft dit niet geboekt. Geef het door aan de penningmeester en tik daarna op Doorgegeven.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {(items ?? []).map((rejected) => {
          const { item } = rejected;
          return (
            <li key={rejected.id} className={`flex items-start justify-between gap-4 rounded-2xl border-2 border-sand p-4 ${done.has(rejected.id) ? "opacity-50" : ""}`}>
              <div className="min-w-0">
                <h3 className="text-lg font-bold tabular-nums">
                  {item.kind === "sale" ? `Verkoop van ${when(item.soldAt)} · ${formatEuro(item.totalCents)} contant` : `Terugboeking van ${when(item.soldAt)}`}
                </h3>
                {item.kind === "sale" && <p>{item.lines.map((line) => `${line.qty}× ${line.name}`).join(", ")}</p>}
                <p className="text-redbrown">{reasons[rejected.reason] ?? "De server gaf geen reden die deze kassa kent."}</p>
                <p className="text-ink/70">{consequence(rejected)}</p>
              </div>
              {done.has(rejected.id) ? (
                <span className="flex min-h-11 shrink-0 items-center px-4 font-semibold">Is doorgegeven</span>
              ) : (
                <Button className="shrink-0" onClick={() => void passedOn(rejected.id)}>
                  Doorgegeven
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={onClose}>
          Sluiten
        </Button>
      </div>
    </Dialog>
  );
}
