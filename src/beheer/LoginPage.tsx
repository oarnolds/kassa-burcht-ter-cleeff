import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { adminApi } from "../lib/api";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { Problem, field } from "./parts";

function explain(status: number): string {
  if (status === 0) return "Geen verbinding.";
  if (status === 401) return "Wachtwoord klopt niet.";
  if (status === 429) return "Te veel pogingen. Probeer het over een kwartier opnieuw.";
  return "Inloggen is niet gelukt. Probeer het opnieuw.";
}

/** The door to beheer: one password, the penningmeester's. */
export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const answer = await adminApi("/api/admin/login", { method: "POST", json: { password } });
    if (answer.ok) return void navigate("/beheer", { replace: true });
    setBusy(false);
    setError(explain(answer.status));
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <Logo />
      <h1 className="text-3xl font-bold">Inloggen</h1>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          Wachtwoord
          <input
            className={field}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <Problem>{error}</Problem>}
        <Button type="submit" variant="primary" size="lg" disabled={busy || password === ""}>
          Inloggen
        </Button>
      </form>
    </main>
  );
}
