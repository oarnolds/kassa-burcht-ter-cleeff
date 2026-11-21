import { useEffect, useState, type FormEvent } from "react";
import { businessDate, formatDateNl, localTime } from "../../shared/time";
import type { BackupState, Device } from "../../shared/types";
import { adminApi } from "../lib/api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import { Loaded, Problem, PageTitle, Section, field, pillLink } from "./parts";
import { useAdminData, useAdminWrite, useGo } from "./useAdmin";

const label = "flex flex-col gap-1 text-lg font-semibold";
const inside = "flex max-w-md flex-col gap-4 px-2 sm:px-3";
const badge = "rounded-full px-3 py-0.5 text-sm font-semibold";

// A pairing code works for ten minutes (the server decides; this is how long the page shows it).
const CODE_MS = 10 * 60_000;
// While a code is on screen the list is asked again this often, so the paired kassa shows up by itself.
const LOOK_AGAIN_MS = 5_000;
const MIN_PASSWORD = 10;
const WIPE_WORD = "WISSEN";
// A weekly copy is at most seven days old; one day of slack before it counts as missing.
const COPY_STALE_MS = 8 * 86_400_000;

const offlineOr = (status: number, other: string) => (status === 0 ? "Geen verbinding. Probeer het opnieuw." : other);

/** Tying an iPad to the kassa, and taking that away again. */
function Pairing() {
  const devices = useAdminData<{ devices: Device[] }>("/api/admin/devices");
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unpairing, setUnpairing] = useState<Device | null>(null);
  const write = useAdminWrite();
  const toast = useToast();
  const lookAgain = devices.reload;

  useEffect(() => {
    if (code === null) return;
    const look = setInterval(lookAgain, LOOK_AGAIN_MS);
    const expire = setTimeout(() => setCode(null), CODE_MS);
    return () => {
      clearInterval(look);
      clearTimeout(expire);
    };
  }, [code, lookAgain]);

  const newCode = async () => {
    setBusy(true);
    setProblem(null);
    const answer = await write<{ code: string; expiresAt: string }>("/api/admin/pairing-codes", "POST");
    setBusy(false);
    if (answer.ok) return setCode(answer.data.code);
    setProblem(offlineOr(answer.status, "Een koppelcode maken is niet gelukt. Probeer het opnieuw."));
  };

  const unpair = async (device: Device) => {
    setBusy(true);
    const answer = await write(`/api/admin/devices/${encodeURIComponent(device.id)}/revoke`, "POST");
    setBusy(false);
    setUnpairing(null);
    toast.show(answer.ok ? `${device.name} is ontkoppeld` : offlineOr(answer.status, "Ontkoppelen is niet gelukt. Probeer het opnieuw."));
    devices.reload();
  };

  return (
    <Section title="Kassa koppelen">
      <div className={inside}>
        <Button disabled={busy} onClick={() => void newCode()}>
          Nieuwe koppelcode
        </Button>
        {problem && <Problem>{problem}</Problem>}
        {code !== null && (
          <div className="rounded-2xl bg-[#E1EACB] p-4 text-[#3F5512]">
            <p className="text-3xl font-bold tracking-wider tabular-nums">{`Koppelcode: ${code}`}</p>
            <p className="mt-1 text-lg">10 minuten geldig. Open de kassa op de iPad en vul deze code in.</p>
          </div>
        )}
      </div>
      <Loaded from={devices}>
        {(data) =>
          data.devices.length === 0 ? (
            <p className="mt-4 px-2 text-lg text-ink/70 sm:px-3">Er is nog geen kassa gekoppeld.</p>
          ) : (
            <ul className="mt-4 flex flex-col px-2 sm:px-3">
              {data.devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-sand py-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-3 text-lg font-semibold">
                      <span>{device.name}</span>
                      {device.revoked && <span className={`${badge} bg-sand text-ink`}>Ontkoppeld</span>}
                    </p>
                    <p className="text-ink/70">
                      {device.lastSeenAt ? `Laatst gezien ${formatDateNl(businessDate(device.lastSeenAt))} ${localTime(device.lastSeenAt)}` : "Nog niet gebruikt"}
                    </p>
                  </div>
                  {!device.revoked && <Button onClick={() => setUnpairing(device)}>Ontkoppel</Button>}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>

      <Dialog open={unpairing !== null} onClose={() => setUnpairing(null)} title="Kassa ontkoppelen">
        {unpairing && (
          <div className="flex flex-col gap-4">
            <p className="text-lg">{`${unpairing.name} ontkoppelen? De kassa werkt dan niet meer tot hij opnieuw is gekoppeld.`}</p>
            <p className="text-ink/70">Verkopen die nog op de iPad wachten, blijven daar bewaard en worden verstuurd zodra hij opnieuw is gekoppeld.</p>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setUnpairing(null)}>Annuleren</Button>
              <Button variant="danger" disabled={busy} onClick={() => void unpair(unpairing)}>
                Ontkoppel
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Section>
  );
}

function Password() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = useGo();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    if (next.length < MIN_PASSWORD) return setError("Wachtwoord is te kort.");
    setBusy(true);
    setError(null);
    const answer = await adminApi("/api/admin/password", { method: "POST", json: { current, next } });
    if (answer.ok) {
      setBusy(false);
      setCurrent("");
      setNext("");
      return setDone(true);
    }
    if (answer.status === 401) {
      // The same answer means "wrong password" and "no longer logged in": ask which.
      const me = await adminApi("/api/admin/me");
      if (!me.ok && me.status === 401) return go("/beheer/login");
    }
    setBusy(false);
    if (answer.status === 401) return setError("Huidig wachtwoord klopt niet.");
    if (answer.error === "password_too_short") return setError("Wachtwoord is te kort.");
    setError(offlineOr(answer.status, "Wijzigen is niet gelukt. Probeer het opnieuw."));
  };

  return (
    <Section title="Wachtwoord wijzigen" note="Na het wijzigen zijn andere apparaten uitgelogd.">
      <form noValidate onSubmit={(event) => void submit(event)} className={inside}>
        <label className={label}>
          Huidig wachtwoord
          <input className={field} type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <div className="flex flex-col gap-1">
          <label className={label}>
            Nieuw wachtwoord
            <input className={field} type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
          </label>
          <span className="text-ink/70">Minimaal 10 tekens</span>
        </div>
        {error && <Problem>{error}</Problem>}
        {done && (
          <p role="status" className="text-lg font-semibold text-green-dark">
            Wachtwoord gewijzigd.
          </p>
        )}
        <Button type="submit" disabled={busy || current === "" || next === ""}>
          Wijzigen
        </Button>
      </form>
    </Section>
  );
}

/** Starting clean when the trial is over. Guarded by a word that has to be typed. */
function WipeTrial() {
  const trial = useAdminData<{ inUseSince: string | null }>("/api/admin/wipe-trial");
  const [word, setWord] = useState("");
  const [final, setFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (word !== WIPE_WORD) return;
    setBusy(true);
    setError(null);
    setDone(false);
    const answer = await write("/api/admin/wipe-trial", "POST", { confirm: WIPE_WORD, final });
    setBusy(false);
    // The kassa went into use in the meantime: show that instead of the form.
    if (!answer.ok && answer.error === "in_use") return trial.reload();
    if (!answer.ok) return setError(offlineOr(answer.status, "Wissen is niet gelukt. Probeer het opnieuw."));
    setWord("");
    setDone(true);
    if (final) trial.reload();
  };

  const wiped = done && (
    <p role="status" className="text-lg font-semibold text-green-dark">
      Proefgegevens gewist.
    </p>
  );

  return (
    <Section title="Proefgegevens wissen">
      <Loaded from={trial}>
        {({ inUseSince }) =>
          inUseSince !== null ? (
            <div className={inside}>
              {wiped}
              <p className="text-lg">
                {`De kassa is in gebruik sinds ${formatDateNl(businessDate(inUseSince))}. Wissen kan niet meer: wat er nu in staat is de echte administratie.`}
              </p>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)} className={inside}>
              <p className="text-lg">
                Wist alle verkopen, afdrachten, bestellingen en voorraadmutaties. Producten, instellingen en de koppeling met de iPad blijven staan. Dit kan niet
                ongedaan worden gemaakt.
              </p>
              <label className="flex min-h-11 items-center gap-3 text-lg">
                <input type="checkbox" className="h-6 w-6 shrink-0 accent-green-dark" checked={final} onChange={(event) => setFinal(event.target.checked)} />
                Dit is de ingebruikname: hierna kan wissen niet meer
              </label>
              <label className={label}>
                Typ WISSEN om te bevestigen
                <input className={field} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={word} onChange={(event) => setWord(event.target.value)} />
              </label>
              {error && <Problem>{error}</Problem>}
              {wiped}
              <Button type="submit" variant="danger" disabled={busy || word !== WIPE_WORD}>
                Proefgegevens wissen
              </Button>
            </form>
          )
        }
      </Loaded>
    </Section>
  );
}

