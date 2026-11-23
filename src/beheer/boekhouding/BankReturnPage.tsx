import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ConsentState, MoneyAccount } from "../../../shared/ledger-types";
import { businessDate, formatDateNl } from "../../../shared/time";
import { PageTitle, Problem, pillLink } from "../parts";
import { useAdminData, useGo } from "../useAdmin";
import { ledgerPath, useLedgerWrites } from "./ledger-api";

type Outcome = { kind: "busy" } | { kind: "done"; state: ConsentState } | { kind: "denied" } | { kind: "stale" } | { kind: "no_account" } | { kind: "failed" };

/** Where the bank sends the browser back to: finishes the ING connection once, whatever is done with the page after. */
export function BankReturnPage() {
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
    // The effect runs twice in development and again after a re-render: the connection is made once.
    if (started.current || outcome.kind !== "busy") return;
    started.current = true;
    const pending = api.finishIng({ code: input.code!, state: input.state! });
    // The code is spent: a refresh must not carry it along again.
    go("/beheer/bank");
    void pending.then((answer) => {
      if (answer.ok) return setOutcome({ kind: "done", state: answer.data });
      if (answer.error === "state_invalid") return setOutcome({ kind: "stale" });
      if (answer.error === "account_not_in_consent") return setOutcome({ kind: "no_account" });
      setOutcome({ kind: "failed" });
    });
  }, [api, go, input, outcome.kind]);

  const money = useAdminData<MoneyAccount[]>(outcome.kind === "no_account" ? ledgerPath.moneyAccounts : null);
  const identifier = money.data?.find((account) => account.accountCode === "1010")?.identifier ?? "";

  return (
    <div>
      <PageTitle>ING koppelen</PageTitle>
      <div className="mt-4 flex flex-col items-start gap-4 text-lg">
        {outcome.kind === "busy" && <p>Bezig met koppelen…</p>}
        {outcome.kind === "done" && <p>{`ING betaal is gekoppeld tot ${formatDateNl(businessDate(outcome.state.validUntil!))}.`}</p>}
        {outcome.kind === "denied" && <Problem>ING gaf geen toestemming.</Problem>}
        {outcome.kind === "stale" && <Problem>Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.</Problem>}
        {outcome.kind === "no_account" && (
          <Problem>{`In deze toestemming zit ING betaal (${identifier}) niet. Begin opnieuw bij Instellingen en kies de betaalrekening.`}</Problem>
        )}
        {outcome.kind === "failed" && <Problem>Koppelen is niet gelukt. Begin opnieuw bij Instellingen.</Problem>}
        {outcome.kind !== "busy" && (
          <Link className={pillLink} to="/beheer/boekhouding/instellingen">
            Naar Instellingen
          </Link>
        )}
      </div>
    </div>
  );
}
