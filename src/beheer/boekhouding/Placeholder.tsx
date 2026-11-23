import { Link } from "react-router";
import { PageTitle, pillLink } from "../parts";

/** A page of a later step. */
export function LedgerPlaceholder({ title }: { title: string }) {
  return (
    <div>
      <PageTitle>{title}</PageTitle>
      <p className="mt-3 text-lg text-ink/70">Komt in een volgende stap.</p>
    </div>
  );
}

/** The year page, until its step: for now the way to the opening balance and the 2026 figures. */
export function YearPlaceholder() {
  return (
    <div>
      <LedgerPlaceholder title="Jaar" />
      <p className="mt-6 flex flex-wrap gap-3">
        <Link to="/beheer/boekhouding/beginbalans" className={pillLink}>
          Beginbalans
        </Link>
        <Link to="/beheer/boekhouding/vergelijking" className={pillLink}>
          Vergelijkingscijfers 2026
        </Link>
      </p>
    </div>
  );
}
