import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { GmailState } from "../../../shared/ledger-types";
import { PageTitle, Problem, pillLink } from "../parts";
import { useGo } from "../useAdmin";
import { useLedgerWrites } from "./ledger-api";

type Outcome = { kind: "busy" } | { kind: "done"; state: GmailState } | { kind: "denied" } | { kind: "stale" } | { kind: "failed"; text: string };

/** Where Google sends the browser back to: finishes the Gmail link once, whatever is done with the page after. */
export function GmailReturnPage() {
  const api = useLedgerWrites();
  const go = useGo();
  const [params] = useSearchParams();
  // Read once: the address is cleared below, and a re-render must not look at the empty one.
  const [input] = useState(() => ({ code: params.get("code"), state: params.get("state"), error: params.get("error") }));
  const [outcome, setOutcome] = useState<Outcome>(() =>
    input.error ? { kind: "denied" } : input.code && input.state ? { kind: "busy" } : { kind: "stale" },
  );
  const started = useRef(false);

  useEffect(() => {
    // The effect runs twice in development and again after a re-render: the link is made once.
    if (started.current || outcome.kind !== "busy") return;
    started.current = true;
    const pending = api.finishGmail({ code: input.code!, state: input.state! });
    // The code is spent: a refresh must not carry it along again.
    go("/beheer/gmail");
    void pending.then((answer) => {
      if (answer.ok) return setOutcome({ kind: "done", state: answer.data });
      if (answer.error === "state_invalid") return setOutcome({ kind: "stale" });
      setOutcome({ kind: "failed", text: "Koppelen is niet gelukt. Begin opnieuw bij Instellingen." });
    });
  }, [api, go, input, outcome.kind]);

  return (
    <div>
      <PageTitle>Gmail koppelen</PageTitle>
      <div className="mt-4 flex flex-col items-start gap-4 text-lg">
        {outcome.kind === "busy" && <p>Bezig met koppelen…</p>}
        {outcome.kind === "done" && <p>{`Gmail is gekoppeld met ${outcome.state.email ?? "je mailadres"}.`}</p>}
        {outcome.kind === "denied" && <Problem>Google gaf geen toestemming.</Problem>}
        {outcome.kind === "stale" && <Problem>Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.</Problem>}
        {outcome.kind === "failed" && <Problem>{outcome.text}</Problem>}
        {outcome.kind !== "busy" && (
          <Link className={pillLink} to="/beheer/boekhouding/instellingen">
            Naar Instellingen
          </Link>
        )}
      </div>
    </div>
  );
}
