import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { kassaApi } from "../lib/api";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { setMeta } from "./store/db";

const field = "min-h-14 w-full rounded-xl border-2 border-ink/30 bg-white px-4 text-2xl";

function explain(status: number): string {
  if (status === 0) return "Geen verbinding.";
  if (status === 429) return "Te veel pogingen. Probeer het over een kwartier opnieuw.";
  if (status === 401 || status === 400) return "Code klopt niet of is verlopen.";
  return "Koppelen is niet gelukt. Probeer het opnieuw.";
}

/** Ties this iPad to the kassa with a one-time code the penningmeester makes in beheer. */
export function PairPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("iPad kiosk");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // Pairing needs no token yet; the answer brings the one this iPad will use from now on.
    const answer = await kassaApi<{ deviceId: string; token: string }>("/api/pair", "", { method: "POST", json: { code, name: name.trim() } });
    if (!answer.ok) {
      setBusy(false);
      return setError(explain(answer.status));
    }
    await setMeta("deviceToken", answer.data.token);
    void navigate("/", { replace: true });
  };

  return (
    <main className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <Logo />
      <h1 className="text-3xl font-bold">Kassa koppelen</h1>
      <p className="text-lg text-ink/70">De penningmeester maakt in beheer een koppelcode aan. Die code is tien minuten geldig.</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          Koppelcode
          <input
            className={`${field} tracking-[0.3em] tabular-nums`}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>
        <label className="flex flex-col gap-1 text-lg font-semibold">
          Naam van deze kassa
          <input className={field} maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-lg font-semibold text-redbrown">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={busy || code.length !== 6 || name.trim() === ""}>
          Koppelen
        </Button>
      </form>
    </main>
  );
}
