import { Link } from "react-router";
import type { LedgerOverview } from "../../../shared/ledger-types";
import { textLink } from "../parts";

/** From this many days before the end, the penningmeester is told. */
const WARN_DAYS = 14;

/** What to say about ING's consent, or nothing: only while 1010 takes its lines from Enable Banking. */
export function consentWarning(o: LedgerOverview): "soon" | "gone" | null {
  const automatic = o.moneyAccounts.some((account) => account.accountCode === "1010" && account.source === "enable_banking");
  if (!automatic || !o.consent) return null;
  if (o.consent.daysLeft < 0) return "gone";
  return o.consent.daysLeft <= WARN_DAYS ? "soon" : null;
}

/** The warning about the consent of ING, with the way to renew it. */
export function ConsentWarning({ overview }: { overview: LedgerOverview }) {
  const which = consentWarning(overview);
  if (!which) return null;
  const left = overview.consent!.daysLeft;
  const renew = (
    <Link className={`${textLink} inline-flex min-h-11 items-center`} to="/beheer/boekhouding/instellingen">
      Vernieuwen
    </Link>
  );
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1 px-2 text-lg font-semibold text-redbrown sm:px-3">
      {which === "soon" ? (
        <>
          <span>{left === 0 ? "De toestemming van ING verloopt vandaag. " : `De toestemming van ING verloopt over ${left === 1 ? "1 dag" : `${left} dagen`}. `}</span>
          {renew}
        </>
      ) : (
        <>
          <span>ING haalt geen regels meer op: toestemming verlopen. </span>
          {renew}
          <span>{" "}of upload een bankbestand.</span>
        </>
      )}
    </p>
  );
}
