// Small building blocks the beheer pages share.

import type { ReactNode } from "react";
import { formatEuro } from "../../shared/money";
import { businessDate } from "../../shared/time";
import type { Totals } from "../../shared/types";
import { Button } from "../ui/Button";
import type { AdminData } from "./useAdmin";

/** A form field in beheer. */
export const field = "min-h-11 rounded-xl border-2 border-ink/30 bg-white px-3 text-lg";

/** A link that looks like a button. */
export const pillLink =
  "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-ink bg-white px-5 py-2 font-semibold text-ink active:bg-sand";

/** A link inside running text or a table. */
export const textLink = "font-semibold text-green-dark underline underline-offset-2";

/** Today in the Netherlands, as `YYYY-MM-DD`. */
export const today = (): string => businessDate(new Date().toISOString());

/** `1 verkoop`, `3 verkopen`. */
export const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-3xl font-bold">{children}</h1>;
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-2 text-lg font-bold">{title}</h2>}
      {children}
    </section>
  );
}

/** A problem a person has to read: a refusal, a missing connection. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-lg font-semibold text-redbrown">
      {children}
    </p>
  );
}

/** Shows what was fetched; until then that it is on its way, or that it did not come and a way to try again. */
export function Loaded<T>({ from, children }: { from: AdminData<T>; children: (data: T) => ReactNode }) {
  if (from.error) {
    return (
      <div className="mt-6 flex flex-col items-start gap-3">
        <Problem>{from.error}</Problem>
        <Button onClick={from.reload} disabled={from.loading}>
          Opnieuw proberen
        </Button>
      </div>
    );
  }
  if (from.data === null) return <p className="mt-6 text-lg text-ink/70">Laden…</p>;
  return <>{children(from.data)}</>;
}

/** A total with its split into contant and pin, and the number of sales. */
export function TotalsBlock({ totals }: { totals: Totals }) {
  return (
    <>
      <p className="text-4xl font-bold tabular-nums">{formatEuro(totals.totalCents)}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 text-lg text-ink/70 tabular-nums">
        <span>{`contant ${formatEuro(totals.cashCents)}`}</span>
        <span>{`pin ${formatEuro(totals.pinCents)}`}</span>
        <span>{count(totals.saleCount, "verkoop", "verkopen")}</span>
      </p>
    </>
  );
}
