import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { adminApi } from "../lib/api";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { useToast } from "../ui/Toast";
import { Problem } from "./parts";
import { loadProblem, useGo } from "./useAdmin";

const pages: [path: string, name: string][] = [
  ["/beheer", "Overzicht"],
  ["/beheer/rapporten", "Rapporten"],
  ["/beheer/verkopen", "Verkopen"],
  ["/beheer/kluisje", "Kluisje"],
  ["/beheer/voorraad", "Voorraad"],
  ["/beheer/producten", "Producten"],
  ["/beheer/boekhouding", "Boekhouding"],
  ["/beheer/instellingen", "Instellingen"],
];

// Snug pills without gaps: the logo, all eight pages and Uitloggen fit on one line in a window of 1280 wide.
const navLink = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 font-semibold ${isActive ? "bg-green-dark text-white" : "text-ink hover:bg-sand"}`;

/** The frame around every beheer page: who may come in, the navigation, logging out. */
export function BeheerLayout() {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const go = useGo();
  const toast = useToast();

  useEffect(() => {
    let left = false;
    void (async () => {
      const status = await adminApi<{ configured: boolean }>("/api/admin/status");
      if (left) return;
      if (!status.ok) return setProblem(loadProblem(status.status));
      if (!status.data.configured) return go("/beheer/instellen");
      const me = await adminApi<{ authenticated: boolean }>("/api/admin/me");
      if (left) return;
      if (me.ok) return setReady(true);
      if (me.status === 401) return go("/beheer/login");
      setProblem(loadProblem(me.status));
    })();
    return () => {
      left = true;
    };
  }, [round, go]);

  const logout = async () => {
    const answer = await adminApi("/api/admin/logout", { method: "POST" });
    // Without an answer the session may still be open: do not pretend otherwise.
    if (!answer.ok && answer.status !== 401) return toast.show("Uitloggen is niet gelukt. Probeer het opnieuw.");
    go("/beheer/login");
  };

  if (!ready) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-start gap-6 p-6">
        <Logo />
        {problem && (
          <>
            <Problem>{problem}</Problem>
            <Button
              onClick={() => {
                setProblem(null);
                setRound((n) => n + 1);
              }}
            >
              Opnieuw proberen
            </Button>
          </>
        )}
      </main>
    );
  }

  return (
    <div className="min-h-full">
      {/* One bar when the window is wide enough; otherwise the whole menu goes under the logo, still on one line. */}
      <header className="border-b-2 border-sand bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Link to="/beheer" className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label="Beheer" className="flex grow flex-wrap items-center print:hidden">
            {pages.map(([path, name]) => (
              <NavLink key={path} to={path} end={path === "/beheer"} className={navLink}>
                {name}
              </NavLink>
            ))}
            <Button variant="ghost" className="ml-auto" onClick={() => void logout()}>
              Uitloggen
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