/** The weekly copies at Cloudflare: when the last one was made, so a copy that stopped coming is seen, and one right now. */
function Backups() {
  const copies = useAdminData<BackupState>("/api/admin/backups");
  const [made, setMade] = useState<BackupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const make = async () => {
    setBusy(true);
    setError(null);
    setMade(null);
    const answer = await write<BackupState>("/api/admin/backups", "POST");
    setBusy(false);
    if (!answer.ok) return setError(offlineOr(answer.status, "Een kopie maken is niet gelukt. Probeer het later opnieuw."));
    setMade(answer.data);
  };

  return (
    <Section title="Reservekopie" note="Elke maandagnacht bewaart de kassa zelf een kopie van alles bij Cloudflare. De 26 nieuwste blijven staan: een half jaar.">
      <Loaded from={copies}>
        {(loaded) => {
          const { latest } = made ?? loaded;
          return (
            <div className={inside}>
              <p className="text-lg">
                {latest ? `Laatste kopie: ${formatDateNl(businessDate(latest.at))} om ${localTime(latest.at)}` : "Er is nog geen kopie gemaakt."}
              </p>
              {latest && Date.now() - Date.parse(latest.at) > COPY_STALE_MS && (
                <Problem>De laatste kopie is ouder dan een week. Meld het aan de bouwer.</Problem>
              )}
              {error && <Problem>{error}</Problem>}
              {made && (
                <p role="status" className="text-lg font-semibold text-green-dark">
                  Kopie gemaakt.
                </p>
              )}
              <div>
                <Button onClick={() => void make()} disabled={busy}>
                  Nu een kopie maken
                </Button>
              </div>
            </div>
          );
        }}
      </Loaded>
    </Section>
  );
}

/** The switches around the kassa: paired iPads, the password, a full download, the weekly copies, wiping the trial. */
export function SettingsPage() {
  return (
    <>
      <PageTitle>Instellingen</PageTitle>
      <Pairing />
      <Password />
      <Section title="Gegevens" note="Eén bestand met alles wat de kassa weet: producten, verkopen, afdrachten en voorraad. Handig als reservekopie.">
        <div className="px-2 sm:px-3">
          <a className={pillLink} href="/api/admin/export.json" download>
            Alles downloaden
          </a>
        </div>
      </Section>
      <Backups />
      <WipeTrial />
    </>
  );
}
