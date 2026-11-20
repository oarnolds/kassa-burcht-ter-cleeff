import { useEffect, useState, type FormEvent } from "react";
import { adminApi } from "../lib/api";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { useToast } from "../ui/Toast";
import { Problem, field } from "./parts";
import { useGo } from "./useAdmin";

const MIN_PASSWORD = 10;

function explain(status: number, error: string): string {
  if (status === 0) return "Geen verbinding.";
  if (status === 403) return "Instelcode klopt niet.";
  if (error === "password_too_short") return "Wachtwoord is te kort.";
  if (status === 429) return "Te veel pogingen. Probeer het over een kwartier opnieuw.";
  return "Instellen is niet gelukt. Probeer het opnieuw.";
}

/** The first visit to beheer: the penningmeester chooses the password, proving who he is with the setup code. */
export function SetupPage() {
  const [checked, setChecked] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = useGo();
  const toast = useToast();

  // Once a password exists this page has nothing to offer.
  useEffect(() => {
    let left = false;
    void adminApi<{ configured: boolean }>("/api/admin/status").then((status) => {
      if (left) return;
      if (status.ok && status.data.configured) return go("/beheer/login");
      setChecked(true);
    });
    return () => {
      left = true;
    };
  }, [go]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError("Wachtwoord is te kort.");
    setBusy(true);
    setError(null);
    const answer = await adminApi("/api/admin/setup", { method: "POST", json: { setupToken, password } });
    if (answer.ok || answer.error === "already_configured") {
      if (answer.ok) toast.show("Wachtwoord ingesteld. Log nu in.");
      return go("/beheer/login");
    }
    setBusy(false);
    setError(explain(answer.status, answer.error));
  };

  if (!checked) return null;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <Logo />
      <h1 className="text-3xl font-bold">Kassa instellen</h1>
      <p className="text-lg text-ink/70">Kies het wachtwoord voor beheer. De instelcode is de code die bij het online zetten is gekozen.</p>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          Instelcode
          <input className={field} autoComplete="off" autoCapitalize="none" spellCheck={false} value={setupToken} onChange={(event) => setSetupToken(event.target.value)} />
        </label>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Nieuw wachtwoord
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              aria-describedby="password-hint"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <span id="password-hint" className="text-base text-ink/70">
            Minimaal 10 tekens
          </span>
        </div>
        {error && <Problem>{error}</Problem>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || setupToken === "" || password === ""}>
          Opslaan
        </Button>
      </form>
    </main>
  );
}
