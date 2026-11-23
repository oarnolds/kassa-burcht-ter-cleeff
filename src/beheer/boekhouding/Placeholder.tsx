import { PageTitle } from "../parts";

/** A page of a later step. */
export function LedgerPlaceholder({ title }: { title: string }) {
  return (
    <div>
      <PageTitle>{title}</PageTitle>
      <p className="mt-3 text-lg text-ink/70">Komt in een volgende stap.</p>
    </div>
  );
}
