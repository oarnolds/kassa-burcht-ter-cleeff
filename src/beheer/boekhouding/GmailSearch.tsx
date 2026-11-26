import { useEffect, useState } from "react";
import type { GmailCandidate } from "../../../shared/ledger-types";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Problem } from "../parts";
import { explainWrite, useLedgerWrites } from "./ledger-api";

type Found = { kind: "busy" } | { kind: "done"; candidates: GmailCandidate[] } | { kind: "problem"; text: string };

/** "Zoek bijlage": what Gmail has around the entry's date. Nothing is kept until the penningmeester picks a file. */
export function GmailSearch({ entryId, onAdded, onClose }: { entryId: string; onAdded(): void; onClose(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [found, setFound] = useState<Found>({ kind: "busy" });
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.findInGmail(entryId).then((answer) => {
      if (!live) return;
      setFound(answer.ok ? { kind: "done", candidates: answer.data.candidates } : { kind: "problem", text: explainWrite(answer.status, answer.error) });
    });
    return () => {
      live = false;
    };
  }, [api, entryId]);

  const add = async (candidate: GmailCandidate) => {
    setAdding(true);
    setProblem(null);
    const answer = await api.attachFromGmail(entryId, { messageId: candidate.messageId, partId: candidate.partId });
    setAdding(false);
    if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
    toast.show("Bijlage toegevoegd.");
    onAdded();
  };

  const title = `gmail-${entryId}`;
  return (
    <section aria-labelledby={title} className="mx-2 mb-3 rounded-2xl border-2 border-sand bg-white p-3 sm:mx-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={title} className="text-lg font-semibold">
          Gevonden in Gmail
        </h3>
        <Button variant="ghost" onClick={onClose}>
          Sluiten
        </Button>
      </div>
      {found.kind === "busy" && <p className="text-ink/70">Zoeken in Gmail…</p>}
      {found.kind === "problem" && <Problem>{found.text}</Problem>}
      {found.kind === "done" && found.candidates.length === 0 && <p className="text-ink/70">Niets gevonden in Gmail rond deze datum.</p>}
      {found.kind === "done" && found.candidates.length > 0 && (
        <ul>
          {found.candidates.map((candidate) => (
            <li key={`${candidate.messageId}/${candidate.partId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sand py-2 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-all">{candidate.filename}</p>
                <p className="text-sm text-ink/70">{`${formatDateNl(candidate.date)} · ${candidate.from} · ${candidate.subject}`}</p>
              </div>
              {candidate.numberFound && <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">factuurnummer gevonden</span>}
              {candidate.amountFound && <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">bedrag gevonden</span>}
              <Button variant="primary" disabled={adding} onClick={() => void add(candidate)}>
                Toevoegen
              </Button>
            </li>
          ))}
        </ul>
      )}
      {problem && <Problem>{problem}</Problem>}
    </section>
  );
}
