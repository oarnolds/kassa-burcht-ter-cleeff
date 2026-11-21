import { useEffect, useId, useState } from "react";
import { businessDate, formatDateNl, shiftDate, weekRange } from "../../shared/time";
import type { DayReport, WeekReport } from "../../shared/types";
import { Card, Problem, TotalsBlock, count } from "../beheer/parts";
import { kassaApi } from "../lib/api";
import { Breakdowns, DaysTable } from "../reports/ReportTables";
import { Button } from "../ui/Button";
import { getMeta } from "./store/db";

type View = "day" | "week";
type Report = { view: "day"; report: DayReport } | { view: "week"; report: WeekReport };
type Loaded = { key: string; shown: Report | null; problem: string | null };

const OFFLINE = "Geen verbinding. De omzet is te zien zodra er weer internet is.";
const FAILED = "De omzet kon niet worden opgehaald. Probeer het opnieuw.";

const weekday = new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "UTC" });
const today = () => businessDate(new Date().toISOString());

const tab = "min-h-12 rounded-full border-2 border-green px-6 text-lg font-bold select-none";
const arrow = "min-h-12 min-w-12 px-0 text-3xl leading-none";

type Props = {
  /** Sales that are still on the iPad: the server, and so this report, does not know them yet. */
  pending: number;
  onClose(): void;
};

/**
 * The revenue of a day or a week, for the beheerder at the kassa: the figures of beheer's Rapporten,
 * to look at only. The downloads stay in beheer, with the penningmeester.
 */
export function RevenuePanel({ pending, onClose }: Props) {
  const titleId = useId();
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ key: "", shown: null, problem: null });
  const key = `${view} ${date} ${round}`;

  useEffect(() => {
    let left = false;
    void (async () => {
      const token = (await getMeta<string>("deviceToken")) ?? "";
      const answer = await kassaApi<DayReport | WeekReport>(`/api/kassa/reports/${view}?date=${date}`, token);
      if (left) return;
      if (!answer.ok) return setLoaded({ key, shown: null, problem: answer.status === 0 ? OFFLINE : FAILED });
      setLoaded({ key, shown: { view, report: answer.data } as Report, problem: null });
    })();
    return () => {
      left = true;
    };
  }, [key, view, date]);

  // What is on screen belongs to the day or week that was asked for last.
  const { shown, problem } = loaded.key === key ? loaded : { shown: null, problem: null };
  const now = today();
  const week = weekRange(date);
  const step = view === "day" ? 1 : 7;
  const atEnd = view === "day" ? date >= now : week.last >= now;
  const period = view === "day" ? "dag" : "week";
  const title =
    view === "day"
      ? `${date === now ? "Vandaag · " : ""}${weekday.format(new Date(`${date}T00:00:00Z`))} ${formatDateNl(date)}`
      : `${week.first <= now && now <= week.last ? "Deze week · " : ""}${formatDateNl(week.first)} t/m ${formatDateNl(week.last)}`;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-30 flex touch-manipulation flex-col bg-cream select-none">
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-sand bg-white px-4 py-2">
        <h2 id={titleId} className="mr-3 text-2xl font-bold">
          Omzet
        </h2>
        {(["day", "week"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={view === choice}
            className={`${tab} ${view === choice ? "bg-green text-white" : "bg-white text-green-dark active:bg-sand"}`}
            onClick={() => setView(choice)}
          >
            {choice === "day" ? "Dag" : "Week"}
          </button>
        ))}
        <Button className="ml-auto min-h-12 px-8 text-lg" onClick={onClose}>
          Sluiten
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10">
        <div className="mx-auto max-w-4xl">
          <div className="mt-4 flex items-center gap-3">
            <Button aria-label={`Vorige ${period}`} className={arrow} onClick={() => setDate(shiftDate(date, -step))}>
              ‹
            </Button>
            <h3 className="min-w-0 flex-1 text-center text-xl font-bold">{title}</h3>
            <Button aria-label={`Volgende ${period}`} className={arrow} disabled={atEnd} onClick={() => setDate(shiftDate(date, step))}>
              ›
            </Button>
          </div>

          {pending > 0 && (
            <p className="mt-4 text-lg font-semibold text-redbrown">
              {`${count(pending, "verkoop wacht", "verkopen wachten")} nog op verzending en ${pending === 1 ? "telt" : "tellen"} hier nog niet mee.`}
            </p>
          )}

          {problem && (
            <div className="mt-6 flex flex-col items-start gap-3">
              <Problem>{problem}</Problem>
              <Button className="min-h-12 text-lg" onClick={() => setRound(round + 1)}>
                Opnieuw proberen
              </Button>
            </div>
          )}
          {!problem && !shown && <p className="mt-6 text-lg text-ink/70">Laden…</p>}

          {shown?.view === "day" && (
            <>
              <Card className="mt-4" title="Dagtotaal">
                <TotalsBlock totals={shown.report.totals} />
              </Card>
              {shown.report.byProduct.length === 0 ? (
                <p className="mt-6 text-lg text-ink/70">Geen verkopen op deze dag.</p>
              ) : (
                <Breakdowns report={shown.report} />
              )}
            </>
          )}
          {shown?.view === "week" && (
            <>
              <Card className="mt-4" title="Weektotaal">
                <TotalsBlock totals={shown.report.totals} />
              </Card>
              {shown.report.days.length === 0 ? (
                <p className="mt-6 text-lg text-ink/70">Geen verkopen in deze week.</p>
              ) : (
                <>
                  <DaysTable
                    days={shown.report.days}
                    totals={shown.report.totals}
                    totalLabel="Hele week"
                    dateCell={(day, label) => (
                      <button
                        type="button"
                        className="min-h-11 font-semibold text-green-dark underline underline-offset-2"
                        onClick={() => {
                          setView("day");
                          setDate(day);
                        }}
                      >
                        {label}
                      </button>
                    )}
                  />
                  <Breakdowns report={shown.report} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
