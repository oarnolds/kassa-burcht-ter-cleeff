import { Link } from "react-router";
import type { SyncState } from "./store/sync";

const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** Tells the beheerder, in a few words, whether the kassa is connected and whether anything needs attention. */
export function StatusBadge({ state }: { state: SyncState }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-base">
      {!state.paired ? (
        <span className="font-semibold text-redbrown">
          Kassa is ontkoppeld. Vraag de penningmeester om een nieuwe koppelcode.{" "}
          <Link to="/koppelen" className="inline-flex min-h-11 items-center underline">
            Opnieuw koppelen
          </Link>
        </span>
      ) : state.online ? (
        <span className="flex items-center gap-2 font-semibold text-green-dark">
          <span aria-hidden="true" className="h-3 w-3 rounded-full bg-green" />
          <span>Online</span>
        </span>
      ) : (
        <span className="flex items-center gap-2 font-semibold text-redbrown">
          <span aria-hidden="true" className="h-3 w-3 rounded-full bg-redbrown" />
          <span>Offline · contant werkt door</span>
        </span>
      )}
      {state.pending > 0 && <span>{plural(state.pending, "verkoop wacht op verzending", "verkopen wachten op verzending")}</span>}
      {state.rejected > 0 && (
        <span className="font-semibold text-redbrown">
          {plural(state.rejected, "verkoop afgekeurd", "verkopen afgekeurd")}, meld dit aan de penningmeester
        </span>
      )}
    </div>
  );
}
