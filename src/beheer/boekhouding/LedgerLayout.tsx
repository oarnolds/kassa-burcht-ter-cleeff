import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";

const tabs: [path: string, name: string][] = [
  ["/beheer/boekhouding", "Overzicht"],
  ["/beheer/boekhouding/te-boeken", "Te boeken"],
  ["/beheer/boekhouding/boekingen", "Boekingen"],
  ["/beheer/boekhouding/rapporten", "Rapporten"],
  ["/beheer/boekhouding/mollie", "Mollie"],
  ["/beheer/boekhouding/toestellen", "Toestellen"],
  ["/beheer/boekhouding/jaar", "Jaar"],
  ["/beheer/boekhouding/instellingen", "Instellingen"],
];

const tab = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${isActive ? "bg-ink text-white" : "text-ink hover:bg-sand"}`;

/** While a page of the boekhouding is still on its way (they load as one chunk of their own, R38). */
export function PageLoading() {
  return <p className="mt-6 text-lg text-ink/70">Laden…</p>;
}

/** The frame around the boekhouding's pages: its own tab bar, under the beheer menu. */
export function LedgerLayout() {
  return (
    <div>
      <nav aria-label="Boekhouding" className="-mx-2 mb-6 flex flex-wrap gap-1 border-b-2 border-sand pb-3 print:hidden">
        {tabs.map(([path, name]) => (
          <NavLink key={path} to={path} end className={tab}>
            {name}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
