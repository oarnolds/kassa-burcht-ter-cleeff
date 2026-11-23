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

const navLink = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${isActive ? "bg-green-dark text-white" : "text-ink hover:bg-sand"}`;

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
      <header className="border-b-2 border-sand bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <Link to="/beheer">
            <Logo />
          </Link>
        </div>
        <nav aria-label="Beheer" className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-2 py-2">
          {pages.map(([path, name]) => (
            <NavLink key={path} to={path} end={path === "/beheer"} className={navLink}>
              {name}
            </NavLink>
          ))}
          <Button variant="ghost" className="ml-auto px-4" onClick={() => void logout()}>
            Uitloggen
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
